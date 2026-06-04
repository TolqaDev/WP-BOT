import whatsAppService, { MediaSendOptions } from './WhatsAppService';
import logger from '../utils/logger';
import settingsService from './SettingsService';
import { formatJid, isGroupJid } from '../utils/jid';
import type { SendMessageResult, SendMessagePayload } from '../types';

/**
 * Mesaj gönderim boru hattı.
 *
 * Tek sorumluluğu: anlık mesaj göndermek (gerekirse yeniden deneme + yazıyor
 * göstergesiyle) ve zamanlı istekleri SchedulerService'e devretmek.
 * Anlık ve zamanlı gönderim AYNI yolu kullansın diye SchedulerService de
 * burayı çağırır.
 */
class MessageService {
  private static instance: MessageService;

  private constructor() { }

  public static getInstance(): MessageService {
    if (!MessageService.instance) {
      MessageService.instance = new MessageService();
    }
    return MessageService.instance;
  }

  public async sendMessage(payload: SendMessagePayload): Promise<SendMessageResult> {
    const { jid, message, type = 'text', scheduledAt } = payload;
    // Süre verilmediyse sunucu ayarından (ENV: TYPING_DURATION, varsayılan 4sn) al.
    const typingDuration = payload.typingDuration ?? settingsService.typingDuration;

    if (isGroupJid(jid) || isGroupJid(formatJid(jid))) {
      return { success: false, error: 'Gruplara mesaj gönderilemez' };
    }

    // Zamanlı istek ise: gönderimi SchedulerService üstlensin.
    if (scheduledAt) {
      try {
        const schedulerService = require('./SchedulerService').default;
        const scheduled = schedulerService.scheduleMessage({
          jid,
          message,
          type,
          mediaUrl: payload.mediaUrl,
          mediaBase64: payload.mediaBase64,
          caption: payload.caption,
          fileName: payload.fileName,
          mimetype: payload.mimetype,
          typingDuration,
          scheduledAt,
        });
        return { success: true, messageId: scheduled.id };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Mesaj zamanlanamadı',
        };
      }
    }

    const maxRetries = 3;
    const retryDelay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (!whatsAppService.isReady()) {
        if (attempt < maxRetries) {
          logger.debug({ attempt, maxRetries }, 'Bağlantı hazır değil, bekleniyor...');
          await this.waitForConnection(retryDelay * attempt);
          continue;
        }
        return { success: false, error: 'WhatsApp bağlı değil' };
      }

      try {
        // "Yazıyor..." göstergesi (zorunlu değil; hata olursa gönderime devam).
        try {
          if (typingDuration > 0) {
            await whatsAppService.sendPresenceUpdate(jid, 'composing');
            await this.delay(Math.min(typingDuration, 10000));
            await whatsAppService.sendPresenceUpdate(jid, 'paused');
          }
        } catch (presenceError) {
          const errorMsg = presenceError instanceof Error ? presenceError.message : '';
          const isStreamError = errorMsg.includes('Stream Errored') || errorMsg.includes('xml-not-well-formed');

          if (isStreamError && attempt < maxRetries) {
            logger.warn({ attempt, error: errorMsg }, 'Stream hatası, yeniden bağlantı bekleniyor...');
            await this.waitForConnection(retryDelay * attempt);
            continue;
          }
          logger.debug({ error: presenceError, jid }, 'Yazıyor göstergesi gönderilemedi, mesaja devam ediliyor');
        }

        if (!whatsAppService.isReady()) {
          if (attempt < maxRetries) {
            logger.debug({ attempt }, 'Bağlantı koptu, yeniden bağlantı bekleniyor...');
            await this.waitForConnection(retryDelay * attempt);
            continue;
          }
          return { success: false, error: 'Gönderim sırasında WhatsApp bağlantısı koptu' };
        }

        let result: SendMessageResult;

        if (type === 'text') {
          result = await whatsAppService.sendMessage(jid, message || '');
        } else {
          const mediaOptions: MediaSendOptions = {
            type,
            url: payload.mediaUrl,
            base64: payload.mediaBase64,
            caption: payload.caption,
            fileName: payload.fileName,
            mimetype: payload.mimetype,
          };
          result = await whatsAppService.sendMedia(jid, mediaOptions);
        }

        if (!result.success && result.error?.includes('bağlı değil')) {
          if (attempt < maxRetries) {
            logger.warn({ attempt, error: result.error }, 'Gönderim bağlantı hatası, yeniden deneniyor...');
            await this.waitForConnection(retryDelay * attempt);
            continue;
          }
        }

        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Bilinmeyen hata';
        const isStreamError = errorMsg.includes('Stream Errored') || errorMsg.includes('xml-not-well-formed');

        if (isStreamError && attempt < maxRetries) {
          logger.warn({ attempt, error: errorMsg }, 'Gönderim sırasında stream hatası, yeniden deneniyor...');
          await this.waitForConnection(retryDelay * attempt);
          continue;
        }

        logger.error({ error, jid, attempt }, 'Mesaj gönderilemedi');
        return { success: false, error: errorMsg };
      }
    }

    return { success: false, error: 'Maksimum deneme sayısına ulaşıldı' };
  }

  /** "yazıyor..." göstergesini başlatır ve süre sonunda durdurur. */
  public async sendTyping(jid: string, duration = 3000): Promise<void> {
    if (isGroupJid(jid)) throw new Error('Gruplar desteklenmiyor');
    await whatsAppService.sendPresenceUpdate(jid, 'composing');
    setTimeout(async () => {
      try { await whatsAppService.sendPresenceUpdate(jid, 'paused'); } catch { /* yok say */ }
    }, duration);
  }

  /** Presence (composing/paused) bilgisini doğrudan iletir. */
  public async sendPresenceUpdate(jid: string, type: 'composing' | 'paused'): Promise<void> {
    if (isGroupJid(jid)) throw new Error('Gruplar desteklenmiyor');
    await whatsAppService.sendPresenceUpdate(jid, type);
  }

  private async waitForConnection(timeout: number): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 500;

    while (Date.now() - startTime < timeout) {
      if (whatsAppService.isReady()) {
        logger.debug('Bağlantı hazır');
        return true;
      }
      await this.delay(checkInterval);
    }

    logger.warn({ timeout }, 'Bağlantı bekleme süresi doldu');
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default MessageService.getInstance();
