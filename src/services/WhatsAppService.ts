import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
  ConnectionState,
  MessageUpsertType,
  proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { EventEmitter } from 'events';
import QRCode from 'qrcode';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import config from '../config';
import logger, { logEventBus } from '../utils/logger';
import settingsService from './SettingsService';
import { formatJid, isGroupJid } from '../utils/jid';
import type {
  SessionState,
  SessionInfo,
  SendMessageResult,
  WhatsAppEvents,
  MessageType,
  NumberCheckResult,
} from '../types';

export interface MediaSendOptions {
  type: MessageType;
  url?: string;
  base64?: string;
  buffer?: Buffer;
  caption?: string;
  fileName?: string;
  mimetype?: string;
}

class WhatsAppService extends EventEmitter {
  private static instance: WhatsAppService;
  private socket: WASocket | null = null;

  /**
   * Gönderilen/gelen mesajların içeriğini mesaj id'sine göre tutar.
   * Alıcı mesajı çözemeyip "yeniden gönder" (retry-receipt) isterse Baileys
   * orijinal içeriği `getMessage` ile buradan ister. Boş dönersek alıcıda
   * "Mesaj bekleniyor" yazısı takılı kalır. Bu yüzden bağlantı yeniden kurulsa
   * bile bu önbellek SIFIRLANMAZ (yalnız oturum kapanınca temizlenir).
   */
  private messageCache: Map<string, proto.IMessage> = new Map();
  private readonly maxCachedMessages = 1000;

  /**
   * Şifreleme/oturum sorunu takibi.
   * Uygulama ile WhatsApp arasında şifreleme bozulduğunda mesajlar karşı tarafta
   * "Mesaj bekleniyor, bu işlem biraz zaman alabilir" durumunda kalır. Bunu iki
   * sinyalden algılarız: (1) Baileys'in çözme-hatası logları, (2) retry isteğine
   * rağmen içeriği önbellekte bulamamamız (getMessage ıskası). Eşik aşılınca
   * `encryptionAlert` true olur; ADDON bunu /auth/status ile görüp kalıcı uyarı
   * gösterir. Çözüm: bağlantıyı yenilemek (reconnect).
   */
  private encryptionAlert = false;
  private encryptionIssueTimes: number[] = [];
  private readonly encryptionWindowMs = 120000; // 2 dk
  private readonly encryptionThreshold = 3;

  private state: SessionState = {
    isConnected: false,
    isConnecting: false,
    qrCode: null,
    lastConnected: null,
  };
  private sessionInfo: SessionInfo | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private qrTimeout: NodeJS.Timeout | null = null;
  private connectionTimeout: NodeJS.Timeout | null = null;
  private qrAttempts = 0;
  private readonly maxQrAttempts = 5;
  private readonly qrLifetimeMs = 30000;
  private readonly connectionTimeoutMs = 150000;

  /**
   * Telefon (kod) ile bağlanma durumu. QR okutamayan kullanıcılar için Baileys
   * `requestPairingCode` kullanılır. Pairing modunda QR ekrana basılmaz; ilk
   * `qr` sinyalinde (WS hazır) kod istenir ve `pairingCode` olayı yayınlanır.
   */
  private pairingPhone: string | null = null;
  private pairingCode: string | null = null;
  private pairingCodeRequested = false;
  private readonly qrFilePath = path.join(process.cwd(), 'public', 'qr.png');
  private readonly logoFilePath = path.join(process.cwd(), 'public', 'logo.png');
  private connectionStartTime: Date | null = null;
  private isCancelled = false;

  private cachedLogoBuffer: Buffer | null = null;
  private logoExists: boolean | null = null;

  private notifyReminderInterval: NodeJS.Timeout | null = null;
  private readonly notifyReminderIntervalMs = 300000;

  private constructor() {
    super();
    this.setMaxListeners(20);
    this.loadLogoCache();

    // Baileys'in şifre çözme hatalarını loglardan yakala (sürümden bağımsız).
    logEventBus.on('log', (entry: { level: string; message?: string; data?: unknown }) => {
      if (entry.level !== 'error' && entry.level !== 'warn') return;
      const text = `${entry.message || ''} ${entry.data ? JSON.stringify(entry.data) : ''}`.toLowerCase();
      if (
        text.includes('failed to decrypt') ||
        text.includes('bad mac') ||
        text.includes('no matching sessions') ||
        text.includes('no session record') ||
        text.includes('senderkeyrecord') ||
        text.includes('decryptmessage')
      ) {
        this.recordEncryptionIssue('decrypt-log');
      }
    });
  }

