import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
  ConnectionState,
  MessageUpsertType,
  proto,
  Chat,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { EventEmitter } from 'events';
import QRCode from 'qrcode';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import config from '../config';
import logger from '../utils/logger';
import settingsService from './SettingsService';
import type {
  SessionState,
  SessionInfo,
  IncomingMessage,
  SendMessageResult,
  WhatsAppEvents,
  ChatInfo,
  ContactInfo,
  ProfileInfo,
  MessageType,
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

interface MessageStore {
  chats: Map<string, Chat>;
  messages: Map<string, proto.IWebMessageInfo[]>;
}

class WhatsAppService extends EventEmitter {
  private static instance: WhatsAppService;
  private socket: WASocket | null = null;
  private store: MessageStore = {
    chats: new Map(),
    messages: new Map(),
  };
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
  private readonly connectionTimeoutMs = 120000;
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
  }

  /**
   * Pre-load and cache logo for QR generation performance
   */
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

  /**
   * Check if a saved session exists
   */
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

  /**
   * Auto-connect if session exists
   * Called on application startup
   */
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

    // Eski socket varsa temizle
    if (this.socket) {
      logger.debug('Cleaning up old socket before new connection');
      try {
        this.socket.end(undefined);
      } catch (e) {
        // Socket zaten kapalı olabilir
      }
      this.socket = null;
    }

    this.state.isConnecting = true;
    this.qrAttempts = 0;
    this.connectionStartTime = new Date();
    this.isCancelled = false; // Reset cancel flag on new connection attempt

    // Set connection timeout
    this.connectionTimeout = setTimeout(() => {
      this.handleConnectionTimeout();
    }, this.connectionTimeoutMs);

    try {
      await fs.mkdir(path.dirname(this.qrFilePath), { recursive: true });

      const { state: authState, saveCreds } = await useMultiFileAuthState(config.sessionPath);
      const { version } = await fetchLatestBaileysVersion();

      logger.info({ version }, 'Using Baileys version');

      this.store = {
        chats: new Map(),
        messages: new Map(),
      };

      this.socket = makeWASocket({
        version,
        auth: {
          creds: authState.creds,
          keys: makeCacheableSignalKeyStore(authState.keys, logger),
        },
        printQRInTerminal: false,
        logger,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: config.whatsapp.notify,
        syncFullHistory: true,
        fireInitQueries: true,
        shouldIgnoreJid: (jid) => !jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast'),
        retryRequestDelayMs: 250,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        emitOwnEvents: true,
        getMessage: async (key) => {
          try {
            const messages = this.store.messages.get(key.remoteJid!);
            if (messages) {
              const msg = messages.find(m => m.key.id === key.id);
              return msg?.message || undefined;
            }
          } catch (e) {
            logger.debug({ error: e }, 'getMessage error');
          }
          return undefined;
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
          this.handleQRCode(qr);
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

    this.socket.ev.on('chats.upsert', (chats: Chat[]) => {
      for (const chat of chats) {
        if (chat.id.endsWith('@g.us') || chat.id.endsWith('@broadcast')) continue;
        this.store.chats.set(chat.id, chat);
      }
      logger.debug({ count: chats.length }, 'Chats received from WhatsApp');
    });

    this.socket.ev.on('chats.update', (updates: Partial<Chat>[]) => {
      for (const update of updates) {
        if (!update.id) continue;
        if (update.id.endsWith('@g.us') || update.id.endsWith('@broadcast')) continue;
        const existing = this.store.chats.get(update.id);
        if (existing) {
          this.store.chats.set(update.id, { ...existing, ...update } as Chat);
        }
      }
    });

    this.socket.ev.on('messages.upsert', async (m: { messages: proto.IWebMessageInfo[]; type: MessageUpsertType }) => {
      try {
        for (const msg of m.messages) {
          let jid: string | null | undefined = msg.key.remoteJid;
          if (!jid) continue;

          if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) continue;

          // LID kontrolü - @lid ile biten JID'ler için senderPn kullan
          const isLID = jid.endsWith('@lid');
          const msgKey = msg.key as any;

          if (isLID || msgKey.senderPn) {
            if (msgKey.senderPn) {
              // senderPn formatı: "905330886108@s.whatsapp.net"
              jid = msgKey.senderPn as string;
            } else if (msg.key.participant) {
              // Fallback: participant kullan
              jid = msg.key.participant;
            }
          }

          // JID kontrolü ve formatlama
          if (!jid) continue;
          const formattedJid = this.formatJid(jid);

          if (!this.store.messages.has(formattedJid)) {
            this.store.messages.set(formattedJid, []);
          }
          const messages = this.store.messages.get(formattedJid)!;

          const exists = messages.some(m => m.key.id === msg.key.id);
          if (!exists) {
            messages.push(msg);
            if (messages.length > 500) {
              messages.shift();
            }
          }
        }

        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
          if (msg.key.fromMe) continue;

          if (settingsService.autoRead && this.socket && msg.key.remoteJid) {
            try {
              await this.socket.readMessages([msg.key]);
              logger.debug({ jid: msg.key.remoteJid }, 'Message auto-marked as read');
            } catch (error) {
              logger.warn({ error, jid: msg.key.remoteJid }, 'Failed to auto-mark message as read');
            }
          }

          const incomingMessage = this.parseIncomingMessage(msg);
          if (incomingMessage) {
            this.emit('message', incomingMessage);
            logger.debug({ from: incomingMessage.from, fromName: incomingMessage.fromName }, 'New message received');
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
        logger.warn({ attempts: this.qrAttempts }, 'Max QR attempts reached, stopping connection');
        this.stopConnection('Max QR attempts reached');
        return;
      }

      if (this.qrTimeout) {
        clearTimeout(this.qrTimeout);
      }

      await this.saveQRToFile(qr);

      const qrBase64 = await this.generateQRBase64WithLogo(qr);

      this.state.qrCode = qrBase64;
      this.emit('qr', qrBase64);
      logger.info({ attempt: this.qrAttempts, maxAttempts: this.maxQrAttempts }, 'New QR code generated');

      this.qrTimeout = setTimeout(() => {
        this.state.qrCode = null;
        this.deleteQRFile();
        logger.debug('QR code expired');
      }, 60000);
    } catch (error) {
      logger.error({ error }, 'Failed to generate QR code');
    }
  }

  private async generateQRBase64WithLogo(qr: string): Promise<string> {
    const qrSize = 256;
    const logoSizePercent = 0.22;
    const logoBackgroundPadding = 8;

    const qrBuffer = await QRCode.toBuffer(qr, {
      errorCorrectionLevel: 'H',
      type: 'png',
      margin: 2,
      width: qrSize,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    if (this.logoExists && this.cachedLogoBuffer) {
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
        .resize(logoSize, logoSize, {
          fit: 'cover',
          position: 'center',
        })
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

      const compositeBuffer = await sharp(qrBuffer)
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

      return `data:image/png;base64,${compositeBuffer.toString('base64')}`;
    }

    return `data:image/png;base64,${qrBuffer.toString('base64')}`;
  }

  private async saveQRToFile(qr: string): Promise<void> {
    try {
      await this.deleteQRFile();

      const qrSize = 300;
      const logoSizePercent = 0.22;
      const logoBackgroundPadding = 10;

      const qrBuffer = await QRCode.toBuffer(qr, {
        errorCorrectionLevel: 'H',
        type: 'png',
        margin: 2,
        width: qrSize,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });

      if (this.logoExists && this.cachedLogoBuffer) {
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
          .resize(logoSize, logoSize, {
            fit: 'cover',
            position: 'center',
          })
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

        await sharp(qrBuffer)
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
          .toFile(this.qrFilePath);

        logger.debug({ path: this.qrFilePath }, 'QR code with logo saved to file');
      } else {
        await fs.writeFile(this.qrFilePath, qrBuffer);
        logger.debug({ path: this.qrFilePath }, 'QR code saved to file (no logo found)');
      }
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
    logger.warn('Connection timeout reached, stopping connection attempt');
    this.stopConnection('Connection timeout');
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

    // Stream Error 515 - WhatsApp sunucu tarafından restart istiyor
    const isStreamError = statusCode === 515 || errorMessage.includes('Stream Errored');

    // Sadece loggedOut durumunda yeniden bağlanma
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
      this.emit('disconnected', 'Logged out');
      this.clearSession();
    } else if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;

      // Stream error için daha kısa bekleme süresi
      const baseDelay = isStreamError ? 2000 : 1000;
      const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

      logger.info({
        attempt: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        delay,
        isStreamError
      }, 'Attempting reconnection');

      // Emit reconnecting event so UI can show appropriate status
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
      // Max attempts reached or should not reconnect
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
    }, 'Gelen arama algılandı');

    if (!callRejectEnabled) {
      logger.debug({ callerId }, 'Otomatik arama reddi devre dışı, arama yanıtsız bırakılıyor');
      return;
    }

    if (!this.socket) {
      logger.warn('Socket bağlantısı yok, arama reddedilemedi');
      return;
    }

    try {
      // Reject the call
      await this.socket.rejectCall(callId, callerId);
      logger.info({ callerId, callId }, 'Arama otomatik olarak reddedildi');
    } catch (error) {
      logger.error({ error, callerId, callId }, 'Arama reddedilemedi');
    }
  }


  private parseIncomingMessage(msg: proto.IWebMessageInfo): IncomingMessage | null {
    try {
      const messageContent = msg.message;
      if (!messageContent) return null;

      let content = '';
      let type: IncomingMessage['type'] = 'text';

      if (messageContent.conversation) {
        content = messageContent.conversation;
      } else if (messageContent.extendedTextMessage?.text) {
        content = messageContent.extendedTextMessage.text;
      } else if (messageContent.imageMessage) {
        content = messageContent.imageMessage.caption || '[Image]';
        type = 'image';
      } else if (messageContent.videoMessage) {
        content = messageContent.videoMessage.caption || '[Video]';
        type = 'video';
      } else if (messageContent.audioMessage) {
        content = '[Audio]';
        type = 'audio';
      } else if (messageContent.documentMessage) {
        content = messageContent.documentMessage.fileName || '[Document]';
        type = 'document';
      }

      // JID'yi doğru şekilde çıkar
      // remoteJid bazen LID (Linked ID) olabilir - @lid ile biter
      // Gerçek numara senderPn alanında bulunur
      let jid = msg.key.remoteJid || '';
      const isGroup = jid.endsWith('@g.us');
      const isFromMe = msg.key.fromMe === true;
      const isLID = jid.endsWith('@lid');

      // senderPn alanı varsa (gerçek telefon numarası) onu kullan
      const msgKey = msg.key as any;
      if (!isFromMe && (isLID || msgKey.senderPn)) {
        if (msgKey.senderPn) {
          // senderPn formatı: "905330886108@s.whatsapp.net"
          jid = msgKey.senderPn;
          logger.debug({
            originalJid: msg.key.remoteJid,
            senderPn: msgKey.senderPn,
            pushName: msg.pushName
          }, 'LID tespit edildi, senderPn kullanılıyor');
        } else if (msg.key.participant) {
          // Fallback: participant kullan
          jid = msg.key.participant;
          logger.debug({
            originalJid: msg.key.remoteJid,
            participant: msg.key.participant,
            pushName: msg.pushName
          }, 'LID tespit edildi, participant kullanılıyor');
        }
      }

      // JID'yi temizle ve formatla
      const cleanJid = this.formatJid(jid);

      logger.debug({
        originalRemoteJid: msg.key.remoteJid,
        senderPn: msgKey.senderPn,
        participant: msg.key.participant,
        finalJid: cleanJid,
        pushName: msg.pushName,
        isLID,
        isFromMe
      }, 'Mesaj JID analizi');


      return {
        id: msg.key.id || '',
        from: cleanJid,
        fromName: isFromMe ? 'Ben' : (msg.pushName || ''),
        content,
        timestamp: new Date(Number(msg.messageTimestamp || 0) * 1000),
        type,
        isGroup,
        isFromMe,
        fromMe: isFromMe,
      };
    } catch (error) {
      logger.error({ error }, 'parseIncomingMessage hatası');
      return null;
    }
  }

  public async sendMessage(jid: string, message: string): Promise<SendMessageResult> {
    if (!this.socket || !this.state.isConnected) {
      return {
        success: false,
        error: 'Not connected to WhatsApp',
      };
    }

    try {
      const formattedJid = this.formatJid(jid);
      const result = await this.socket.sendMessage(formattedJid, { text: message });

      logger.debug({ jid: formattedJid, messageId: result?.key.id }, 'Message sent');

      return {
        success: true,
        messageId: result?.key.id ?? undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, jid }, 'Failed to send message');

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private formatJid(jid: string): string {
    // Önce JID zaten doğru formatta mı kontrol et
    if (jid.includes('@s.whatsapp.net')) {
      // JID'den sadece numara ve domain kısmını al (device ID'yi kaldır)
      const parts = jid.split('@');
      const phone = parts[0].split(':')[0]; // 905079249858:10 -> 905079249858
      return `${phone}@s.whatsapp.net`;
    }

    if (jid.includes('@g.us')) {
      return jid; // Grup JID'lerini olduğu gibi döndür
    }

    // Telefon numarasını normalleştir
    // "+90 533 088 61 08", "++90 533 088 61 08", "5330886108" gibi formatları destekle
    let cleaned = jid.replace(/[^\d]/g, ''); // Sadece rakamları tut

    // Başındaki sıfırları kaldır
    cleaned = cleaned.replace(/^0+/, '');

    // 10 haneli numara ve 90 ile başlamıyorsa, Türkiye kodu ekle
    if (cleaned.length === 10 && !cleaned.startsWith('90')) {
      cleaned = '90' + cleaned;
    }

    return `${cleaned}@s.whatsapp.net`;
  }

  /**
   * Graceful close - Preserves session for restart
   * Used during PM2/process shutdown
   * Does NOT logout or clear session files
   */
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
        // Just end the socket connection without logging out
        // This preserves the session credentials for next startup
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
      lastConnected: this.state.lastConnected, // Preserve last connected time
    };

    await this.deleteQRFile();

    logger.info('Graceful close completed - session preserved for next startup');
  }

  /**
   * Full disconnect - Logs out and clears session
   * Used when user clicks "Logout" button
   */
  public async disconnect(): Promise<void> {
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

    await this.deleteQRFile();

    await this.clearSession();

    logger.info('Disconnected from WhatsApp and cleaned up session files');
  }

  public async cancelConnection(): Promise<void> {
    if (this.state.isConnected) {
      throw new Error('Cannot cancel: Already connected. Use disconnect() instead.');
    }

    if (!this.state.isConnecting) {
      throw new Error('No connection attempt in progress');
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

    await this.deleteQRFile();

    this.emit('disconnected', 'Connection cancelled by user');
    logger.info('Connection attempt cancelled successfully');
  }

  private async clearSession(): Promise<void> {
    try {
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
    };
  }

  public isGroupJid(jid: string): boolean {
    return jid.includes('@g.us') || jid.includes('@broadcast');
  }

  public async sendMedia(jid: string, options: MediaSendOptions): Promise<SendMessageResult> {
    if (!this.socket || !this.state.isConnected) {
      return {
        success: false,
        error: 'WhatsApp bağlantısı yok',
      };
    }

    const formattedJid = this.formatJid(jid);
    if (this.isGroupJid(formattedJid)) {
      return {
        success: false,
        error: 'Grup sohbetlerine medya gönderilemez',
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
          throw new Error(`Medya URL'den indirilemedi: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        mediaBuffer = Buffer.from(arrayBuffer);
      }

      if (!mediaBuffer) {
        return {
          success: false,
          error: 'Medya içeriği bulunamadı (url, base64 veya buffer gerekli)',
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
            ptt: true, // Voice message
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
            error: `Desteklenmeyen medya tipi: ${options.type}`,
          };
      }

      const result = await this.socket.sendMessage(formattedJid, messageContent);

      logger.debug({ jid: formattedJid, type: options.type, messageId: result?.key.id }, 'Medya gönderildi');

      return {
        success: true,
        messageId: result?.key.id ?? undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
      logger.error({ error, jid }, 'Medya gönderilemedi');

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Check if a phone number is registered on WhatsApp
   */
  public async isOnWhatsApp(phone: string): Promise<ContactInfo | null> {
    if (!this.socket || !this.state.isConnected) {
      throw new Error('WhatsApp bağlantısı yok');
    }

    try {
      const cleaned = phone.replace(/[^\d]/g, '');
      const results = await this.socket.onWhatsApp(cleaned);

      if (results && results.length > 0 && results[0].exists) {
        const result = results[0];
        const jid = result.jid;
        const phoneNumber = jid.split('@')[0].split(':')[0];

        return {
          jid,
          name: '',
          phone: phoneNumber,
          isOnWhatsApp: true,
        };
      }

      return {
        jid: '',
        name: '',
        phone: cleaned,
        isOnWhatsApp: false,
      };
    } catch (error) {
      logger.error({ error, phone }, 'WhatsApp kontrol hatası');
      throw error;
    }
  }

  public async getProfileInfo(jid: string): Promise<ProfileInfo | null> {
    if (!this.socket || !this.state.isConnected) {
      throw new Error('WhatsApp bağlantısı yok');
    }

    const formattedJid = this.formatJid(jid);

    if (this.isGroupJid(formattedJid)) {
      throw new Error('Grup profilleri desteklenmiyor');
    }

    const phone = formattedJid.split('@')[0].split(':')[0];
    let profilePicUrl: string | undefined;

    try {
      const ppUrl = await this.socket.profilePictureUrl(formattedJid, 'image');
      profilePicUrl = ppUrl || undefined;
    } catch {
    }

    let status: string | undefined;
    try {
      const statusResult = await this.socket.fetchStatus(formattedJid);
      if (statusResult && Array.isArray(statusResult) && statusResult.length > 0) {
        status = (statusResult[0] as any)?.status?.status || undefined;
      } else if (statusResult && typeof statusResult === 'object') {
        status = (statusResult as any)?.status || undefined;
      }
    } catch {
    }

    return {
      jid: formattedJid,
      name: '',
      phone,
      profilePicUrl,
      status,
    };
  }

  public async sendPresenceUpdate(jid: string, presence: 'composing' | 'recording' | 'paused'): Promise<void> {
    if (!this.socket || !this.state.isConnected) {
      throw new Error('WhatsApp bağlantısı yok');
    }

    const formattedJid = this.formatJid(jid);

    if (this.isGroupJid(formattedJid)) {
      throw new Error('Grup sohbetleri desteklenmiyor');
    }

    try {
      await this.socket.sendPresenceUpdate(presence, formattedJid);
      logger.debug({ jid: formattedJid, presence }, 'Presence güncellendi');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      // Stream error durumunda özel hata fırlat
      if (errorMsg.includes('xml-not-well-formed') || errorMsg.includes('Stream Errored')) {
        logger.warn({ jid: formattedJid, presence, error: errorMsg }, 'Stream hatası sırasında presence güncellenemedi');
        throw new Error(`Stream Errored: ${errorMsg}`);
      }
      // Diğer hatalarda log'la ve devam et
      logger.debug({ jid: formattedJid, presence, error: errorMsg }, 'Presence güncellenemedi');
      throw error;
    }
  }

  public async deleteMessage(jid: string, messageId: string, forEveryone = true): Promise<SendMessageResult> {
    if (!this.socket || !this.state.isConnected) {
      return {
        success: false,
        error: 'WhatsApp bağlantısı yok',
      };
    }

    try {
      const formattedJid = this.formatJid(jid);

      if (this.isGroupJid(formattedJid)) {
        return {
          success: false,
          error: 'Grup sohbetleri desteklenmiyor',
        };
      }

      const key = {
        remoteJid: formattedJid,
        id: messageId,
        fromMe: true,
      };

      await this.socket.sendMessage(formattedJid, { delete: key });

      logger.info({ jid: formattedJid, messageId, forEveryone }, 'Mesaj silindi');

      return {
        success: true,
        messageId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
      logger.error({ error, jid, messageId }, 'Mesaj silinemedi');

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get all chats from WhatsApp store
   */
  public getChatsFromStore(): ChatInfo[] {
    if (!this.socket || !this.state.isConnected) {
      return [];
    }

    const chats: ChatInfo[] = [];

    for (const [chatId, chat] of this.store.chats.entries()) {
      if (this.isGroupJid(chatId)) {
        continue;
      }

      const phone = chatId.split('@')[0].split(':')[0];
      const countryCode = this.extractCountryCode(phone);

      const messages = this.store.messages.get(chatId) || [];
      let lastMessage: IncomingMessage | null = null;
      const messageCount = messages.length;

      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        lastMessage = this.parseIncomingMessage(lastMsg);
      }

      chats.push({
        jid: chatId,
        name: (chat as any).name || (chat as any).notify || phone,
        phone,
        lastMessage,
        messageCount,
        unreadCount: (chat as any).unreadCount || 0,
        isArchived: (chat as any).archived || false,
        isPinned: !!(chat as any).pinned,
        isMuted: !!(chat as any).mute,
        lastMessageAt: lastMessage?.timestamp || null,
        countryCode: countryCode || undefined,
      });
    }

    return chats.sort((a, b) => {
      const timeA = a.lastMessageAt?.getTime() || 0;
      const timeB = b.lastMessageAt?.getTime() || 0;
      return timeB - timeA;
    });
  }

  /**
   * Fetch message history from WhatsApp store
   */
  public fetchMessageHistory(
    jid: string,
    limit = 50
  ): IncomingMessage[] {
    const formattedJid = this.formatJid(jid);

    if (this.isGroupJid(formattedJid)) {
      return [];
    }

    const messages: IncomingMessage[] = [];
    const storeMessages = this.store.messages.get(formattedJid) || [];

    const startIndex = Math.max(0, storeMessages.length - limit);
    const sliced = storeMessages.slice(startIndex);

    for (const msg of sliced) {
      if (msg.key.remoteJid?.endsWith('@g.us')) continue;

      const parsed = this.parseIncomingMessage(msg);
      if (parsed) {
        messages.push(parsed);
      }
    }

    logger.debug({ jid: formattedJid, count: messages.length, limit }, 'Mesaj geçmişi store\'dan alındı');

    return messages.reverse();
  }

  public async archiveChat(jid: string, archive: boolean): Promise<void> {
    if (!this.socket || !this.state.isConnected) {
      throw new Error('WhatsApp bağlantısı yok');
    }

    const formattedJid = this.formatJid(jid);

    if (this.isGroupJid(formattedJid)) {
      throw new Error('Grup sohbetleri desteklenmiyor');
    }

    logger.info({ jid: formattedJid, archive }, 'Sohbet arşiv durumu değiştirildi (yerel)');
  }

  public async muteChat(jid: string, mute: boolean, duration?: number): Promise<void> {
    if (!this.socket || !this.state.isConnected) {
      throw new Error('WhatsApp bağlantısı yok');
    }

    const formattedJid = this.formatJid(jid);

    if (this.isGroupJid(formattedJid)) {
      throw new Error('Grup sohbetleri desteklenmiyor');
    }

    logger.info({ jid: formattedJid, mute, duration }, 'Sohbet sessiz durumu değiştirildi (yerel)');
  }

  public async pinChat(jid: string, pin: boolean): Promise<void> {
    if (!this.socket || !this.state.isConnected) {
      throw new Error('WhatsApp bağlantısı yok');
    }

    const formattedJid = this.formatJid(jid);

    if (this.isGroupJid(formattedJid)) {
      throw new Error('Grup sohbetleri desteklenmiyor');
    }

    logger.info({ jid: formattedJid, pin }, 'Sohbet sabitleme durumu değiştirildi (yerel)');
  }

  /**
   * Mark all unread messages from a JID as read
   * Sends read receipt to WhatsApp
   */
  public async markMessagesAsRead(jid: string): Promise<void> {
    if (!this.socket || !this.state.isConnected) {
      throw new Error('WhatsApp bağlantısı yok');
    }

    const formattedJid = this.formatJid(jid);

    if (this.isGroupJid(formattedJid)) {
      return;
    }

    // Get unread messages from store
    const messages = this.store.messages.get(formattedJid) || [];
    const unreadKeys: { remoteJid: string; id: string; participant?: string }[] = [];

    for (const msg of messages) {
      // Only mark incoming messages (not fromMe)
      if (!msg.key.fromMe && msg.key.id) {
        unreadKeys.push({
          remoteJid: formattedJid,
          id: msg.key.id,
        });
      }
    }

    if (unreadKeys.length > 0) {
      try {
        // Send read receipt for the latest messages
        const latestKeys = unreadKeys.slice(-10); // Son 10 mesaj
        for (const key of latestKeys) {
          await this.socket.readMessages([{
            remoteJid: key.remoteJid,
            id: key.id,
            fromMe: false,
          }]);
        }
        logger.debug({ jid: formattedJid, count: latestKeys.length }, 'Mesajlar okundu olarak işaretlendi');
      } catch (error) {
        logger.debug({ error, jid: formattedJid }, 'Okundu bildirimi gönderilemedi');
      }
    }
  }

  public extractCountryCode(phone: string): string | null {
    const digits = phone.replace(/\D/g, '');

    const countryCodes = [
      { code: '90', country: 'TR' },
      { code: '1', country: 'US' },
      { code: '44', country: 'GB' },
      { code: '49', country: 'DE' },
      { code: '33', country: 'FR' },
      { code: '39', country: 'IT' },
      { code: '34', country: 'ES' },
      { code: '31', country: 'NL' },
      { code: '32', country: 'BE' },
      { code: '41', country: 'CH' },
      { code: '43', country: 'AT' },
      { code: '7', country: 'RU' },
      { code: '86', country: 'CN' },
      { code: '81', country: 'JP' },
      { code: '82', country: 'KR' },
      { code: '91', country: 'IN' },
      { code: '55', country: 'BR' },
      { code: '52', country: 'MX' },
      { code: '61', country: 'AU' },
      { code: '971', country: 'AE' },
      { code: '966', country: 'SA' },
      { code: '20', country: 'EG' },
      { code: '27', country: 'ZA' },
      { code: '234', country: 'NG' },
    ];

    const sortedCodes = countryCodes.sort((a, b) => b.code.length - a.code.length);

    for (const { code } of sortedCodes) {
      if (digits.startsWith(code)) {
        return `+${code}`;
      }
    }

    return null;
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
