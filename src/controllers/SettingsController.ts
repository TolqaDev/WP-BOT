import { Request, Response } from 'express';
import settingsService from '../services/SettingsService';
import { ResponseFormatter } from '../views/ResponseFormatter';
import logger from '../utils/logger';

export class SettingsController {
  /**
   * Get all settings
   * GET /api/settings
   */
  public getSettings(_req: Request, res: Response): void {
    try {
      const settings = settingsService.getSettings();
      const timeInfo = settingsService.getTimeInfo();

      res.status(200).json(
        ResponseFormatter.success({
          ...settings,
          time: timeInfo,
        }, 'Ayarlar getirildi')
      );
    } catch (error) {
      logger.error({ error }, 'Ayarlar getirilemedi');
      res.status(500).json(
        ResponseFormatter.serverError('Ayarlar getirilemedi')
      );
    }
  }

  /**
   * Update settings - all changes take effect immediately
   * PUT /api/settings
   *
   * Body can contain any of:
   * - timezone: string (e.g., "Europe/Istanbul")
   * - autoRead: boolean
   * - notify: boolean
   * - corsWhiteList: string[]
   * - callReject: { enabled?: boolean, message?: string }
   */
  public updateSettings(req: Request, res: Response): void {
    try {
      const { timezone, autoRead, notify, corsWhiteList, callReject } = req.body;

      // Validate inputs
      if (timezone !== undefined && typeof timezone !== 'string') {
        res.status(400).json(
          ResponseFormatter.badRequest('timezone alanı string olmalıdır (örn: "Europe/Istanbul")')
        );
        return;
      }

      if (autoRead !== undefined && typeof autoRead !== 'boolean') {
        res.status(400).json(
          ResponseFormatter.badRequest('autoRead alanı boolean olmalıdır')
        );
        return;
      }

      if (notify !== undefined && typeof notify !== 'boolean') {
        res.status(400).json(
          ResponseFormatter.badRequest('notify alanı boolean olmalıdır')
        );
        return;
      }

      if (corsWhiteList !== undefined && !Array.isArray(corsWhiteList)) {
        res.status(400).json(
          ResponseFormatter.badRequest('corsWhiteList alanı string dizisi olmalıdır')
        );
        return;
      }

      if (callReject !== undefined) {
        if (typeof callReject !== 'object') {
          res.status(400).json(
            ResponseFormatter.badRequest('callReject alanı obje olmalıdır')
          );
          return;
        }
        if (callReject.enabled !== undefined && typeof callReject.enabled !== 'boolean') {
          res.status(400).json(
            ResponseFormatter.badRequest('callReject.enabled alanı boolean olmalıdır')
          );
          return;
        }
        if (callReject.message !== undefined && typeof callReject.message !== 'string') {
          res.status(400).json(
            ResponseFormatter.badRequest('callReject.message alanı string olmalıdır')
          );
          return;
        }
      }

      const updatedSettings = settingsService.updateSettings({
        timezone,
        autoRead,
        notify,
        corsWhiteList,
        callReject,
      });

      const timeInfo = settingsService.getTimeInfo();

      res.status(200).json(
        ResponseFormatter.success({
          ...updatedSettings,
          time: timeInfo,
        }, 'Ayarlar güncellendi')
      );
    } catch (error) {
      logger.error({ error }, 'Ayarlar güncellenemedi');
      res.status(500).json(
        ResponseFormatter.serverError('Ayarlar güncellenemedi')
      );
    }
  }
}

export default new SettingsController();