  /**
   * Bir şifreleme sorunu sinyali kaydeder; pencere içinde eşik aşılırsa kalıcı
   * uyarıyı (encryptionAlert) açar.
   */
  private recordEncryptionIssue(reason: string): void {
    const now = Date.now();
    this.encryptionIssueTimes = this.encryptionIssueTimes.filter(t => now - t < this.encryptionWindowMs);
    this.encryptionIssueTimes.push(now);

    if (!this.encryptionAlert && this.encryptionIssueTimes.length >= this.encryptionThreshold) {
      this.encryptionAlert = true;
      logger.warn({ reason, count: this.encryptionIssueTimes.length }, 'Şifreleme sorunu algılandı — bağlantı yenilenmeli');
    }
  }

  public isEncryptionAlert(): boolean {
    return this.encryptionAlert;
  }

  private clearEncryptionAlert(): void {
    this.encryptionAlert = false;
    this.encryptionIssueTimes = [];
  }

  private async loadLogoCache(): Promise<void> {
    try {
      await fs.access(this.logoFilePath);
      this.cachedLogoBuffer = await fs.readFile(this.logoFilePath);
      this.logoExists = true;
      logger.debug('Logo cached for QR generation');
    } catch {
      this.logoExists = false;
      this.cachedLogoBuffer = null;
      logger.debug('No logo found, QR will be generated without logo');
    }
  }

  public static getInstance(): WhatsAppService {
    if (!WhatsAppService.instance) {
      WhatsAppService.instance = new WhatsAppService();
    }
    return WhatsAppService.instance;
  }

  /** Mesaj içeriğini id'siyle önbelleğe alır (retry-receipt için). */
  private cacheMessage(id: string | null | undefined, message: proto.IMessage | null | undefined): void {
    if (!id || !message || this.messageCache.has(id)) return;

    this.messageCache.set(id, message);

    // Bellek şişmesin: sınırı aşınca en eski kaydı at.
    if (this.messageCache.size > this.maxCachedMessages) {
      const oldest = this.messageCache.keys().next().value;
      if (oldest !== undefined) this.messageCache.delete(oldest);
    }
  }

  public async hasExistingSession(): Promise<boolean> {
    try {
      const credsPath = path.join(config.sessionPath, 'creds.json');
      await fs.access(credsPath);
      logger.debug('Existing session credentials found');
      return true;
    } catch {
      logger.debug('No existing session credentials found');
      return false;
    }
  }

  public async autoConnect(): Promise<boolean> {
    const hasSession = await this.hasExistingSession();

    if (hasSession) {
      logger.info('Existing session found, attempting auto-connect...');
      try {
        await this.connect();
        return true;
      } catch (error) {
        logger.error({ error }, 'Auto-connect failed');
        return false;
      }
    }

    logger.info('No existing session, waiting for QR scan');
    return false;
  }

  public async connect(): Promise<void> {
    if (this.state.isConnecting) {
      logger.warn('Connection already in progress');
      return;
    }

    if (this.state.isConnected && this.socket) {
      logger.info('Already connected');
      return;
    }

    if (this.socket) {
      logger.debug('Cleaning up old socket before new connection');
      try {
        this.socket.end(undefined);
      } catch { }
      this.socket = null;
    }

    this.state.isConnecting = true;
    this.qrAttempts = 0;
    this.connectionStartTime = new Date();
    this.isCancelled = false;

    this.connectionTimeout = setTimeout(() => {
      this.handleConnectionTimeout();
    }, this.connectionTimeoutMs);

    try {
      await fs.mkdir(path.dirname(this.qrFilePath), { recursive: true });

      let { state: authState, saveCreds } = await useMultiFileAuthState(config.sessionPath);

      // Yarım kalmış pairing creds'i (me var ama registered değil) hem QR'ı hem
      // yeni pairing'i bozar (Baileys "login" node gönderir, "registration" değil).
      // Pairing modunda DEĞİLSEK bu kirli creds'i temizleyip taze auth yükle.
      if (!this.pairingPhone && authState.creds.me && !authState.creds.registered) {
        logger.info('Incomplete pairing creds detected, resetting for fresh login');
        await this.clearSession();
        ({ state: authState, saveCreds } = await useMultiFileAuthState(config.sessionPath));
      }

      const { version } = await fetchLatestBaileysVersion();

      logger.info({ version }, 'Using Baileys version');

      this.socket = makeWASocket({
        version,
        auth: {
          creds: authState.creds,
          keys: makeCacheableSignalKeyStore(authState.keys, logger),
        },
        printQRInTerminal: false,
        // QR ömrü: ilk ve sonraki tüm QR'lar 30 sn (ekrandaki sayaçla hizalı).
        // 5 deneme × 30 sn = 150 sn → connectionTimeoutMs ile birebir uyumlu.
        qrTimeout: this.qrLifetimeMs,
        logger,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: config.whatsapp.notify,
        // Geçmiş senkronu KAPALI: ne tam ne kısmi geçmiş çekilir. Yalnızca
        // bağlantı için gereken temel senkron yapılır. Bu, terminaldeki
        // "senkronizasyon" gürültüsünü/hatalarını ortadan kaldırır.
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        fireInitQueries: true,
        shouldIgnoreJid: (jid) => {
          // Gruplara/broadcast'e mesaj göndermeyiz; gelenleri de yok sayarız.
          if (!jid) return true;
          return jid.endsWith('@g.us') || jid.endsWith('@broadcast');
        },
        retryRequestDelayMs: 250,
        connectTimeoutMs: 30000,
        keepAliveIntervalMs: 25000,
        emitOwnEvents: true,
        getMessage: async (key) => {
          // Alıcı mesajı çözemezse retry-receipt gönderir; Baileys orijinal
          // içeriği buradan ister. id ile önbellekten veririz.
          const cached = key.id ? this.messageCache.get(key.id) : undefined;
          // İçerik elimizde yoksa karşı taraf "Mesaj bekleniyor"da kalır →
          // şifreleme/oturum sorunu sinyali.
          if (!cached && key.id) {
            this.recordEncryptionIssue('getMessage-miss');
          }
          return cached || undefined;
        },
      });

      this.setupEventListeners(saveCreds);
    } catch (error) {
      this.state.isConnecting = false;
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      logger.error({ error }, 'Failed to initialize WhatsApp connection');
      throw error;
    }
  }

