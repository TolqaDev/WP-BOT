import { Request, Response } from 'express';
import messageService from '../services/MessageService';
import schedulerService from '../services/SchedulerService';
import whatsAppService from '../services/WhatsAppService';
import { ResponseFormatter } from '../views/ResponseFormatter';
import logger from '../utils/logger';
import type {
  SendMessagePayload,
  ChatFilters,
  ScheduleMessagePayload,
  UpdateScheduledMessagePayload,
} from '../types';

export class MessageController {
  /** POST /api/messages/send */
  public async send(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body as SendMessagePayload;

      if (!payload.jid) {
        res.status(400).json(ResponseFormatter.badRequest('jid field is required and must be a string'));
        return;
      }

      if (payload.jid.includes('@g.us') || payload.jid.includes('@broadcast')) {
        res.status(400).json(ResponseFormatter.badRequest('Cannot send messages to group chats'));
        return;
      }

      const type = payload.type || 'text';

      if (type === 'text') {
        if (!payload.message) {
          res.status(400).json(ResponseFormatter.badRequest('message field is required for text messages'));
          return;
        }
      } else {
        if (!payload.mediaUrl && !payload.mediaBase64) {
          res.status(400).json(ResponseFormatter.badRequest('mediaUrl or mediaBase64 is required for media messages'));
          return;
        }
      }

      if (!whatsAppService.isReady()) {
        res.status(503).json(ResponseFormatter.serviceUnavailable('WhatsApp is not connected'));
        return;
      }

      const result = await messageService.sendMessage(payload);

      if (result.success) {
        res.status(200).json(
          ResponseFormatter.success({ messageId: result.messageId, jid: payload.jid, type }, 'Message sent successfully')
        );
      } else {
        res.status(500).json(ResponseFormatter.error(result.error || 'Failed to send message'));
      }
    } catch (error) {
      logger.error({ error }, 'Message send error');
      res.status(500).json(ResponseFormatter.serverError('Failed to send message'));
    }
  }

  /** GET /api/messages/history/:jid */
  public async getHistory(req: Request, res: Response): Promise<void> {
    try {
      const jid = req.params.jid as string;
      const limit = parseInt(req.query.limit as string) || 50;
      const page = parseInt(req.query.page as string) || 1;

      if (!jid) {
        res.status(400).json(ResponseFormatter.badRequest('jid parameter is required'));
        return;
      }

      if (jid.includes('@g.us') || jid.includes('@broadcast')) {
        res.status(400).json(ResponseFormatter.badRequest('Cannot retrieve group chat history'));
        return;
      }

      const result = await messageService.getMessageHistoryAsync(jid, limit, page);

      res.status(200).json(
        ResponseFormatter.success({
          jid,
          messages: result.messages,
          pagination: { total: result.total, page: result.page, totalPages: result.totalPages, limit },
          source: result.source,
        })
      );
    } catch (error) {
      logger.error({ error }, 'Failed to get message history');
      res.status(500).json(ResponseFormatter.serverError('Failed to get message history'));
    }
  }

  /** GET /api/messages/chats */
  public getChats(req: Request, res: Response): void {
    try {
      const filters: ChatFilters = {
        archived: req.query.archived === 'true' ? true : req.query.archived === 'false' ? false : undefined,
        unread: req.query.unread === 'true',
        read: req.query.read === 'true',
        countryCode: req.query.countryCode as string,
        search: req.query.search as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        sortBy: req.query.sortBy as ChatFilters['sortBy'],
        sortOrder: req.query.sortOrder as ChatFilters['sortOrder'],
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      };

      const result = messageService.getAllChats(filters);

      res.status(200).json(
        ResponseFormatter.success({
          chats: result.items,
          pagination: {
            total: result.total, page: result.page, limit: result.limit,
            totalPages: result.totalPages, hasNext: result.hasNext, hasPrev: result.hasPrev,
          },
          filters: {
            archived: filters.archived, unread: filters.unread, read: filters.read,
            countryCode: filters.countryCode, search: filters.search,
            sortBy: filters.sortBy || 'lastMessage', sortOrder: filters.sortOrder || 'desc',
          },
        })
      );
    } catch (error) {
      logger.error({ error }, 'Failed to get chats');
      res.status(500).json(ResponseFormatter.serverError('Failed to get chats'));
    }
  }

  /** POST /api/messages/schedule */
  public scheduleMessage(req: Request, res: Response): void {
    try {
      const payload = req.body as ScheduleMessagePayload;

      if (!payload.jid) {
        res.status(400).json(ResponseFormatter.badRequest('jid field is required'));
        return;
      }

      if (!payload.scheduledAt) {
        res.status(400).json(ResponseFormatter.badRequest('scheduledAt field is required (ISO date format)'));
        return;
      }

      if (payload.jid.includes('@g.us') || payload.jid.includes('@broadcast')) {
        res.status(400).json(ResponseFormatter.badRequest('Cannot schedule messages to group chats'));
        return;
      }

      const type = payload.type || 'text';

      if (type === 'text' && !payload.message) {
        res.status(400).json(ResponseFormatter.badRequest('message field is required for text messages'));
        return;
      }

      if (type !== 'text' && !payload.mediaUrl && !payload.mediaBase64) {
        res.status(400).json(ResponseFormatter.badRequest('mediaUrl or mediaBase64 is required for media messages'));
        return;
      }

      const scheduled = schedulerService.scheduleMessage(payload);

      res.status(201).json(
        ResponseFormatter.created({
          id: scheduled.id, jid: scheduled.jid, type: scheduled.type,
          scheduledAt: scheduled.scheduledAt, status: scheduled.status,
        }, 'Message scheduled successfully')
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to schedule message';
      logger.error({ error: message, stack: error instanceof Error ? error.stack : undefined }, 'Schedule message error');
      res.status(400).json(ResponseFormatter.badRequest(message));
    }
  }

  /** GET /api/messages/scheduled */
  public getScheduledMessages(req: Request, res: Response): void {
    try {
      const status = req.query.status as string | undefined;
      const jid = req.query.jid as string | undefined;
      const messages = schedulerService.getScheduledMessages({ status: status as any, jid });
      const stats = schedulerService.getStats();

      res.status(200).json(ResponseFormatter.success({ messages, count: messages.length, stats }));
    } catch (error) {
      logger.error({ error }, 'Failed to get scheduled messages');
      res.status(500).json(ResponseFormatter.serverError('Failed to get scheduled messages'));
    }
  }

  /** GET /api/messages/scheduled/:id */
  public getScheduledMessage(req: Request, res: Response): void {
    try {
      const message = schedulerService.getScheduledMessage(req.params.id as string);
      if (!message) {
        res.status(404).json(ResponseFormatter.notFound('Scheduled message not found'));
        return;
      }
      res.status(200).json(ResponseFormatter.success(message));
    } catch (error) {
      logger.error({ error }, 'Failed to get scheduled message');
      res.status(500).json(ResponseFormatter.serverError('Failed to get scheduled message'));
    }
  }

  /** PUT /api/messages/scheduled/:id */
  public updateScheduledMessage(req: Request, res: Response): void {
    try {
      const updated = schedulerService.updateScheduledMessage(req.params.id as string, req.body as UpdateScheduledMessagePayload);
      res.status(200).json(ResponseFormatter.success(updated, 'Scheduled message updated'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed';
      logger.error({ error }, 'Failed to update scheduled message');
      res.status(400).json(ResponseFormatter.badRequest(message));
    }
  }

  /** DELETE /api/messages/scheduled/:id */
  public cancelScheduledMessage(req: Request, res: Response): void {
    try {
      const cancelled = schedulerService.cancelScheduledMessage(req.params.id as string);
      res.status(200).json(ResponseFormatter.success(cancelled, 'Scheduled message cancelled'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cancellation failed';
      logger.error({ error }, 'Failed to cancel scheduled message');
      res.status(400).json(ResponseFormatter.badRequest(message));
    }
  }

  /** DELETE /api/messages/scheduled/completed */
  public clearCompletedScheduled(req: Request, res: Response): void {
    try {
      const count = schedulerService.clearCompleted();
      res.status(200).json(ResponseFormatter.success({ cleared: count }, `${count} completed messages cleared`));
    } catch (error) {
      logger.error({ error }, 'Failed to clear completed messages');
      res.status(500).json(ResponseFormatter.serverError('Failed to clear completed messages'));
    }
  }

  /** GET /api/messages/check/:phone */
  public async checkNumber(req: Request, res: Response): Promise<void> {
    try {
      const phone = req.params.phone as string;
      if (!phone) {
        res.status(400).json(ResponseFormatter.badRequest('Phone number is required'));
        return;
      }
      if (!whatsAppService.isReady()) {
        res.status(503).json(ResponseFormatter.serviceUnavailable('WhatsApp is not connected'));
        return;
      }
      const result = await messageService.isOnWhatsApp(phone);
      res.status(200).json(ResponseFormatter.success(result));
    } catch (error) {
      logger.error({ error }, 'Failed to check number');
      res.status(500).json(ResponseFormatter.serverError('Failed to check number'));
    }
  }

  /** GET /api/messages/profile/:jid */
  public async getProfile(req: Request, res: Response): Promise<void> {
    try {
      const jid = req.params.jid as string;
      if (!jid) {
        res.status(400).json(ResponseFormatter.badRequest('jid parameter is required'));
        return;
      }
      if (jid.includes('@g.us') || jid.includes('@broadcast')) {
        res.status(400).json(ResponseFormatter.badRequest('Group profiles are not supported'));
        return;
      }
      if (!whatsAppService.isReady()) {
        res.status(503).json(ResponseFormatter.serviceUnavailable('WhatsApp is not connected'));
        return;
      }
      const profile = await messageService.getProfileInfo(jid);
      res.status(200).json(ResponseFormatter.success(profile));
    } catch (error) {
      logger.error({ error }, 'Failed to get profile info');
      res.status(500).json(ResponseFormatter.serverError('Failed to get profile info'));
    }
  }

  /** POST /api/messages/typing/:jid */
  public async sendTyping(req: Request, res: Response): Promise<void> {
    try {
      const jid = req.params.jid as string;
      const duration = parseInt(req.body.duration as string) || 3000;

      if (!jid) {
        res.status(400).json(ResponseFormatter.badRequest('jid parameter is required'));
        return;
      }
      if (jid.includes('@g.us') || jid.includes('@broadcast')) {
        res.status(400).json(ResponseFormatter.badRequest('Group chats are not supported'));
        return;
      }
      if (!whatsAppService.isReady()) {
        res.status(503).json(ResponseFormatter.serviceUnavailable('WhatsApp is not connected'));
        return;
      }

      await messageService.sendTyping(jid, duration);
      res.status(200).json(ResponseFormatter.success({ jid, duration }, 'Typing indicator sent'));
    } catch (error) {
      logger.error({ error }, 'Failed to send typing indicator');
      res.status(500).json(ResponseFormatter.serverError('Failed to send typing indicator'));
    }
  }

  /** POST /api/messages/read/:jid */
  public async markAsRead(req: Request, res: Response): Promise<void> {
    try {
      const jid = req.params.jid as string;
      if (!jid) {
        res.status(400).json(ResponseFormatter.badRequest('jid parameter is required'));
        return;
      }
      if (jid.includes('@g.us') || jid.includes('@broadcast')) {
        res.status(400).json(ResponseFormatter.badRequest('Group chats are not supported'));
        return;
      }
      await messageService.markChatAsRead(jid);
      res.status(200).json(ResponseFormatter.success({ jid }, 'Chat marked as read'));
    } catch (error) {
      logger.error({ error }, 'Failed to mark chat as read');
      res.status(500).json(ResponseFormatter.serverError('Operation failed'));
    }
  }

  /** GET /api/messages/stats */
  public getChatStats(req: Request, res: Response): void {
    try {
      const stats = messageService.getChatStats();
      const scheduledStats = schedulerService.getStats();
      res.status(200).json(ResponseFormatter.success({ chats: stats, scheduled: scheduledStats }));
    } catch (error) {
      logger.error({ error }, 'Failed to get statistics');
      res.status(500).json(ResponseFormatter.serverError('Failed to get statistics'));
    }
  }

  /** GET /api/messages/stream (SSE) */
  public streamMessages(req: Request, res: Response): void {
    // Check connection before starting SSE
    const state = whatsAppService.getState();
    if (!state.isConnected) {
      res.status(503).json(
        ResponseFormatter.serviceUnavailable('WhatsApp is not connected. Connect first before streaming messages.')
      );
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const jidFilter = req.query.jid as string | undefined;
    let isClosed = false;

    const safeWrite = (data: string): void => {
      if (!isClosed && !res.writableEnded) {
        try { res.write(data); } catch { isClosed = true; }
      }
    };

    logger.info({ jidFilter }, 'SSE message stream started');

    const currentState = whatsAppService.getState();
    const session = whatsAppService.getSessionInfo();
    safeWrite(`data: ${JSON.stringify({ type: 'init', isConnected: currentState.isConnected, session: session || null, timestamp: new Date().toISOString() })}\n\n`);

    const messageHandler = (message: any) => {
      if (jidFilter && !message.from.includes(jidFilter)) return;
      if (message.isGroup) return;
      safeWrite(`data: ${JSON.stringify({ type: 'message', data: message, timestamp: new Date().toISOString() })}\n\n`);
    };

    const messageSentHandler = (result: any) => {
      safeWrite(`data: ${JSON.stringify({ type: 'sent', data: result, timestamp: new Date().toISOString() })}\n\n`);
    };

    const connectedHandler = (session: any) => {
      safeWrite(`data: ${JSON.stringify({ type: 'connected', session, timestamp: new Date().toISOString() })}\n\n`);
    };

    const disconnectedHandler = (reason: string) => {
      const currentState = whatsAppService.getState();
      if (currentState.isConnecting) return;
      safeWrite(`data: ${JSON.stringify({ type: 'disconnected', reason, isConnecting: currentState.isConnecting, timestamp: new Date().toISOString() })}\n\n`);
    };

    const reconnectingHandler = (data: any) => {
      safeWrite(`data: ${JSON.stringify({ type: 'reconnecting', ...data, timestamp: new Date().toISOString() })}\n\n`);
    };

    whatsAppService.on('message', messageHandler);
    whatsAppService.on('messageSent', messageSentHandler);
    whatsAppService.on('connected', connectedHandler);
    whatsAppService.on('disconnected', disconnectedHandler);
    whatsAppService.on('reconnecting', reconnectingHandler);

    const heartbeatInterval = setInterval(() => {
      safeWrite(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
    }, 30000);

    const cleanup = () => {
      isClosed = true;
      clearInterval(heartbeatInterval);
      whatsAppService.removeListener('message', messageHandler);
      whatsAppService.removeListener('messageSent', messageSentHandler);
      whatsAppService.removeListener('connected', connectedHandler);
      whatsAppService.removeListener('disconnected', disconnectedHandler);
      whatsAppService.removeListener('reconnecting', reconnectingHandler);
      logger.info({ jidFilter }, 'SSE message stream ended');
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
  }

  /** DELETE /api/messages/cache/:jid */
  public async clearChatCache(req: Request, res: Response): Promise<void> {
    try {
      const jid = req.params.jid as string;
      if (!jid) {
        res.status(400).json(ResponseFormatter.badRequest('jid parameter is required'));
        return;
      }
      const result = messageService.clearChatCache(jid);
      res.status(200).json(ResponseFormatter.success(result, 'Chat cache cleared'));
    } catch (error) {
      logger.error({ error }, 'Failed to clear chat cache');
      res.status(500).json(ResponseFormatter.serverError('Failed to clear chat cache'));
    }
  }

  /** DELETE /api/messages/cache */
  public async clearAllCache(_req: Request, res: Response): Promise<void> {
    try {
      const result = messageService.clearAllCaches();
      res.status(200).json(ResponseFormatter.success(result, 'All caches cleared'));
    } catch (error) {
      logger.error({ error }, 'Failed to clear all caches');
      res.status(500).json(ResponseFormatter.serverError('Failed to clear all caches'));
    }
  }
}

export default new MessageController();
