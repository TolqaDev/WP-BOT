import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import logger from '../utils/logger';
import whatsAppService from './WhatsAppService';
import settingsService from './SettingsService';
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
  private readonly checkIntervalMs = 10000; // Check every 10 seconds

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

  /**
   * Schedule a new message
   */
  public scheduleMessage(payload: ScheduleMessagePayload): ScheduledMessage {
    const id = randomUUID();
    const now = new Date();
    const scheduledAt = new Date(payload.scheduledAt);
    const timezone = settingsService.timezone;

    // Helper function to format date in local timezone
    const formatLocalTime = (date: Date): string => {
      try {
        return date.toLocaleString('tr-TR', { timeZone: timezone });
      } catch {
        return date.toLocaleString('tr-TR');
      }
    };

    // Validate scheduled time - must be in the future
    // Check if the date is valid
    if (isNaN(scheduledAt.getTime())) {
      throw new Error('Geçersiz tarih formatı. ISO 8601 formatı kullanın (örn: 2026-02-17T10:00:00.000Z)');
    }

    // Must be at least 30 seconds in the future (reduced from 1 minute to avoid edge cases)
    const minFutureTime = new Date(now.getTime() + 30000); // 30 seconds from now
    if (scheduledAt < minFutureTime) {
      throw new Error(
        `Zamanlanmış tarih en az 30 saniye sonrası olmalıdır. ` +
        `Şu an: ${formatLocalTime(now)}, Seçilen: ${formatLocalTime(scheduledAt)}`
      );
    }

    // Validate JID - reject group chats
    if (this.isGroupJid(payload.jid)) {
      throw new Error('Grup sohbetlerine mesaj zamanlanamaz');
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
      typingDuration: payload.typingDuration ?? 3000, // Default 3 seconds
      scheduledAt,
      createdAt: now,
      status: 'pending',
    };

    this.scheduledMessages.set(id, scheduledMessage);
    this.scheduleTimer(scheduledMessage);

    logger.info({ id, jid: payload.jid, scheduledAt }, 'Mesaj zamanlandı');

    return scheduledMessage;
  }

  /**
   * Get all scheduled messages with optional filters
   */
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

    // Sort by scheduled time
    return messages.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }

  /**
   * Get a single scheduled message by ID
   */
  public getScheduledMessage(id: string): ScheduledMessage | undefined {
    return this.scheduledMessages.get(id);
  }

  /**
   * Update a scheduled message
   */
  public updateScheduledMessage(id: string, payload: UpdateScheduledMessagePayload): ScheduledMessage {
    const message = this.scheduledMessages.get(id);

    if (!message) {
      throw new Error('Zamanlanmış mesaj bulunamadı');
    }

    if (message.status !== 'pending') {
      throw new Error('Sadece bekleyen mesajlar düzenlenebilir');
    }

    // Update fields
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

      // Validate date format
      if (isNaN(newScheduledAt.getTime())) {
        throw new Error('Geçersiz tarih formatı. ISO 8601 formatı kullanın (örn: 2026-02-17T10:00:00.000Z)');
      }

      // Must be at least 1 minute in the future
      const minFutureTime = new Date(Date.now() + 60000);
      if (newScheduledAt < minFutureTime) {
        throw new Error(`Zamanlanmış tarih en az 1 dakika sonrası olmalıdır. Şu anki zaman: ${new Date().toISOString()}, Gönderilen: ${newScheduledAt.toISOString()}`);
      }
      message.scheduledAt = newScheduledAt;

      // Reschedule timer
      this.clearTimer(id);
      this.scheduleTimer(message);
    }

    this.scheduledMessages.set(id, message);
    logger.info({ id }, 'Zamanlanmış mesaj güncellendi');

    return message;
  }

  /**
   * Cancel a scheduled message
   */
  public cancelScheduledMessage(id: string): ScheduledMessage {
    const message = this.scheduledMessages.get(id);

    if (!message) {
      throw new Error('Zamanlanmış mesaj bulunamadı');
    }

    if (message.status !== 'pending') {
      throw new Error('Sadece bekleyen mesajlar iptal edilebilir');
    }

    message.status = 'cancelled';
    this.clearTimer(id);
    this.scheduledMessages.set(id, message);

    this.emit('messageCancelled', message);
    logger.info({ id }, 'Zamanlanmış mesaj iptal edildi');

    return message;
  }

  /**
   * Delete a scheduled message (removes from storage)
   */
  public deleteScheduledMessage(id: string): boolean {
    const message = this.scheduledMessages.get(id);

    if (!message) {
      return false;
    }

    // Can only delete cancelled, sent, or failed messages
    if (message.status === 'pending') {
      throw new Error('Önce mesajı iptal edin, sonra silebilirsiniz');
    }

    this.clearTimer(id);
    this.scheduledMessages.delete(id);
    logger.info({ id }, 'Zamanlanmış mesaj silindi');

    return true;
  }

  /**
   * Get statistics about scheduled messages
   */
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

  /**
   * Clear all completed/failed/cancelled messages
   */
  public clearCompleted(): number {
    let count = 0;
    for (const [id, message] of this.scheduledMessages.entries()) {
      if (message.status !== 'pending') {
        this.scheduledMessages.delete(id);
        this.clearTimer(id);
        count++;
      }
    }
    logger.info({ count }, 'Tamamlanmış zamanlanmış mesajlar temizlendi');
    return count;
  }

  private isGroupJid(jid: string): boolean {
    return jid.includes('@g.us') || jid.includes('@broadcast');
  }

  private scheduleTimer(message: ScheduledMessage): void {
    const delay = message.scheduledAt.getTime() - Date.now();

    if (delay <= 0) {
      // Should send immediately
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
    // Clear timer if exists
    this.clearTimer(message.id);

    // Check connection
    if (!whatsAppService.isReady()) {
      message.status = 'failed';
      message.error = 'WhatsApp bağlantısı yok';
      this.scheduledMessages.set(message.id, message);
      this.emit('messageFailed', message);
      logger.error({ id: message.id }, 'Zamanlanmış mesaj gönderilemedi: Bağlantı yok');
      return;
    }

    try {
      // Import MessageService here to avoid circular dependency
      const messageService = require('./MessageService').default;

      // Send typing indicator before sending the message (same as normal messages)
      const typingDuration = message.typingDuration ?? 3000;
      try {
        await whatsAppService.sendPresenceUpdate(message.jid, 'composing');
        // Wait for typing duration
        await this.delay(typingDuration);
        // Stop typing
        await whatsAppService.sendPresenceUpdate(message.jid, 'paused');
      } catch (typingError) {
        // Ignore typing errors, continue with sending
        logger.debug({ error: typingError, jid: message.jid }, 'Typing göstergesi gönderilemedi, mesaj gönderiliyor');
      }

      let result;

      if (message.type === 'text') {
        result = await whatsAppService.sendMessage(message.jid, message.message || '');

        // Add to history if successful (same as normal messages)
        if (result.success && result.messageId) {
          messageService.addSentMessage(message.jid, result.messageId, message.message || '', 'text');
        }
      } else {
        result = await whatsAppService.sendMedia(message.jid, {
          type: message.type,
          url: message.mediaUrl,
          base64: message.mediaBase64,
          caption: message.caption,
          fileName: message.fileName,
          mimetype: message.mimetype,
        });

        // Add to history if successful (same as normal messages)
        if (result.success && result.messageId) {
          messageService.addSentMessage(
            message.jid,
            result.messageId,
            message.caption || `[${message.type.toUpperCase()}]`,
            message.type
          );
        }
      }

      if (result.success) {
        message.status = 'sent';
        message.messageId = result.messageId;
        this.emit('messageSent', message);
        logger.info({ id: message.id, messageId: result.messageId }, 'Zamanlanmış mesaj gönderildi');
      } else {
        message.status = 'failed';
        message.error = result.error;
        this.emit('messageFailed', message);
        logger.error({ id: message.id, error: result.error }, 'Zamanlanmış mesaj gönderilemedi');
      }
    } catch (error) {
      message.status = 'failed';
      message.error = error instanceof Error ? error.message : 'Bilinmeyen hata';
      this.emit('messageFailed', message);
      logger.error({ id: message.id, error }, 'Zamanlanmış mesaj gönderilemedi');
    }

    this.scheduledMessages.set(message.id, message);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Periodic checker to ensure no messages are missed
   */
  private startScheduleChecker(): void {
    this.checkInterval = setInterval(() => {
      const now = Date.now();

      for (const message of this.scheduledMessages.values()) {
        if (message.status === 'pending' && message.scheduledAt.getTime() <= now) {
          // This message should have been sent
          if (!this.timers.has(message.id)) {
            logger.warn({ id: message.id }, 'Kaçırılmış zamanlanmış mesaj bulundu, gönderiliyor...');
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

    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

export default SchedulerService.getInstance();