  private setupEventListeners(saveCreds: () => Promise<void>): void {
    if (!this.socket) return;

    this.socket.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      try {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          if (this.pairingPhone) {
            // Pairing modunda QR ekrana basılmaz. İlk qr sinyali WS'in hazır
            // olduğunu gösterir; bu noktada bir kez pairing kodu istenir.
            if (!this.pairingCodeRequested) {
              this.pairingCodeRequested = true;
              await this.generatePairingCode();
            }
          } else {
            this.handleQRCode(qr);
          }
        }

        if (connection === 'close') {
          this.handleConnectionClose(lastDisconnect);
        } else if (connection === 'open') {
          this.handleConnectionOpen();
        }
      } catch (error) {
        logger.error({ error }, 'Error in connection.update handler');
      }
    });

    this.socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch (error) {
        logger.error({ error }, 'Error saving credentials');
      }
    });

    this.socket.ev.on('call', async (calls) => {
      try {
        for (const call of calls) {
          if (call.status === 'offer') {
            await this.handleIncomingCall(call);
          }
        }
      } catch (error) {
        logger.error({ error }, 'Error handling call');
      }
    });

    this.socket.ev.on('messages.upsert', async (m: { messages: proto.IWebMessageInfo[]; type: MessageUpsertType }) => {
      try {
        // Tüm mesajları (giden + gelen) retry-receipt için önbelleğe al.
        for (const msg of m.messages) {
          this.cacheMessage(msg.key?.id, msg.message);
        }

        // Yalnız gerçek bildirimlerde otomatik okundu işaretle (ayar açıksa).
        if (m.type !== 'notify' || !settingsService.autoRead || !this.socket) return;

        for (const msg of m.messages) {
          if (msg.key.fromMe) continue;
          try {
            await this.socket.readMessages([msg.key]);
          } catch (error) {
            logger.warn({ error, jid: msg.key.remoteJid }, 'Failed to auto-mark message as read');
          }
        }
      } catch (error) {
        logger.error({ error }, 'Error in messages.upsert handler');
      }
    });
  }

  private async handleQRCode(qr: string): Promise<void> {
    try {
      this.qrAttempts++;

      if (this.qrAttempts > this.maxQrAttempts) {
        logger.warn({ attempts: this.qrAttempts }, 'Max QR attempts reached, cancelling connection');
        await this.cancelConnection().catch(() => this.stopConnection('Max QR attempts reached'));
        return;
      }

      if (this.qrTimeout) {
        clearTimeout(this.qrTimeout);
      }

      this.saveQRToFile(qr).catch(err => logger.warn({ error: err }, 'QR file save failed'));

      let qrBase64: string;
      try {
        const qrBuffer = await this.composeQrPng(qr, 256, 6);
        qrBase64 = `data:image/png;base64,${qrBuffer.toString('base64')}`;
      } catch (logoError) {
        logger.warn({ error: logoError }, 'Logo QR generation failed, falling back to basic QR');
        const qrBuffer = await QRCode.toBuffer(qr, {
          errorCorrectionLevel: 'H',
          type: 'png',
          margin: 2,
          width: 256,
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        qrBase64 = `data:image/png;base64,${qrBuffer.toString('base64')}`;
      }

      this.state.qrCode = qrBase64;
      this.emit('qr', qrBase64);
      logger.info({ attempt: this.qrAttempts, maxAttempts: this.maxQrAttempts }, 'New QR code generated');

      this.qrTimeout = setTimeout(() => {
        this.state.qrCode = null;
        this.deleteQRFile();
        logger.debug('QR code expired');
      }, this.qrLifetimeMs);
    } catch (error) {
      logger.error({ error }, 'Failed to generate QR code');
    }
  }

  /**
   * Telefon numarası (kod) ile bağlanma. QR okutamayan kullanıcılar için.
   * WhatsApp > Bağlı Cihazlar > Cihaz bağla > "Telefon numarası ile bağla".
   * Temiz bir oturum açıp pairing moduna girer ve 8 haneli kodu döndürür.
   */
  public async requestPairingCode(phoneNumber: string): Promise<string> {
    if (this.state.isConnected) {
      throw new Error('Zaten bağlı, önce çıkış yapın');
    }

    const phone = (phoneNumber || '').replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 15) {
      throw new Error('Geçersiz telefon numarası. Ülke kodu ile girin (örn. 905551234567)');
    }

    // Temiz başlangıç: süren bir QR/bağlantı denemesi varsa iptal et.
    if (this.state.isConnecting || this.socket) {
      try { await this.cancelConnection(); } catch { }
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Pairing TAZE kayıt ister: önceki (yarım) oturumu temizle, aksi halde
    // Baileys "login" node gönderir ve üretilen kod WhatsApp'ta kabul edilmez.
    await this.clearSession();

    this.pairingPhone = phone;
    this.pairingCode = null;
    this.pairingCodeRequested = false;

    // Kod, WS hazır olunca (ilk qr sinyali) üretilir; olayı bekleyip döndür.
    const codePromise = this.waitForPairingCode(20000);
    await this.connect();
    return codePromise;
  }

  /** WS hazır olduğunda Baileys'ten pairing kodunu ister ve olayı yayınlar. */
  private async generatePairingCode(): Promise<void> {
    if (!this.socket || !this.pairingPhone) return;
    try {
      const code = await this.socket.requestPairingCode(this.pairingPhone);
      this.pairingCode = code;
      logger.info({ phone: this.pairingPhone }, 'Pairing code generated');
      this.emit('pairingCode', code);
    } catch (error) {
      logger.error({ error }, 'Failed to request pairing code');
      this.resetPairing();
      this.emit('disconnected', 'Pairing kodu alınamadı');
    }
  }

  /** pairingCode olayını (veya hata) bekler. */
  private waitForPairingCode(timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.pairingCode) { resolve(this.pairingCode); return; }

      const cleanup = () => {
        clearTimeout(timer);
        this.removeListener('pairingCode', onCode);
        this.removeListener('disconnected', onFail);
      };

      const timer = setTimeout(() => {
        cleanup();
        this.resetPairing();
        reject(new Error('Pairing kodu zaman aşımına uğradı, tekrar deneyin'));
      }, timeout);

      const onCode = (code: string) => { cleanup(); resolve(code); };
      const onFail = (reason: string) => { cleanup(); reject(new Error(reason || 'Pairing başlatılamadı')); };

      this.on('pairingCode', onCode);
      this.on('disconnected', onFail);
    });
  }

  private resetPairing(): void {
    this.pairingPhone = null;
    this.pairingCode = null;
    this.pairingCodeRequested = false;
  }

  /**
   * QR kodunu PNG buffer olarak üretir; varsa ortasına yuvarlak logoyu yerleştirir.
   * Hem ekranda gösterilen (base64) hem dosyaya yazılan QR bu tek fonksiyonu kullanır.
   */
  private async composeQrPng(qr: string, qrSize: number, logoBackgroundPadding: number): Promise<Buffer> {
    const qrBuffer = await QRCode.toBuffer(qr, {
      errorCorrectionLevel: 'H',
      type: 'png',
      margin: 2,
      width: qrSize,
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    if (!this.logoExists || !this.cachedLogoBuffer) {
      return qrBuffer;
    }

    const logoSizePercent = 0.16;
    const logoSize = Math.floor(qrSize * logoSizePercent);
    const backgroundSize = logoSize + logoBackgroundPadding * 2;
    const logoPosition = Math.floor((qrSize - logoSize) / 2);
    const backgroundPosition = Math.floor((qrSize - backgroundSize) / 2);

    const circleBackground = Buffer.from(`
      <svg width="${backgroundSize}" height="${backgroundSize}">
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.15"/>
          </filter>
        </defs>
        <circle
          cx="${backgroundSize / 2}"
          cy="${backgroundSize / 2}"
          r="${backgroundSize / 2 - 1}"
          fill="white"
          stroke="#E5E5E5"
          stroke-width="1"
          filter="url(#shadow)"
        />
      </svg>
    `);

    const resizedLogo = await sharp(this.cachedLogoBuffer)
      .resize(logoSize, logoSize, { fit: 'cover', position: 'center' })
      .composite([
        {
          input: Buffer.from(`
            <svg width="${logoSize}" height="${logoSize}">
              <circle cx="${logoSize / 2}" cy="${logoSize / 2}" r="${logoSize / 2}" fill="white"/>
            </svg>
          `),
          blend: 'dest-in',
        },
      ])
      .png()
      .toBuffer();

    return sharp(qrBuffer)
      .composite([
        {
          input: await sharp(circleBackground).png().toBuffer(),
          top: backgroundPosition,
          left: backgroundPosition,
        },
        {
          input: resizedLogo,
          top: logoPosition,
          left: logoPosition,
        },
      ])
      .png()
      .toBuffer();
  }

  private async saveQRToFile(qr: string): Promise<void> {
    try {
      await this.deleteQRFile();
      const qrBuffer = await this.composeQrPng(qr, 300, 8);
      await fs.writeFile(this.qrFilePath, qrBuffer);
      logger.debug({ path: this.qrFilePath }, 'QR code saved to file');
    } catch (error) {
      logger.error({ error }, 'Failed to save QR to file');
    }
  }

  private async deleteQRFile(): Promise<void> {
    try {
      await fs.unlink(this.qrFilePath);
      logger.debug('Old QR file deleted');
    } catch {
    }
  }

  private handleConnectionTimeout(): void {
    logger.warn('Connection timeout reached, cancelling connection attempt');
    this.cancelConnection().catch(() => this.stopConnection('Connection timeout'));
  }

  private stopConnection(reason: string): void {
    this.isCancelled = true;

    if (this.qrTimeout) {
      clearTimeout(this.qrTimeout);
      this.qrTimeout = null;
    }
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    this.state.isConnecting = false;
    this.state.qrCode = null;
    this.qrAttempts = 0;
    this.connectionStartTime = null;
    this.resetPairing();

    this.deleteQRFile();

    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }

    this.emit('disconnected', reason);
    logger.info({ reason }, 'Connection stopped');
  }

  private handleConnectionClose(lastDisconnect: { error: Error | undefined } | undefined): void {
    const wasConnecting = this.state.isConnecting;
    const hadSession = this.sessionInfo !== null;

    this.state.isConnected = false;
    this.state.isConnecting = false;
    this.sessionInfo = null;

    this.stopNotifyReminder();

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    this.deleteQRFile();

    if (this.isCancelled) {
      logger.info('Connection was manually cancelled, not attempting reconnection');
      this.emit('disconnected', 'Connection cancelled by user');
      return;
    }

    const error = lastDisconnect?.error as Boom | undefined;
    const statusCode = error?.output?.statusCode;
    const errorMessage = error?.message || 'Unknown error';

    const isStreamError = statusCode === 515 || errorMessage.includes('Stream Errored');
    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

    logger.info({
      statusCode,
      shouldReconnect,
      isStreamError,
      wasConnecting,
      hadSession,
      errorMessage
    }, 'Connection closed');

    if (statusCode === DisconnectReason.loggedOut) {
      this.isCancelled = true;
      this.resetPairing();
      this.emit('disconnected', 'Logged out');
      this.clearSession();
      return;
    } else if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;

      const baseDelay = isStreamError ? 2000 : 1000;
      const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

      logger.info({
        attempt: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        delay,
        isStreamError
      }, 'Attempting reconnection');

      this.emit('reconnecting', {
        attempt: this.reconnectAttempts,
        delay,
        reason: isStreamError ? 'Stream error - restart required' : 'Connection lost'
      });

      setTimeout(() => {
        this.connect().catch((err) => {
          logger.error({ error: err }, 'Reconnection attempt failed');
          this.emit('disconnected', 'Reconnection failed');
        });
      }, delay);
    } else {
      this.reconnectAttempts = 0;
      this.emit('disconnected', this.reconnectAttempts >= this.maxReconnectAttempts
        ? 'Max reconnection attempts reached'
        : 'Connection failed');
    }
  }

  private handleConnectionOpen(): void {
    this.state.isConnected = true;
    this.state.isConnecting = false;
    this.state.qrCode = null;
    this.state.lastConnected = new Date();
    this.reconnectAttempts = 0;
    this.qrAttempts = 0;
    this.connectionStartTime = null;
    this.resetPairing();
    // Başarılı (yeniden) bağlantı şifreleme sorununu çözer → uyarıyı temizle.
    this.clearEncryptionAlert();

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    if (this.qrTimeout) {
      clearTimeout(this.qrTimeout);
      this.qrTimeout = null;
    }

    this.deleteQRFile();
    logger.debug('QR file cleaned up after successful connection');

    if (this.socket?.user) {
      this.sessionInfo = {
        jid: this.socket.user.id,
        name: this.socket.user.name || '',
        phone: this.socket.user.id.split('@')[0].split(':')[0],
      };
      this.emit('connected', this.sessionInfo);
      logger.info({ session: this.sessionInfo }, 'Connected to WhatsApp');

      logger.info({
        autoRead: settingsService.autoRead,
        notify: settingsService.notify,
      }, 'WhatsApp feature settings');

      this.startNotifyReminder();
    }
  }

  private startNotifyReminder(): void {
    this.stopNotifyReminder();

    if (!settingsService.notify) {
      logger.warn('NOTIFY is disabled - phone will receive WhatsApp notifications. This app will NOT receive notification events.');

      this.notifyReminderInterval = setInterval(() => {
        if (this.state.isConnected && !settingsService.notify) {
          logger.warn({
            reminder: true,
            setting: 'NOTIFY=false',
          }, 'REMINDER: NOTIFY is disabled. WhatsApp may auto-enable notifications. Check your phone notification settings if you stop receiving notifications on phone.');
        }
      }, this.notifyReminderIntervalMs);
    }
  }

  private stopNotifyReminder(): void {
    if (this.notifyReminderInterval) {
      clearInterval(this.notifyReminderInterval);
      this.notifyReminderInterval = null;
    }
  }

  private async handleIncomingCall(call: any): Promise<void> {
    const callerId = call.from;
    const callId = call.id;
    const isVideo = call.isVideo;
    const callRejectEnabled = settingsService.callRejectEnabled;

    logger.info({
      callerId,
      callId,
      isVideo,
      autoReject: callRejectEnabled
    }, 'Incoming call detected');

    if (!callRejectEnabled) {
      logger.debug({ callerId }, 'Auto call reject disabled, call left unanswered');
      return;
    }

    if (!this.socket) {
      logger.warn('Socket connection not available, call could not be rejected');
      return;
    }

    try {
      await this.socket.rejectCall(callId, callerId);
      logger.info({ callerId, callId }, 'Call automatically rejected');
    } catch (error) {
      logger.error({ error, callerId, callId }, 'Call could not be rejected');
    }
  }

  public async sendMessage(jid: string, message: string): Promise<SendMessageResult> {
    if (!this.socket || !this.state.isConnected) {
      return {
        success: false,
        error: 'WhatsApp bağlı değil',
      };
    }

    try {
      const formattedJid = formatJid(jid);
      const result = await this.socket.sendMessage(formattedJid, { text: message });

      // Olası retry-receipt'e cevap verebilmek için içeriği hemen önbelleğe al.
      this.cacheMessage(result?.key.id, result?.message);

      logger.debug({ jid: formattedJid, messageId: result?.key.id }, 'Message sent');

      return {
        success: true,
        messageId: result?.key.id ?? undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
      logger.error({ error, jid }, 'Failed to send message');

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Verilen telefon numaralarının WhatsApp'ta kayıtlı (geçerli profil) olup
   * olmadığını kontrol eder (Baileys `onWhatsApp`). Tek istekte toplu sorgular.
   * Kayıtlı olmayan numaralar `exists:false` döner.
   */
  public async checkNumbers(phones: string[]): Promise<NumberCheckResult[]> {
    if (!this.socket || !this.state.isConnected) {
      throw new Error('WhatsApp bağlı değil');
    }

    // Normalize (yalnız rakam) + tekilleştir.
    const normalized = phones
      .map(p => (p || '').replace(/\D/g, ''))
      .filter(p => p.length >= 10);
    const unique = [...new Set(normalized)];
    if (unique.length === 0) return [];

    const results = await this.socket.onWhatsApp(...unique);

    // Dönen kayıtlı numaraların telefon kısmını jid'lerle eşle.
    const existing = new Map<string, string>(); // phone -> jid
    for (const r of results || []) {
      if (!r?.exists || !r.jid) continue;
      const phone = r.jid.split('@')[0].split(':')[0];
      existing.set(phone, r.jid);
    }

    return unique.map(phone => {
      const jid = existing.get(phone) ?? null;
      return { phone, exists: jid !== null, jid };
    });
  }

  public async gracefulClose(): Promise<void> {
    logger.info('Graceful close initiated - preserving session...');

    this.stopNotifyReminder();

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    if (this.qrTimeout) {
      clearTimeout(this.qrTimeout);
      this.qrTimeout = null;
    }

    if (this.socket) {
      try {
        this.socket.end(undefined);
        logger.info('Socket connection ended gracefully');
      } catch (error) {
        logger.warn({ error }, 'Error during graceful socket close');
      }
      this.socket = null;
    }

    this.state = {
      isConnected: false,
      isConnecting: false,
      qrCode: null,
      lastConnected: this.state.lastConnected,
    };

    await this.deleteQRFile();

    logger.info('Graceful close completed - session preserved');
  }

  public async disconnect(): Promise<void> {
    this.isCancelled = true;
    this.stopNotifyReminder();

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    if (this.qrTimeout) {
      clearTimeout(this.qrTimeout);
      this.qrTimeout = null;
    }

    if (this.socket) {
      try {
        await this.socket.logout();
      } catch (error) {
        logger.warn({ error }, 'Error during logout, forcing disconnect');
      }
      try {
        this.socket.end(undefined);
      } catch { }
      this.socket = null;
    }

    this.state = {
      isConnected: false,
      isConnecting: false,
      qrCode: null,
      lastConnected: null,
    };
    this.sessionInfo = null;
    this.qrAttempts = 0;
    this.reconnectAttempts = 0;
    this.connectionStartTime = null;
    this.resetPairing();

    await this.deleteQRFile();

    await this.clearSession();

    logger.info('Disconnected from WhatsApp and cleaned up session files');
  }

  public async cancelConnection(): Promise<void> {
    if (this.state.isConnected) {
      throw new Error('Cannot cancel: Already connected. Use disconnect() instead.');
    }

    if (!this.state.isConnecting) {
      logger.debug('cancelConnection called but no connection in progress, ignoring');
      return;
    }

    logger.info('Cancelling connection attempt...');

    this.isCancelled = true;

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    if (this.qrTimeout) {
      clearTimeout(this.qrTimeout);
      this.qrTimeout = null;
    }

    if (this.socket) {
      try {
        this.socket.ev.removeAllListeners('connection.update');
        this.socket.ev.removeAllListeners('creds.update');
        this.socket.ev.removeAllListeners('messages.upsert');
        this.socket.ev.removeAllListeners('call');
        this.socket.end(undefined);
      } catch (error) {
        logger.warn({ error }, 'Error closing socket during cancel');
      }
      this.socket = null;
    }
    this.state = {
      isConnected: false,
      isConnecting: false,
      qrCode: null,
      lastConnected: this.state.lastConnected,
    };
    this.qrAttempts = 0;
    this.connectionStartTime = null;
    this.resetPairing();

    await this.deleteQRFile();

    this.emit('disconnected', 'Connection cancelled by user');
    logger.info('Connection attempt cancelled successfully');
  }

  /**
   * Oturumu SİLMEDEN bağlantıyı yeniden kurar (soketi kapat + yeniden bağlan).
   * Şifreleme/oturum sorunlarında ("Mesaj bekleniyor") önerilen çözüm budur;
   * genelde QR'a gerek kalmadan yeniden bağlanır.
   */
  public async reconnect(): Promise<void> {
    logger.info('Manual reconnect requested (encryption recovery)');
    this.clearEncryptionAlert();
    this.isCancelled = false;
    this.reconnectAttempts = 0;

    if (this.socket) {
      try { this.socket.end(undefined); } catch { }
      this.socket = null;
    }
    this.state.isConnected = false;
    this.state.isConnecting = false;

    await this.connect();
  }

  private async clearSession(): Promise<void> {
    try {
      this.messageCache.clear();
      await fs.rm(config.sessionPath, { recursive: true, force: true });
      logger.info('Session files cleared');
    } catch (error) {
      logger.error({ error }, 'Failed to clear session files');
    }
  }

  public getState(): SessionState {
    return { ...this.state };
  }

  public getSessionInfo(): SessionInfo | null {
    return this.sessionInfo ? { ...this.sessionInfo } : null;
  }

  public isReady(): boolean {
    return this.state.isConnected && this.socket !== null;
  }

  /** Telefon (kod) ile bağlanma modunda mıyız? (QR akışı bunu bilmeli.) */
  public isPairingActive(): boolean {
    return this.pairingPhone !== null;
  }

  public getQRFilePath(): string {
    return this.qrFilePath;
  }

  public async qrFileExists(): Promise<boolean> {
    try {
      await fs.access(this.qrFilePath);
      return true;
    } catch {
      return false;
    }
  }

  public getConnectionStats(): {
    isConnected: boolean;
    isConnecting: boolean;
    qrAttempts: number;
    maxQrAttempts: number;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    connectionStartTime: Date | null;
    lastConnected: Date | null;
    sessionInfo: SessionInfo | null;
    encryptionAlert: boolean;
  } {
    return {
      isConnected: this.state.isConnected,
      isConnecting: this.state.isConnecting,
      qrAttempts: this.qrAttempts,
      maxQrAttempts: this.maxQrAttempts,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      connectionStartTime: this.connectionStartTime,
      lastConnected: this.state.lastConnected,
      sessionInfo: this.sessionInfo,
      encryptionAlert: this.encryptionAlert,
    };
  }

  public async sendMedia(jid: string, options: MediaSendOptions): Promise<SendMessageResult> {
    if (!this.socket || !this.state.isConnected) {
      return {
        success: false,
        error: 'WhatsApp bağlı değil',
      };
    }

    const formattedJid = formatJid(jid);
    if (isGroupJid(formattedJid)) {
      return {
        success: false,
        error: 'Gruplara medya gönderilemez',
      };
    }

    try {
      let mediaBuffer: Buffer | undefined;

      if (options.buffer) {
        mediaBuffer = options.buffer;
      } else if (options.base64) {
        mediaBuffer = Buffer.from(options.base64, 'base64');
      } else if (options.url) {
        const response = await fetch(options.url);
        if (!response.ok) {
          return {
            success: false,
            error: `Medya indirilemedi (HTTP ${response.status})`,
          };
        }
        const arrayBuffer = await response.arrayBuffer();
        mediaBuffer = Buffer.from(arrayBuffer);
      }

      if (!mediaBuffer) {
        return {
          success: false,
          error: 'Medya içeriği yok (url, base64 veya buffer gerekli)',
        };
      }

      let messageContent: any;

      switch (options.type) {
        case 'image':
          messageContent = {
            image: mediaBuffer,
            caption: options.caption,
            mimetype: options.mimetype || 'image/jpeg',
          };
          break;
        case 'video':
          messageContent = {
            video: mediaBuffer,
            caption: options.caption,
            mimetype: options.mimetype || 'video/mp4',
          };
          break;
        case 'audio':
          messageContent = {
            audio: mediaBuffer,
            mimetype: options.mimetype || 'audio/mp4',
            ptt: true,
          };
          break;
        case 'document':
          messageContent = {
            document: mediaBuffer,
            mimetype: options.mimetype || 'application/octet-stream',
            fileName: options.fileName || 'document',
            caption: options.caption,
          };
          break;
        case 'sticker':
          messageContent = {
            sticker: mediaBuffer,
            mimetype: options.mimetype || 'image/webp',
          };
          break;
        default:
          return {
            success: false,
            error: `Desteklenmeyen medya türü: ${options.type}`,
          };
      }

      const result = await this.socket.sendMessage(formattedJid, messageContent);

      this.cacheMessage(result?.key.id, result?.message);

      logger.debug({ jid: formattedJid, type: options.type, messageId: result?.key.id }, 'Media sent');

      return {
        success: true,
        messageId: result?.key.id ?? undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
      logger.error({ error, jid }, 'Failed to send media');

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  public async sendPresenceUpdate(jid: string, presence: 'composing' | 'recording' | 'paused'): Promise<void> {
    if (!this.socket || !this.state.isConnected) {
      throw new Error('WhatsApp bağlı değil');
    }

    const formattedJid = formatJid(jid);

    if (isGroupJid(formattedJid)) {
      throw new Error('Gruplar desteklenmiyor');
    }

    try {
      await this.socket.sendPresenceUpdate(presence, formattedJid);
      logger.debug({ jid: formattedJid, presence }, 'Presence updated');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (errorMsg.includes('xml-not-well-formed') || errorMsg.includes('Stream Errored')) {
        logger.warn({ jid: formattedJid, presence, error: errorMsg }, 'Failed to update presence during stream error');
        throw new Error(`Stream Errored: ${errorMsg}`);
      }
      logger.debug({ jid: formattedJid, presence, error: errorMsg }, 'Failed to update presence');
      throw error;
    }
  }

  public override on<K extends keyof WhatsAppEvents>(
    event: K,
    listener: WhatsAppEvents[K]
  ): this {
    return super.on(event, listener);
  }

  public override emit<K extends keyof WhatsAppEvents>(
    event: K,
    ...args: Parameters<WhatsAppEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

export default WhatsAppService.getInstance();
