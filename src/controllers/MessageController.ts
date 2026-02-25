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
  /**
   * Send a message (text or media)
   * POST /api/messages/send
   */
  public async send(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body as SendMessagePayload;

      // Validation
      if (!payload.jid) {
        res.status(400).json(
          ResponseFormatter.badRequest('jid alanı zorunludur ve string olmalıdır')
        );
        return;
      }

      // Check for group JID
      if (payload.jid.includes('@g.us') || payload.jid.includes('@broadcast')) {
        res.status(400).json(
          ResponseFormatter.badRequest('Grup sohbetlerine mesaj gönderilemez')
        );
        return;
      }

      const type = payload.type || 'text';

      // Validate content based on type
      if (type === 'text') {
        if (!payload.message) {
          res.status(400).json(
            ResponseFormatter.badRequest('Text mesaj için message alanı zorunludur')
          );
          return;
        }
      } else {
        // Media types require url or base64
        if (!payload.mediaUrl && !payload.mediaBase64) {
          res.status(400).json(
            ResponseFormatter.badRequest('Medya mesajları için mediaUrl veya mediaBase64 gereklidir')
          );
          return;
        }
      }

      // Check connection
      if (!whatsAppService.isReady()) {
        res.status(503).json(
          ResponseFormatter.error('WhatsApp bağlantısı yok', 'Servis kullanılamıyor')
        );
        return;
      }

      const result = await messageService.sendMessage(payload);

      if (result.success) {
        res.status(200).json(
          ResponseFormatter.success(
            { messageId: result.messageId, jid: payload.jid, type },
            'Mesaj başarıyla gönderildi'
          )
        );
      } else {
        res.status(500).json(
          ResponseFormatter.error(result.error || 'Mesaj gönderilemedi')
        );
      }
    } catch (error) {
      logger.error({ error }, 'Mesaj gönderme hatası');
      res.status(500).json(
        ResponseFormatter.serverError('Mesaj gönderilemedi')
      );
    }
  }

  /**
   * Get message history for a specific chat (with WhatsApp store support)
   * GET /api/messages/history/:jid
   */
  public async getHistory(req: Request, res: Response): Promise<void> {
    try {
      const jid = req.params.jid as string;
      const limit = parseInt(req.query.limit as string) || 50;
      const page = parseInt(req.query.page as string) || 1;

      if (!jid) {
        res.status(400).json(
          ResponseFormatter.badRequest('jid parametresi zorunludur')
        );
        return;
      }

      // Check for group JID
      if (jid.includes('@g.us') || jid.includes('@broadcast')) {
        res.status(400).json(
          ResponseFormatter.badRequest('Grup sohbetlerinin geçmişi alınamaz')
        );
        return;
      }

      // Use async method to get combined history from local + store
      const result = await messageService.getMessageHistoryAsync(jid, limit, page);

      res.status(200).json(
        ResponseFormatter.success({
          jid,
          messages: result.messages,
          pagination: {
            total: result.total,
            page: result.page,
            totalPages: result.totalPages,
            limit,
          },
          source: result.source,
        })
      );
    } catch (error) {
      logger.error({ error }, 'Mesaj geçmişi alınamadı');
      res.status(500).json(
        ResponseFormatter.serverError('Mesaj geçmişi alınamadı')
      );
    }
  }

  /**
   * Get all chats with filtering and pagination
   * GET /api/messages/chats
   */
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
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
            hasNext: result.hasNext,
            hasPrev: result.hasPrev,
          },
          filters: {
            archived: filters.archived,
            unread: filters.unread,
            read: filters.read,
            countryCode: filters.countryCode,
            search: filters.search,
            sortBy: filters.sortBy || 'lastMessage',
            sortOrder: filters.sortOrder || 'desc',
          },
        })
      );
    } catch (error) {
      logger.error({ error }, 'Sohbetler alınamadı');
      res.status(500).json(
        ResponseFormatter.serverError('Sohbetler alınamadı')
      );
    }
  }


  /**
   * Schedule a message
   * POST /api/messages/schedule
   */
  public scheduleMessage(req: Request, res: Response): void {
    try {
      const payload = req.body as ScheduleMessagePayload;

      // Validation
      if (!payload.jid) {
        res.status(400).json(
          ResponseFormatter.badRequest('jid alanı zorunludur')
        );
        return;
      }

      if (!payload.scheduledAt) {
        res.status(400).json(
          ResponseFormatter.badRequest('scheduledAt alanı zorunludur (ISO tarih formatı)')
        );
        return;
      }

      // Check for group JID
      if (payload.jid.includes('@g.us') || payload.jid.includes('@broadcast')) {
        res.status(400).json(
          ResponseFormatter.badRequest('Grup sohbetlerine mesaj zamanlanamaz')
        );
        return;
      }

      const type = payload.type || 'text';

      if (type === 'text' && !payload.message) {
        res.status(400).json(
          ResponseFormatter.badRequest('Text mesaj için message alanı zorunludur')
        );
        return;
      }

      if (type !== 'text' && !payload.mediaUrl && !payload.mediaBase64) {
        res.status(400).json(
          ResponseFormatter.badRequest('Medya mesajları için mediaUrl veya mediaBase64 gereklidir')
        );
        return;
      }

      const scheduled = schedulerService.scheduleMessage(payload);

      res.status(201).json(
        ResponseFormatter.created(
          {
            id: scheduled.id,
            jid: scheduled.jid,
            type: scheduled.type,
            scheduledAt: scheduled.scheduledAt,
            status: scheduled.status,
          },
          'Mesaj başarıyla zamanlandı'
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mesaj zamanlanamadı';
      logger.error({ error: message, stack: error instanceof Error ? error.stack : undefined }, 'Mesaj zamanlama hatası');
      res.status(400).json(
        ResponseFormatter.badRequest(message)
      );
    }
  }

  /**
   * Get all scheduled messages
   * GET /api/messages/scheduled
   */
  public getScheduledMessages(req: Request, res: Response): void {
    try {
      const status = req.query.status as string | undefined;
      const jid = req.query.jid as string | undefined;

      const messages = schedulerService.getScheduledMessages({
        status: status as any,
        jid,
      });

      const stats = schedulerService.getStats();

      res.status(200).json(
        ResponseFormatter.success({
          messages,
          count: messages.length,
          stats,
        })
      );
    } catch (error) {
      logger.error({ error }, 'Zamanlanmış mesajlar alınamadı');
      res.status(500).json(
        ResponseFormatter.serverError('Zamanlanmış mesajlar alınamadı')
      );
    }
  }

  /**
   * Get a specific scheduled message
   * GET /api/messages/scheduled/:id
   */
  public getScheduledMessage(req: Request, res: Response): void {
    try {
      const id = req.params.id as string;

      const message = schedulerService.getScheduledMessage(id);

      if (!message) {
        res.status(404).json(
          ResponseFormatter.notFound('Zamanlanmış mesaj bulunamadı')
        );
        return;
      }

      res.status(200).json(
        ResponseFormatter.success(message)
      );
    } catch (error) {
      logger.error({ error }, 'Zamanlanmış mesaj alınamadı');
      res.status(500).json(
        ResponseFormatter.serverError('Zamanlanmış mesaj alınamadı')
      );
    }
  }

  /**
   * Update a scheduled message
   * PUT /api/messages/scheduled/:id
   */
  public updateScheduledMessage(req: Request, res: Response): void {
    try {
      const id = req.params.id as string;
      const payload = req.body as UpdateScheduledMessagePayload;

      const updated = schedulerService.updateScheduledMessage(id, payload);

      res.status(200).json(
        ResponseFormatter.success(updated, 'Zamanlanmış mesaj güncellendi')
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Güncellenemedi';
      logger.error({ error }, 'Zamanlanmış mesaj güncellenemedi');
      res.status(400).json(
        ResponseFormatter.badRequest(message)
      );
    }
  }

  /**
   * Cancel a scheduled message
   * DELETE /api/messages/scheduled/:id
   */
  public cancelScheduledMessage(req: Request, res: Response): void {
    try {
      const id = req.params.id as string;

      const cancelled = schedulerService.cancelScheduledMessage(id);

      res.status(200).json(
        ResponseFormatter.success(cancelled, 'Zamanlanmış mesaj iptal edildi')
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'İptal edilemedi';
      logger.error({ error }, 'Zamanlanmış mesaj iptal edilemedi');
      res.status(400).json(
        ResponseFormatter.badRequest(message)
      );
    }
  }

  /**
   * Clear completed scheduled messages
   * DELETE /api/messages/scheduled/completed
   */
  public clearCompletedScheduled(req: Request, res: Response): void {
    try {
      const count = schedulerService.clearCompleted();

      res.status(200).json(
        ResponseFormatter.success(
          { cleared: count },
          `${count} tamamlanmış mesaj temizlendi`
        )
      );
    } catch (error) {
      logger.error({ error }, 'Tamamlanmış mesajlar temizlenemedi');
      res.status(500).json(
        ResponseFormatter.serverError('Tamamlanmış mesajlar temizlenemedi')
      );
    }
  }

  /**
   * Check if a number is on WhatsApp
   * GET /api/messages/check/:phone
   */
  public async checkNumber(req: Request, res: Response): Promise<void> {
    try {
      const phone = req.params.phone as string;

      if (!phone) {
        res.status(400).json(
          ResponseFormatter.badRequest('Telefon numarası zorunludur')
        );
        return;
      }

      if (!whatsAppService.isReady()) {
        res.status(503).json(
          ResponseFormatter.error('WhatsApp bağlantısı yok', 'Servis kullanılamıyor')
        );
        return;
      }

      const result = await messageService.isOnWhatsApp(phone);

      res.status(200).json(
        ResponseFormatter.success(result)
      );
    } catch (error) {
      logger.error({ error }, 'Numara kontrol edilemedi');
      res.status(500).json(
        ResponseFormatter.serverError('Numara kontrol edilemedi')
      );
    }
  }

  /**
   * Get profile info
   * GET /api/messages/profile/:jid
   */
  public async getProfile(req: Request, res: Response): Promise<void> {
    try {
      const jid = req.params.jid as string;

      if (!jid) {
        res.status(400).json(
          ResponseFormatter.badRequest('jid parametresi zorunludur')
        );
        return;
      }

      // Check for group JID
      if (jid.includes('@g.us') || jid.includes('@broadcast')) {
        res.status(400).json(
          ResponseFormatter.badRequest('Grup profilleri desteklenmiyor')
        );
        return;
      }

      if (!whatsAppService.isReady()) {
        res.status(503).json(
          ResponseFormatter.error('WhatsApp bağlantısı yok', 'Servis kullanılamıyor')
        );
        return;
      }

      const profile = await messageService.getProfileInfo(jid);

      res.status(200).json(
        ResponseFormatter.success(profile)
      );
    } catch (error) {
      logger.error({ error }, 'Profil bilgisi alınamadı');
      res.status(500).json(
        ResponseFormatter.serverError('Profil bilgisi alınamadı')
      );
    }
  }

  /**
   * Send typing indicator
   * POST /api/messages/typing/:jid
   */
  public async sendTyping(req: Request, res: Response): Promise<void> {
    try {
      const jid = req.params.jid as string;
      const duration = parseInt(req.body.duration as string) || 3000;

      if (!jid) {
        res.status(400).json(
          ResponseFormatter.badRequest('jid parametresi zorunludur')
        );
        return;
      }

      if (jid.includes('@g.us') || jid.includes('@broadcast')) {
        res.status(400).json(
          ResponseFormatter.badRequest('Grup sohbetleri desteklenmiyor')
        );
        return;
      }

      if (!whatsAppService.isReady()) {
        res.status(503).json(
          ResponseFormatter.error('WhatsApp bağlantısı yok', 'Servis kullanılamıyor')
        );
        return;
      }

      await messageService.sendTyping(jid, duration);

      res.status(200).json(
        ResponseFormatter.success({ jid, duration }, 'Yazıyor göstergesi gönderildi')
      );
    } catch (error) {
      logger.error({ error }, 'Yazıyor göstergesi gönderilemedi');
      res.status(500).json(
        ResponseFormatter.serverError('Yazıyor göstergesi gönderilemedi')
      );
    }
  }

  /**
   * Mark chat as read
   * POST /api/messages/read/:jid
   */
  public async markAsRead(req: Request, res: Response): Promise<void> {
    try {
      const jid = req.params.jid as string;

      if (!jid) {
        res.status(400).json(
          ResponseFormatter.badRequest('jid parametresi zorunludur')
        );
        return;
      }

      if (jid.includes('@g.us') || jid.includes('@broadcast')) {
        res.status(400).json(
          ResponseFormatter.badRequest('Grup sohbetleri desteklenmiyor')
        );
        return;
      }

      await messageService.markChatAsRead(jid);

      res.status(200).json(
        ResponseFormatter.success({ jid }, 'Sohbet okundu olarak işaretlendi')
      );
    } catch (error) {
      logger.error({ error }, 'Sohbet okundu olarak işaretlenemedi');
      res.status(500).json(
        ResponseFormatter.serverError('İşlem başarısız')
      );
    }
  }


  /**
   * Get chat statistics
   * GET /api/messages/stats
   */
  public getChatStats(req: Request, res: Response): void {
    try {
      const stats = messageService.getChatStats();
      const scheduledStats = schedulerService.getStats();

      res.status(200).json(
        ResponseFormatter.success({
          chats: stats,
          scheduled: scheduledStats,
        })
      );
    } catch (error) {
      logger.error({ error }, 'İstatistikler alınamadı');
      res.status(500).json(
        ResponseFormatter.serverError('İstatistikler alınamadı')
      );
    }
  }

  /**
   * SSE endpoint for real-time message streaming
   * GET /api/messages/stream
   *
   * Query params:
   * - jid: (optional) Filter messages by specific JID
   *
   * Events:
   * - message: New incoming message
   * - sent: Message sent by this bot
   * - connected: WhatsApp connection established
   * - disconnected: WhatsApp connection lost
   * - heartbeat: Keep-alive ping (every 30s)
   */
  public streamMessages(req: Request, res: Response): void {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const jidFilter = req.query.jid as string | undefined;
    let isClosed = false;

    const safeWrite = (data: string): void => {
      if (!isClosed && !res.writableEnded) {
        try {
          res.write(data);
        } catch {
          isClosed = true;
        }
      }
    };

    logger.info({ jidFilter }, 'SSE mesaj stream başlatıldı');

    // Send initial connection status
    const state = whatsAppService.getState();
    const session = whatsAppService.getSessionInfo();

    safeWrite(`data: ${JSON.stringify({
      type: 'init',
      isConnected: state.isConnected,
      session: session || null,
      timestamp: new Date().toISOString(),
    })}\n\n`);

    // Message handler
    const messageHandler = (message: any) => {
      // Filter by JID if specified
      if (jidFilter && !message.from.includes(jidFilter)) {
        return;
      }

      // Skip group messages
      if (message.isGroup) {
        return;
      }

      safeWrite(`data: ${JSON.stringify({
        type: 'message',
        data: message,
        timestamp: new Date().toISOString(),
      })}\n\n`);
    };

    // Message sent handler
    const messageSentHandler = (result: any) => {
      safeWrite(`data: ${JSON.stringify({
        type: 'sent',
        data: result,
        timestamp: new Date().toISOString(),
      })}\n\n`);
    };

    // Connection handler
    const connectedHandler = (session: any) => {
      safeWrite(`data: ${JSON.stringify({
        type: 'connected',
        session,
        timestamp: new Date().toISOString(),
      })}\n\n`);
    };

    // Disconnection handler
    const disconnectedHandler = (reason: string) => {
      // Disconnection event geldi ama gerçekten disconnected mi kontrol et
      // 515 error durumunda reconnecting olabilir
      const currentState = whatsAppService.getState();

      // Eğer reconnecting durumundaysa, disconnect event'i gönderme
      if (currentState.isConnecting) {
        logger.debug({ reason }, 'Skipping disconnect event during reconnection');
        return;
      }

      safeWrite(`data: ${JSON.stringify({
        type: 'disconnected',
        reason,
        isConnecting: currentState.isConnecting,
        timestamp: new Date().toISOString(),
      })}\n\n`);
    };

    // Reconnecting handler
    const reconnectingHandler = (data: any) => {
      safeWrite(`data: ${JSON.stringify({
        type: 'reconnecting',
        ...data,
        timestamp: new Date().toISOString(),
      })}\n\n`);
    };

    // Register event listeners
    whatsAppService.on('message', messageHandler);
    whatsAppService.on('messageSent', messageSentHandler);
    whatsAppService.on('connected', connectedHandler);
    whatsAppService.on('disconnected', disconnectedHandler);
    whatsAppService.on('reconnecting', reconnectingHandler);

    // Heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      safeWrite(`data: ${JSON.stringify({
        type: 'heartbeat',
        timestamp: new Date().toISOString(),
      })}\n\n`);
    }, 30000);

    // Cleanup function
    const cleanup = () => {
      isClosed = true;
      clearInterval(heartbeatInterval);
      whatsAppService.removeListener('message', messageHandler);
      whatsAppService.removeListener('messageSent', messageSentHandler);
      whatsAppService.removeListener('connected', connectedHandler);
      whatsAppService.removeListener('disconnected', disconnectedHandler);
      whatsAppService.removeListener('reconnecting', reconnectingHandler);
      logger.info({ jidFilter }, 'SSE mesaj stream sonlandırıldı');
    };

    // Cleanup on client disconnect
    req.on('close', cleanup);
    req.on('error', cleanup);

    // No timeout for message stream - stays open until client disconnects
  }
}

export default new MessageController();
