import config from '../config';
import logger from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

export interface RuntimeSettings {
  timezone: string;
  autoRead: boolean;
  notify: boolean;
  callReject: { enabled: boolean };
  cacheClearInterval: number;
}

class SettingsService {
  private static instance: SettingsService;
  private settings: RuntimeSettings;
  private autoCacheClearTimer: NodeJS.Timeout | null = null;
  private readonly envFilePath: string;

  private constructor() {
    this.envFilePath = path.join(process.cwd(), '.env');

    this.settings = {
      timezone: config.timezone,
      autoRead: config.whatsapp.autoRead,
      notify: config.whatsapp.notify,
      callReject: { enabled: config.whatsapp.callReject.enabled },
      cacheClearInterval: config.cacheClearInterval,
    };

    this.migrateFromLegacyFile();

    if (this.settings.timezone) {
      process.env.TZ = this.settings.timezone;
    }

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

    if (updates.callReject?.enabled !== undefined) {
      this.settings.callReject.enabled = updates.callReject.enabled;
      logger.info({ oldValue: oldSettings.callReject.enabled, newValue: updates.callReject.enabled }, 'Call reject updated');
    }

    if (updates.cacheClearInterval !== undefined) {
      this.settings.cacheClearInterval = updates.cacheClearInterval;
      logger.info({ oldValue: oldSettings.cacheClearInterval, newValue: updates.cacheClearInterval }, 'Cache clear interval updated');
      this.restartAutoCacheClear();
    }

    this.saveToEnv();

    return this.getSettings();
  }

  public get autoRead(): boolean { return this.settings.autoRead; }
  public get notify(): boolean { return this.settings.notify; }
  public get callRejectEnabled(): boolean { return this.settings.callReject.enabled; }
  public get timezone(): string { return this.settings.timezone; }
  public get cacheClearInterval(): number { return this.settings.cacheClearInterval; }

  public reloadFromEnv(): RuntimeSettings {
    try {
      const envContent = fs.readFileSync(this.envFilePath, 'utf-8');
      const parsed = dotenv.parse(envContent);

      if (parsed.TZ) {
        try {
          new Date().toLocaleString('tr-TR', { timeZone: parsed.TZ });
          this.settings.timezone = parsed.TZ;
          process.env.TZ = parsed.TZ;
        } catch { /* invalid timezone */ }
      }
      if (parsed.AUTO_READ !== undefined) {
        this.settings.autoRead = parsed.AUTO_READ.toLowerCase() === 'true';
      }
      if (parsed.NOTIFY !== undefined) {
        this.settings.notify = parsed.NOTIFY.toLowerCase() === 'true';
      }
      if (parsed.AUTO_REJECT_CALLS !== undefined) {
        this.settings.callReject.enabled = parsed.AUTO_REJECT_CALLS.toLowerCase() === 'true';
      }
      if (parsed.CACHE_CLEAR_INTERVAL !== undefined) {
        this.settings.cacheClearInterval = parseInt(parsed.CACHE_CLEAR_INTERVAL, 10) || 0;
      }

      this.syncProcessEnv();
      logger.info('Settings reloaded from .env file');
      this.restartAutoCacheClear();
    } catch (error) {
      logger.warn({ error }, 'Failed to reload settings from .env');
    }
    return this.getSettings();
  }

  private migrateFromLegacyFile(): void {
    const legacyPath = path.join(process.cwd(), 'public', 'settings.json');
    try {
      if (!fs.existsSync(legacyPath)) return;

      const raw = fs.readFileSync(legacyPath, 'utf-8');
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
      if (saved.callReject?.enabled !== undefined) {
        this.settings.callReject.enabled = saved.callReject.enabled;
      }
      if (saved.cacheClearInterval !== undefined) {
        this.settings.cacheClearInterval = saved.cacheClearInterval;
      }

      this.saveToEnv();
      fs.unlinkSync(legacyPath);
      logger.info('Migrated settings from settings.json to .env and removed legacy file');
    } catch (error) {
      logger.debug({ error }, 'No legacy settings.json migration needed');
    }
  }

  private saveToEnv(): void {
    try {
      let envContent = '';
      if (fs.existsSync(this.envFilePath)) {
        envContent = fs.readFileSync(this.envFilePath, 'utf-8');
      }

      const envUpdates: Record<string, string> = {
        'TZ': this.settings.timezone,
        'AUTO_READ': String(this.settings.autoRead),
        'NOTIFY': String(this.settings.notify),
        'AUTO_REJECT_CALLS': String(this.settings.callReject.enabled),
        'CACHE_CLEAR_INTERVAL': String(this.settings.cacheClearInterval),
      };

      for (const [key, value] of Object.entries(envUpdates)) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${value}`);
        } else {
          envContent = envContent.trimEnd() + `\n${key}=${value}`;
        }
      }

      fs.writeFileSync(this.envFilePath, envContent.trim() + '\n', 'utf-8');
      this.syncProcessEnv();
      logger.debug('Settings persisted to .env file');
    } catch (error) {
      logger.error({ error }, 'Failed to persist settings to .env file');
    }
  }

  private syncProcessEnv(): void {
    process.env.TZ = this.settings.timezone;
    process.env.AUTO_READ = String(this.settings.autoRead);
    process.env.NOTIFY = String(this.settings.notify);
    process.env.AUTO_REJECT_CALLS = String(this.settings.callReject.enabled);
    process.env.CACHE_CLEAR_INTERVAL = String(this.settings.cacheClearInterval);
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
