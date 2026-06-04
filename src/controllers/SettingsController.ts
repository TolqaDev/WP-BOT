import { Request, Response } from 'express';
import settingsService from '../services/SettingsService';
import whatsAppService from '../services/WhatsAppService';
import { ResponseFormatter } from '../views/ResponseFormatter';
import logger from '../utils/logger';

export class SettingsController {
  /** GET /api/settings */
  public getSettings(_req: Request, res: Response): void {
    try {
      const settings = settingsService.getSettings();
      const timeInfo = settingsService.getTimeInfo();

      res.status(200).json(
        ResponseFormatter.success({ ...settings, time: timeInfo }, 'Settings retrieved')
      );
    } catch (error) {
      logger.error({ error }, 'Failed to get settings');
      res.status(500).json(ResponseFormatter.serverError('Failed to get settings'));
    }
  }

  /** PUT /api/settings */
  public updateSettings(req: Request, res: Response): void {
    try {
      const { timezone, autoRead, notify, callReject, typingDuration } = req.body;

      if (timezone !== undefined && typeof timezone !== 'string') {
        res.status(400).json(ResponseFormatter.badRequest('timezone must be a string (e.g., "Europe/Istanbul")'));
        return;
      }
      if (autoRead !== undefined && typeof autoRead !== 'boolean') {
        res.status(400).json(ResponseFormatter.badRequest('autoRead must be a boolean'));
        return;
      }
      if (notify !== undefined && typeof notify !== 'boolean') {
        res.status(400).json(ResponseFormatter.badRequest('notify must be a boolean'));
        return;
      }
      if (callReject !== undefined) {
        if (typeof callReject !== 'object') {
          res.status(400).json(ResponseFormatter.badRequest('callReject must be an object'));
          return;
        }
        if (callReject.enabled !== undefined && typeof callReject.enabled !== 'boolean') {
          res.status(400).json(ResponseFormatter.badRequest('callReject.enabled must be a boolean'));
          return;
        }
      }
      if (typingDuration !== undefined) {
        if (typeof typingDuration !== 'number' || typingDuration < 0 || typingDuration > 15000) {
          res.status(400).json(ResponseFormatter.badRequest('typingDuration 0-15000 ms aralığında bir sayı olmalı'));
          return;
        }
      }

      const updatedSettings = settingsService.updateSettings({
        timezone, autoRead, notify, callReject, typingDuration,
      });

      // NOTIFY değiştiyse canlı sokete hemen uygula (reconnect beklemeden):
      // false → telefon bildirimi açık, true → uygulama alır.
      if (notify !== undefined) {
        whatsAppService.applyNotifyState().catch(() => { /* bağlı değilse yok say */ });
      }

      const timeInfo = settingsService.getTimeInfo();

      res.status(200).json(
        ResponseFormatter.success({ ...updatedSettings, time: timeInfo }, 'Settings updated')
      );
    } catch (error) {
      logger.error({ error }, 'Failed to update settings');
      res.status(500).json(ResponseFormatter.serverError('Failed to update settings'));
    }
  }
  /** POST /api/settings/reload */
  public reloadSettings(_req: Request, res: Response): void {
    try {
      const reloaded = settingsService.reloadFromEnv();
      const timeInfo = settingsService.getTimeInfo();

      res.status(200).json(
        ResponseFormatter.success({ ...reloaded, time: timeInfo }, 'Settings reloaded from .env')
      );
    } catch (error) {
      logger.error({ error }, 'Failed to reload settings');
      res.status(500).json(ResponseFormatter.serverError('Failed to reload settings'));
    }
  }
}

export default new SettingsController();
