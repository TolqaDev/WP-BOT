import { Request, Response } from 'express';
import messageService from '../services/MessageService';
import schedulerService from '../services/SchedulerService';
import whatsAppService from '../services/WhatsAppService';
import { ResponseFormatter } from '../views/ResponseFormatter';
import logger from '../utils/logger';
import type {
  SendMessagePayload,
  ScheduleMessagePayload,
  UpdateScheduledMessagePayload,
} from '../types';

export class MessageController {
  /** POST /api/messages/send */
  public async send(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body as SendMessagePayload;

      if (!payload.jid) {
        res.status(400).json(ResponseFormatter.badRequest('jid alanı zorunludur'));
        return;
      }

      if (payload.jid.includes('@g.us') || payload.jid.includes('@broadcast')) {
        res.status(400).json(ResponseFormatter.badRequest('Gruplara mesaj gönderilemez'));
        return;
      }

      const type = payload.type || 'text';

      if (type === 'text') {
        if (!payload.message) {
          res.status(400).json(ResponseFormatter.badRequest('Metin mesajı için message alanı zorunludur'));
          return;
        }
      } else if (!payload.mediaUrl && !payload.mediaBase64) {
        res.status(400).json(ResponseFormatter.badRequest('Medya mesajı için mediaUrl veya mediaBase64 zorunludur'));
        return;
      }

      if (!whatsAppService.isReady()) {
        res.status(503).json(ResponseFormatter.serviceUnavailable('WhatsApp bağlı değil, lütfen QR kodu okutun'));
        return;
      }

      // Numara/profil kontrolü: WhatsApp'ta kayıtlı değilse gönderme.
      const phone = payload.jid.split('@')[0].replace(/\D/g, '');
      const [check] = await whatsAppService.checkNumbers([phone]);
      if (!check || !check.exists) {
        res.status(422).json(ResponseFormatter.error('Bu numarada WhatsApp hesabı yok', 'Geçersiz numara'));
        return;
      }

      const result = await messageService.sendMessage(payload);

      if (result.success) {
        res.status(200).json(
          ResponseFormatter.success({ messageId: result.messageId, jid: payload.jid, type }, 'Mesaj gönderildi')
        );
      } else {
        res.status(500).json(ResponseFormatter.error(result.error || 'Mesaj gönderilemedi'));
      }
    } catch (error) {
      logger.error({ error }, 'Message send error');
      res.status(500).json(ResponseFormatter.serverError('Mesaj gönderilemedi'));
    }
  }

  /** POST /api/messages/validate — numaraların WhatsApp profili var mı? */
  public async validateNumbers(req: Request, res: Response): Promise<void> {
    try {
      const phones = req.body?.phones as unknown;
      if (!Array.isArray(phones) || phones.length === 0) {
        res.status(400).json(ResponseFormatter.badRequest('phones (dizi) zorunludur'));
        return;
      }
      if (!whatsAppService.isReady()) {
        res.status(503).json(ResponseFormatter.serviceUnavailable('WhatsApp bağlı değil'));
        return;
      }

      const results = await whatsAppService.checkNumbers(phones.map(String));
      const valid = results.filter(r => r.exists).map(r => r.phone);
      const invalid = results.filter(r => !r.exists).map(r => r.phone);

      res.status(200).json(
        ResponseFormatter.success({ valid, invalid, results }, 'Numaralar kontrol edildi')
      );
    } catch (error) {
      logger.error({ error }, 'Failed to validate numbers');
      res.status(500).json(ResponseFormatter.serverError('Numaralar kontrol edilemedi'));
    }
  }

  /** POST /api/messages/schedule */
  public async scheduleMessage(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body as ScheduleMessagePayload;

      if (!payload.jid) {
        res.status(400).json(ResponseFormatter.badRequest('jid alanı zorunludur'));
        return;
      }

      if (!payload.scheduledAt) {
        res.status(400).json(ResponseFormatter.badRequest('scheduledAt alanı zorunludur (ISO tarih biçimi)'));
        return;
      }

      if (payload.jid.includes('@g.us') || payload.jid.includes('@broadcast')) {
        res.status(400).json(ResponseFormatter.badRequest('Gruplara zamanlı mesaj gönderilemez'));
        return;
      }

      const type = payload.type || 'text';

      if (type === 'text' && !payload.message) {
        res.status(400).json(ResponseFormatter.badRequest('Metin mesajı için message alanı zorunludur'));
        return;
      }

      if (type !== 'text' && !payload.mediaUrl && !payload.mediaBase64) {
        res.status(400).json(ResponseFormatter.badRequest('Medya mesajı için mediaUrl veya mediaBase64 zorunludur'));
        return;
      }

      // Numara/profil kontrolü: WhatsApp'ta kayıtlı değilse zamanlama.
      if (whatsAppService.isReady()) {
        const phone = payload.jid.split('@')[0].replace(/\D/g, '');
        const [check] = await whatsAppService.checkNumbers([phone]);
        if (!check || !check.exists) {
          res.status(422).json(ResponseFormatter.error('Bu numarada WhatsApp hesabı yok', 'Geçersiz numara'));
          return;
        }
      }

      const scheduled = schedulerService.scheduleMessage(payload);

      res.status(201).json(
        ResponseFormatter.created({
          id: scheduled.id, jid: scheduled.jid, type: scheduled.type,
          scheduledAt: scheduled.scheduledAt, status: scheduled.status,
        }, 'Mesaj zamanlandı')
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mesaj zamanlanamadı';
      logger.error({ error: message, stack: error instanceof Error ? error.stack : undefined }, 'Schedule message error');
      res.status(400).json(ResponseFormatter.badRequest(message));
    }
  }

  /** POST /api/messages/typing/:jid — "yazıyor..." göstergesi (Gönderim sekmesi kullanır) */
  public async sendTyping(req: Request, res: Response): Promise<void> {
    try {
      const jid = req.params.jid as string;
      const type = (req.body.type as string) || 'composing';
      const duration = parseInt(req.body.duration as string) || 3000;

      if (!jid) {
        res.status(400).json(ResponseFormatter.badRequest('jid parametresi zorunludur'));
        return;
      }
      if (jid.includes('@g.us') || jid.includes('@broadcast')) {
        res.status(400).json(ResponseFormatter.badRequest('Gruplar desteklenmiyor'));
        return;
      }
      if (!whatsAppService.isReady()) {
        res.status(503).json(ResponseFormatter.serviceUnavailable('WhatsApp bağlı değil, lütfen QR kodu okutun'));
        return;
      }

      if (type === 'paused') {
        await messageService.sendPresenceUpdate(jid, 'paused');
        res.status(200).json(ResponseFormatter.success({ jid, type: 'paused' }, 'Yazıyor göstergesi durduruldu'));
      } else {
        await messageService.sendTyping(jid, duration);
        res.status(200).json(ResponseFormatter.success({ jid, type: 'composing', duration }, 'Yazıyor göstergesi gönderildi'));
      }
    } catch (error) {
      logger.error({ error }, 'Failed to send typing indicator');
      res.status(500).json(ResponseFormatter.serverError('Yazıyor göstergesi gönderilemedi'));
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
      res.status(500).json(ResponseFormatter.serverError('Zamanlı mesajlar alınamadı'));
    }
  }

  /** GET /api/messages/scheduled/:id */
  public getScheduledMessage(req: Request, res: Response): void {
    try {
      const message = schedulerService.getScheduledMessage(req.params.id as string);
      if (!message) {
        res.status(404).json(ResponseFormatter.notFound('Zamanlı mesaj bulunamadı'));
        return;
      }
      res.status(200).json(ResponseFormatter.success(message));
    } catch (error) {
      logger.error({ error }, 'Failed to get scheduled message');
      res.status(500).json(ResponseFormatter.serverError('Zamanlı mesaj alınamadı'));
    }
  }

  /** PUT /api/messages/scheduled/:id */
  public updateScheduledMessage(req: Request, res: Response): void {
    try {
      const updated = schedulerService.updateScheduledMessage(req.params.id as string, req.body as UpdateScheduledMessagePayload);
      res.status(200).json(ResponseFormatter.success(updated, 'Zamanlı mesaj güncellendi'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Güncelleme başarısız';
      logger.error({ error }, 'Failed to update scheduled message');
      res.status(400).json(ResponseFormatter.badRequest(message));
    }
  }

  /** POST /api/messages/scheduled/:id/cancel — bekleyen zamanlı mesajı iptal eder (listede kalır) */
  public cancelScheduledMessage(req: Request, res: Response): void {
    try {
      const cancelled = schedulerService.cancelScheduledMessage(req.params.id as string);
      res.status(200).json(ResponseFormatter.success(cancelled, 'Zamanlı mesaj iptal edildi'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'İptal başarısız';
      logger.error({ error }, 'Failed to cancel scheduled message');
      res.status(400).json(ResponseFormatter.badRequest(message));
    }
  }

  /** DELETE /api/messages/scheduled/:id — iptal edilmiş/tamamlanmış mesajı listeden siler (bekleyen ise önce iptal gerekir) */
  public deleteScheduledMessage(req: Request, res: Response): void {
    try {
      const deleted = schedulerService.deleteScheduledMessage(req.params.id as string);
      if (!deleted) {
        res.status(404).json(ResponseFormatter.notFound('Zamanlı mesaj bulunamadı'));
        return;
      }
      res.status(200).json(ResponseFormatter.success({ id: req.params.id, deleted: true }, 'Zamanlı mesaj silindi'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Silme başarısız';
      logger.error({ error }, 'Failed to delete scheduled message');
      res.status(400).json(ResponseFormatter.badRequest(message));
    }
  }

  /** DELETE /api/messages/scheduled/completed */
  public clearCompletedScheduled(req: Request, res: Response): void {
    try {
      const count = schedulerService.clearCompleted();
      res.status(200).json(ResponseFormatter.success({ cleared: count }, `${count} tamamlanmış mesaj temizlendi`));
    } catch (error) {
      logger.error({ error }, 'Failed to clear completed messages');
      res.status(500).json(ResponseFormatter.serverError('Tamamlanmış mesajlar temizlenemedi'));
    }
  }
}

export default new MessageController();
