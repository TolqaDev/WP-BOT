import config from '../config';
import logger from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export interface RuntimeSettings {
  timezone: string;
  autoRead: boolean;
  notify: boolean;
  corsWhiteList: string[];
  callReject: { enabled: boolean };
  cacheClearInterval: number;
}

class SettingsService {
  private static instance: SettingsService;
  private settings: RuntimeSettings;
  private autoCacheClearTimer: NodeJS.Timeout | null = null;
  private readonly settingsFilePath: string;

  private constructor() {
    this.settingsFilePath = path.join(process.cwd(), 'public', 'settings.json');

    this.settings = {
      timezone: config.timezone,
      autoRead: config.whatsapp.autoRead,
      notify: config.whatsapp.notify,
      corsWhiteList: [...config.whatsapp.corsWhiteList],
      callReject: { enabled: config.whatsapp.callReject.enabled },
      cacheClearInterval: config.cacheClearInterval,
    };

    this.loadFromFile();
    logger.info({ settings: this.getSettings() }, 'SettingsService initialized');
    this.restartAutoCacheClear();
  }

  public static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService();
    }
    return SettingsService.instance;
  }

  public getSettings(): RuntimeSettings {
    return {
      timezone: this.settings.timezone,
      autoRead: this.settings.autoRead,
      notify: this.settings.notify,
      corsWhiteList: [...this.settings.corsWhiteList],
      callReject: { ...this.settings.callReject },
      cacheClearInterval: this.settings.cacheClearInterval,
    };
  }

  public getTimeInfo(): { timezone: string; currentTime: string; localTime: string } {
    const now = new Date();
    let localTime: string;
    try {
      localTime = now.toLocaleString('tr-TR', { timeZone: this.settings.timezone });
    } catch {
      localTime = now.toLocaleString('tr-TR');
    }
    return { timezone: this.settings.timezone, currentTime: now.toISOString(), localTime };
  }

  public updateSettings(updates: Partial<{
    timezone: string;
    autoRead: boolean;
    notify: boolean;
    corsWhiteList: string[];
    callReject: Partial<{ enabled: boolean }>;
    cacheClearInterval: number;
  }>): RuntimeSettings {
    const oldSettings = this.getSettings();

    if (updates.timezone !== undefined) {
      try {
        new Date().toLocaleString('tr-TR', { timeZone: updates.timezone });
        this.settings.timezone = updates.timezone;
        process.env.TZ = updates.timezone;
        logger.info({ oldValue: oldSettings.timezone, newValue: updates.timezone }, 'Timezone updated');
      } catch {
        logger.warn({ timezone: updates.timezone }, 'Invalid timezone, change not applied');
      }
    }

    if (updates.autoRead !== undefined) {
      this.settings.autoRead = updates.autoRead;
      logger.info({ oldValue: oldSettings.autoRead, newValue: updates.autoRead }, 'AutoRead updated');
    }

    if (updates.notify !== undefined) {
      this.settings.notify = updates.notify;
      logger.info({ oldValue: oldSettings.notify, newValue: updates.notify }, 'Notify updated');
    }

    if (updates.corsWhiteList !== undefined) {
      this.settings.corsWhiteList = [...updates.corsWhiteList];
      logger.info({ oldValue: oldSettings.corsWhiteList, newValue: updates.corsWhiteList }, 'CORS whitelist updated');
    }

    if (updates.callReject?.enabled !== undefined) {
      this.settings.callReject.enabled = updates.callReject.enabled;
      logger.info({ oldValue: oldSettings.callReject.enabled, newValue: updates.callReject.enabled }, 'Call reject updated');
    }

    if (updates.cacheClearInterval !== undefined) {
      this.settings.cacheClearInterval = updates.cacheClearInterval;
      logger.info({ oldValue: oldSettings.cacheClearInterval, newValue: updates.cacheClearInterval }, 'Cache clear interval updated');
      this.restartAutoCacheClear();
    }

    this.saveToFile();
    this.updateEnvFile();

    return this.getSettings();
  }

  public get autoRead(): boolean { return this.settings.autoRead; }
  public get notify(): boolean { return this.settings.notify; }
  public get corsWhiteList(): string[] { return [...this.settings.corsWhiteList]; }
  public get callRejectEnabled(): boolean { return this.settings.callReject.enabled; }
  public get timezone(): string { return this.settings.timezone; }
  public get cacheClearInterval(): number { return this.settings.cacheClearInterval; }

  private loadFromFile(): void {
    try {
      if (fs.existsSync(this.settingsFilePath)) {
        const raw = fs.readFileSync(this.settingsFilePath, 'utf-8');
        const saved = JSON.parse(raw) as Partial<RuntimeSettings>;

        if (saved.timezone !== undefined) {
          try {
            new Date().toLocaleString('tr-TR', { timeZone: saved.timezone });
            this.settings.timezone = saved.timezone;
            process.env.TZ = saved.timezone;
          } catch { /* invalid timezone */ }
        }
        if (saved.autoRead !== undefined) this.settings.autoRead = saved.autoRead;
        if (saved.notify !== undefined) this.settings.notify = saved.notify;
        if (saved.corsWhiteList !== undefined && Array.isArray(saved.corsWhiteList)) {
          this.settings.corsWhiteList = [...saved.corsWhiteList];
        }
        if (saved.callReject?.enabled !== undefined) {
          this.settings.callReject.enabled = saved.callReject.enabled;
        }
        if (saved.cacheClearInterval !== undefined) {
          this.settings.cacheClearInterval = saved.cacheClearInterval;
        }

        logger.info('Settings loaded from persistent file');
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to load persisted settings, using defaults');
    }
  }

  private saveToFile(): void {
    try {
      const dir = path.dirname(this.settingsFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.settingsFilePath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (error) {
      logger.error({ error }, 'Failed to persist settings to file');
    }
  }

  private updateEnvFile(): void {
    try {
      const envPath = path.join(process.cwd(), '.env');
      if (!fs.existsSync(envPath)) return;

      let envContent = fs.readFileSync(envPath, 'utf-8');

      const envUpdates: Record<string, string> = {
        'TZ': this.settings.timezone,
        'AUTO_READ': String(this.settings.autoRead),
        'NOTIFY': String(this.settings.notify),
        'AUTO_REJECT_CALLS': String(this.settings.callReject.enabled),
        'CORS_WHITE_LIST': `"${this.settings.corsWhiteList.join(', ')}"`,
        'CACHE_CLEAR_INTERVAL': String(this.settings.cacheClearInterval),
      };

      for (const [key, value] of Object.entries(envUpdates)) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${value}`);
        }
      }

      fs.writeFileSync(envPath, envContent, 'utf-8');
    } catch (error) {
      logger.error({ error }, 'Failed to update .env file');
    }
  }

  private restartAutoCacheClear(): void {
    if (this.autoCacheClearTimer) {
      clearInterval(this.autoCacheClearTimer);
      this.autoCacheClearTimer = null;
    }

    const intervalMinutes = this.settings.cacheClearInterval;
    if (intervalMinutes <= 0) return;

    this.autoCacheClearTimer = setInterval(() => {
      try {
        const messageService = require('./MessageService').default;
        const result = messageService.clearAllCaches();
        logger.info({ clearedChats: result.clearedChats, clearedMessages: result.clearedMessages, intervalMinutes }, 'Auto cache clear completed');
      } catch (error) {
        logger.error({ error }, 'Auto cache clear failed');
      }
    }, intervalMinutes * 60 * 1000);

    logger.info({ intervalMinutes }, 'Auto cache clear timer started');
  }
}

export default SettingsService.getInstance();
