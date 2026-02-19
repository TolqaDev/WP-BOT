import config from '../config';
import logger from '../utils/logger';

export interface RuntimeSettings {
  timezone: string;
  autoRead: boolean;
  notify: boolean;
  corsWhiteList: string[];
  callReject: {
    enabled: boolean;
  };
}

/**
 * SettingsService - Runtime'da değiştirilebilir ayarları yönetir
 * Tüm ayarlar anında geçerli olur
 */
class SettingsService {
  private static instance: SettingsService;

  // Runtime configurable settings
  private settings: RuntimeSettings;

  private constructor() {
    // Initialize from config (env values)
    this.settings = {
      timezone: config.timezone,
      autoRead: config.whatsapp.autoRead,
      notify: config.whatsapp.notify,
      corsWhiteList: [...config.whatsapp.corsWhiteList],
      callReject: {
        enabled: config.whatsapp.callReject.enabled,
      },
    };

    logger.info({ settings: this.getSettings() }, 'SettingsService başlatıldı');
  }

  public static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService();
    }
    return SettingsService.instance;
  }

  /**
   * Get all current settings
   */
  public getSettings(): RuntimeSettings {
    return {
      timezone: this.settings.timezone,
      autoRead: this.settings.autoRead,
      notify: this.settings.notify,
      corsWhiteList: [...this.settings.corsWhiteList],
      callReject: { ...this.settings.callReject },
    };
  }

  /**
   * Get current time info based on timezone
   */
  public getTimeInfo(): { timezone: string; currentTime: string; localTime: string } {
    const now = new Date();
    let localTime: string;

    try {
      localTime = now.toLocaleString('tr-TR', { timeZone: this.settings.timezone });
    } catch {
      // Fallback if timezone is invalid
      localTime = now.toLocaleString('tr-TR');
    }

    return {
      timezone: this.settings.timezone,
      currentTime: now.toISOString(),
      localTime,
    };
  }

  /**
   * Update settings - all changes take effect immediately
   */
  public updateSettings(updates: Partial<{
    timezone: string;
    autoRead: boolean;
    notify: boolean;
    corsWhiteList: string[];
    callReject: Partial<{
      enabled: boolean;
    }>;
  }>): RuntimeSettings {
    const oldSettings = this.getSettings();

    // Update timezone
    if (updates.timezone !== undefined) {
      // Validate timezone
      try {
        new Date().toLocaleString('tr-TR', { timeZone: updates.timezone });
        this.settings.timezone = updates.timezone;
        // Update process.env for consistency
        process.env.TZ = updates.timezone;
        logger.info({ oldValue: oldSettings.timezone, newValue: updates.timezone }, 'Timezone güncellendi');
      } catch {
        logger.warn({ timezone: updates.timezone }, 'Geçersiz timezone, değişiklik uygulanmadı');
      }
    }

    // Update autoRead
    if (updates.autoRead !== undefined) {
      this.settings.autoRead = updates.autoRead;
      logger.info({ oldValue: oldSettings.autoRead, newValue: updates.autoRead }, 'AutoRead güncellendi');
    }

    // Update notify
    if (updates.notify !== undefined) {
      this.settings.notify = updates.notify;
      logger.info({ oldValue: oldSettings.notify, newValue: updates.notify }, 'Notify güncellendi');
    }

    // Update corsWhiteList
    if (updates.corsWhiteList !== undefined) {
      this.settings.corsWhiteList = [...updates.corsWhiteList];
      logger.info({ oldValue: oldSettings.corsWhiteList, newValue: updates.corsWhiteList }, 'CORS White List güncellendi');
    }

    // Update callReject settings
    if (updates.callReject !== undefined) {
      if (updates.callReject.enabled !== undefined) {
        this.settings.callReject.enabled = updates.callReject.enabled;
        logger.info({ oldValue: oldSettings.callReject.enabled, newValue: updates.callReject.enabled }, 'Call Reject Enabled güncellendi');
      }
    }

    return this.getSettings();
  }

  // Individual getters for direct access from other services
  public get autoRead(): boolean {
    return this.settings.autoRead;
  }

  public get notify(): boolean {
    return this.settings.notify;
  }

  public get corsWhiteList(): string[] {
    return [...this.settings.corsWhiteList];
  }

  public get callRejectEnabled(): boolean {
    return this.settings.callReject.enabled;
  }


  public get timezone(): string {
    return this.settings.timezone;
  }
}

export default SettingsService.getInstance();
