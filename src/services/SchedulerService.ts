import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import logger from '../utils/logger';
import settingsService from './SettingsService';
import { isGroupJid } from '../utils/jid';
import type {
  ScheduledMessage,
  ScheduledMessageStatus,
  ScheduleMessagePayload,
  UpdateScheduledMessagePayload,
} from '../types';

class SchedulerService extends EventEmitter {
  private static instance: SchedulerService;
  private scheduledMessages: Map<string, ScheduledMessage> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly checkIntervalMs = 10000;

  private constructor() {
    super();
    this.setMaxListeners(20);
    this.startScheduleChecker();
  }

  public static getInstance(): SchedulerService {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService();
    }
    return SchedulerService.instance;
  }

  public scheduleMessage(payload: ScheduleMessagePayload): ScheduledMessage {
    const id = randomUUID();
    const now = new Date();
    const scheduledAt = new Date(payload.scheduledAt);
    const timezone = settingsService.timezone;

    const formatLocalTime = (date: Date): string => {
      try {
        return date.toLocaleString('tr-TR', { timeZone: timezone });
      } catch {
        return date.toLocaleString('tr-TR');
      }
    };

    if (isNaN(scheduledAt.getTime())) {
      throw new Error('Invalid date format. Use ISO 8601 format (e.g., 2026-02-17T10:00:00.000Z)');
    }

    const minFutureTime = new Date(now.getTime() + 30000);
    if (scheduledAt < minFutureTime) {
      throw new Error(
        `Scheduled date must be at least 30 seconds in the future. ` +
        `Now: ${formatLocalTime(now)}, Selected: ${formatLocalTime(scheduledAt)}`
      );
    }

    if (isGroupJid(payload.jid)) {
      throw new Error('Gruplara zamanlı mesaj gönderilemez');
    }

    const scheduledMessage: ScheduledMessage = {
      id,
      jid: payload.jid,
      message: payload.message,
      type: payload.type || 'text',
      mediaUrl: payload.mediaUrl,
      mediaBase64: payload.mediaBase64,
      caption: payload.caption,
      fileName: payload.fileName,
      mimetype: payload.mimetype,
      typingDuration: payload.typingDuration ?? 3000,
      scheduledAt,
      createdAt: now,
      status: 'pending',
    };

    this.scheduledMessages.set(id, scheduledMessage);
    this.scheduleTimer(scheduledMessage);

    logger.info({ id, jid: payload.jid, scheduledAt }, 'Message scheduled');

    return scheduledMessage;
  }

  public getScheduledMessages(filters?: {
    status?: ScheduledMessageStatus;
    jid?: string;
  }): ScheduledMessage[] {
    let messages = Array.from(this.scheduledMessages.values());

    if (filters?.status) {
      messages = messages.filter(m => m.status === filters.status);
    }

    if (filters?.jid) {
      messages = messages.filter(m => m.jid.includes(filters.jid!));
    }

    return messages.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }

  public getScheduledMessage(id: string): ScheduledMessage | undefined {
    return this.scheduledMessages.get(id);
  }

  public updateScheduledMessage(id: string, payload: UpdateScheduledMessagePayload): ScheduledMessage {
    const message = this.scheduledMessages.get(id);

    if (!message) {
      throw new Error('Scheduled message not found');
    }

    if (message.status !== 'pending') {
      throw new Error('Only pending messages can be edited');
    }

    if (payload.message !== undefined) message.message = payload.message;
    if (payload.type !== undefined) message.type = payload.type;
    if (payload.mediaUrl !== undefined) message.mediaUrl = payload.mediaUrl;
    if (payload.mediaBase64 !== undefined) message.mediaBase64 = payload.mediaBase64;
    if (payload.caption !== undefined) message.caption = payload.caption;
    if (payload.fileName !== undefined) message.fileName = payload.fileName;
    if (payload.mimetype !== undefined) message.mimetype = payload.mimetype;
    if (payload.typingDuration !== undefined) message.typingDuration = payload.typingDuration;

    if (payload.scheduledAt) {
      const newScheduledAt = new Date(payload.scheduledAt);

      if (isNaN(newScheduledAt.getTime())) {
        throw new Error('Invalid date format. Use ISO 8601 format (e.g., 2026-02-17T10:00:00.000Z)');
      }

      const minFutureTime = new Date(Date.now() + 60000);
      if (newScheduledAt < minFutureTime) {
        throw new Error(`Scheduled date must be at least 1 minute in the future. Current: ${new Date().toISOString()}, Provided: ${newScheduledAt.toISOString()}`);
      }
      message.scheduledAt = newScheduledAt;

      this.clearTimer(id);
      this.scheduleTimer(message);
    }

    this.scheduledMessages.set(id, message);
    logger.info({ id }, 'Scheduled message updated');

    return message;
  }

  public cancelScheduledMessage(id: string): ScheduledMessage {
    const message = this.scheduledMessages.get(id);

    if (!message) {
      throw new Error('Scheduled message not found');
    }

    if (message.status !== 'pending') {
      throw new Error('Only pending messages can be cancelled');
    }

    message.status = 'cancelled';
    this.clearTimer(id);
    this.scheduledMessages.set(id, message);

    this.emit('messageCancelled', message);
    logger.info({ id }, 'Scheduled message cancelled');

    return message;
  }

  public deleteScheduledMessage(id: string): boolean {
    const message = this.scheduledMessages.get(id);

    if (!message) {
      return false;
    }

    if (message.status === 'pending') {
      throw new Error('Önce mesajı iptal edin, sonra silebilirsiniz');
    }

    this.clearTimer(id);
    this.scheduledMessages.delete(id);
    logger.info({ id }, 'Scheduled message deleted');

    return true;
  }

  public getStats(): {
    total: number;
    pending: number;
    sent: number;
    failed: number;
    cancelled: number;
  } {
    const messages = Array.from(this.scheduledMessages.values());
    return {
      total: messages.length,
      pending: messages.filter(m => m.status === 'pending').length,
      sent: messages.filter(m => m.status === 'sent').length,
      failed: messages.filter(m => m.status === 'failed').length,
      cancelled: messages.filter(m => m.status === 'cancelled').length,
    };
  }

  public clearCompleted(): number {
    let count = 0;
    for (const [id, message] of this.scheduledMessages.entries()) {
      if (message.status !== 'pending') {
        this.scheduledMessages.delete(id);
        this.clearTimer(id);
        count++;
      }
    }
    logger.info({ count }, 'Completed scheduled messages cleared');
    return count;
  }

  private scheduleTimer(message: ScheduledMessage): void {
    const delay = message.scheduledAt.getTime() - Date.now();

    if (delay <= 0) {
      this.sendScheduledMessage(message);
      return;
    }

    const timer = setTimeout(() => {
      this.sendScheduledMessage(message);
    }, delay);

    this.timers.set(message.id, timer);
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  private async sendScheduledMessage(message: ScheduledMessage): Promise<void> {
    this.clearTimer(message.id);

    try {
      // Anlık gönderimle AYNI boru hattını kullan: bağlantı bekleme + yeniden
      // deneme + "yazıyor" göstergesi + retry-receipt için içerik önbelleği,
      // hepsi MessageService.sendMessage içinde. Böylece zamanlı mesajlar da
      // "Mesaj bekleniyor" sorununa düşmeden, anlık mesajla aynı güvenle gider.
      const messageService = require('./MessageService').default;

      const result = await messageService.sendMessage({
        jid: message.jid,
        message: message.message,
        type: message.type,
        mediaUrl: message.mediaUrl,
        mediaBase64: message.mediaBase64,
        caption: message.caption,
        fileName: message.fileName,
        mimetype: message.mimetype,
        typingDuration: message.typingDuration ?? 3000,
      });

      if (result.success) {
        message.status = 'sent';
        message.messageId = result.messageId;
        this.emit('messageSent', message);
        logger.info({ id: message.id, messageId: result.messageId }, 'Scheduled message sent');
      } else {
        message.status = 'failed';
        message.error = result.error;
        this.emit('messageFailed', message);
        logger.error({ id: message.id, error: result.error }, 'Scheduled message failed');
      }
    } catch (error) {
      message.status = 'failed';
      message.error = error instanceof Error ? error.message : 'Bilinmeyen hata';
      this.emit('messageFailed', message);
      logger.error({ id: message.id, error }, 'Scheduled message failed');
    }

    this.scheduledMessages.set(message.id, message);
  }

  private startScheduleChecker(): void {
    this.checkInterval = setInterval(() => {
      const now = Date.now();

      for (const message of this.scheduledMessages.values()) {
        if (message.status === 'pending' && message.scheduledAt.getTime() <= now) {
          if (!this.timers.has(message.id)) {
            logger.warn({ id: message.id }, 'Missed scheduled message found, sending now...');
            this.sendScheduledMessage(message);
          }
        }
      }
    }, this.checkIntervalMs);
  }

  public stopScheduleChecker(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

export default SchedulerService.getInstance();
