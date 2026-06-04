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
  /** "yazıyor..." gösterme süresi (ms). Mesaj göndermeden önce uygulanır. */
  typingDuration: number;
}

class SettingsService {
  private static instance: SettingsService;
  private settings: RuntimeSettings;
  private readonly envFilePath: string;

  private constructor() {
    this.envFilePath = path.join(process.cwd(), '.env');

    this.settings = {
      timezone: config.timezone,
      autoRead: config.whatsapp.autoRead,
      notify: config.whatsapp.notify,
      callReject: { enabled: config.whatsapp.callReject.enabled },
      typingDuration: config.whatsapp.typingDuration,
    };

    this.migrateFromLegacyFile();

    if (this.settings.timezone) {
      process.env.TZ = this.settings.timezone;
    }

    logger.info({ settings: this.getSettings() }, 'SettingsService initialized');
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
      typingDuration: this.settings.typingDuration,
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
    typingDuration: number;
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

    if (updates.typingDuration !== undefined) {
      this.settings.typingDuration = updates.typingDuration;
      logger.info({ oldValue: oldSettings.typingDuration, newValue: updates.typingDuration }, 'Typing duration updated');
    }

    this.saveToEnv();

    return this.getSettings();
  }

  public get autoRead(): boolean { return this.settings.autoRead; }
  public get notify(): boolean { return this.settings.notify; }
  public get callRejectEnabled(): boolean { return this.settings.callReject.enabled; }
  public get timezone(): string { return this.settings.timezone; }
  public get typingDuration(): number { return this.settings.typingDuration; }

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
      if (parsed.TYPING_DURATION !== undefined) {
        this.settings.typingDuration = parseInt(parsed.TYPING_DURATION, 10) || 0;
      }

      this.syncProcessEnv();
      logger.info('Settings reloaded from .env file');
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
      if (saved.typingDuration !== undefined) {
        this.settings.typingDuration = saved.typingDuration;
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
        'TYPING_DURATION': String(this.settings.typingDuration),
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
    process.env.TYPING_DURATION = String(this.settings.typingDuration);
  }
}

export default SettingsService.getInstance();
