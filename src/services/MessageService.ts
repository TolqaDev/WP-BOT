import whatsAppService, { MediaSendOptions } from './WhatsAppService';
import logger from '../utils/logger';
import type {
  SendMessageResult,
  IncomingMessage,
  ChatInfo,
  ChatFilters,
  PaginatedResponse,
  SendMessagePayload,
  ContactInfo,
  ProfileInfo,
} from '../types';

class MessageService {
  private static instance: MessageService;
  private messageHistory: Map<string, IncomingMessage[]> = new Map();
  private chatMetadata: Map<string, {
    name: string;
    unreadCount: number;
    isArchived: boolean;
    isPinned: boolean;
    isMuted: boolean;
  }> = new Map();
  private readonly maxHistoryPerChat = 500;

  private constructor() {
    this.setupMessageListener();
  }

  public static getInstance(): MessageService {
    if (!MessageService.instance) {
      MessageService.instance = new MessageService();
    }
    return MessageService.instance;
  }

  private setupMessageListener(): void {
    whatsAppService.on('message', (message: IncomingMessage) => {
      if (message.isGroup) return;
      this.addToHistory(message);
    });
  }

  private addToHistory(message: IncomingMessage): void {
    const jid = message.from;
    if (this.isGroupJid(jid)) return;

    if (!this.messageHistory.has(jid)) {
      this.messageHistory.set(jid, []);
    }

    const history = this.messageHistory.get(jid)!;
    if (!history.some(m => m.id === message.id)) {
      history.push(message);
    }

    if (history.length > this.maxHistoryPerChat) {
      history.shift();
    }

    if (!this.chatMetadata.has(jid)) {
      this.chatMetadata.set(jid, {
        name: message.fromName || '',
        unreadCount: 0,
        isArchived: false,
        isPinned: false,
        isMuted: false,
      });
    }

    if (!message.isFromMe) {
      const metadata = this.chatMetadata.get(jid)!;
      metadata.unreadCount++;
      if (message.fromName) metadata.name = message.fromName;
      this.chatMetadata.set(jid, metadata);
    }

    logger.debug({ jid, messageCount: history.length }, 'Message added to history');
  }

  public addSentMessage(jid: string, messageId: string, content: string, type: string = 'text'): void {
    if (this.isGroupJid(jid)) return;

    const formattedJid = this.formatJid(jid);

    const message: IncomingMessage = {
      id: messageId,
      from: formattedJid,
      fromName: 'Ben',
      content,
      timestamp: new Date(),
      type: type as any,
      isGroup: false,
      isFromMe: true,
      fromMe: true,
      isRead: true,
    };

    this.addToHistory(message);
  }

  private isGroupJid(jid: string): boolean {
    return jid.includes('@g.us') || jid.includes('@broadcast');
  }

  private formatJid(jid: string): string {
    if (jid.includes('@s.whatsapp.net')) {
      const parts = jid.split('@');
      const phone = parts[0].split(':')[0];
      return `${phone}@s.whatsapp.net`;
    }

    if (jid.includes('@g.us')) {
      return jid;
    }

    let cleaned = jid.replace(/[^\d]/g, '');
    cleaned = cleaned.replace(/^0+/, '');

    if (cleaned.length === 10 && !cleaned.startsWith('90')) {
      cleaned = '90' + cleaned;
    }

    return `${cleaned}@s.whatsapp.net`;
  }

  public async sendMessage(payload: SendMessagePayload): Promise<SendMessageResult> {
    const { jid, message, type = 'text', scheduledAt, typingDuration = 3000 } = payload;

    if (this.isGroupJid(jid) || this.isGroupJid(this.formatJid(jid))) {
      return { success: false, error: 'Cannot send messages to group chats' };
    }

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
          scheduledAt,
        });
        return {
          success: true,
          messageId: scheduled.id,
          error: undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to schedule message',
        };
      }
    }

    const maxRetries = 3;
    const retryDelay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (!whatsAppService.isReady()) {
        if (attempt < maxRetries) {
          logger.debug({ attempt, maxRetries }, 'Connection not ready, waiting...');
          await this.waitForConnection(retryDelay * attempt);
          continue;
        }
        return {
          success: false,
          error: 'WhatsApp not connected',
        };
      }

      try {
        try {
          await whatsAppService.sendPresenceUpdate(jid, 'composing');
          await this.delay(Math.min(typingDuration, 2000));
          await whatsAppService.sendPresenceUpdate(jid, 'paused');
        } catch (presenceError) {
          const errorMsg = presenceError instanceof Error ? presenceError.message : '';
          const isStreamError = errorMsg.includes('Stream Errored') || errorMsg.includes('xml-not-well-formed');

          if (isStreamError && attempt < maxRetries) {
            logger.warn({ attempt, error: errorMsg }, 'Stream error, waiting for reconnection...');
            await this.waitForConnection(retryDelay * attempt);
            continue;
          }

          logger.debug({ error: presenceError, jid }, 'Failed to send typing indicator, proceeding with message');
        }

        if (!whatsAppService.isReady()) {
          if (attempt < maxRetries) {
            logger.debug({ attempt }, 'Connection lost, waiting for reconnection...');
            await this.waitForConnection(retryDelay * attempt);
            continue;
          }
          return {
            success: false,
            error: 'WhatsApp connection lost during message send',
          };
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

        if (!result.success && result.error?.includes('not connected')) {
          if (attempt < maxRetries) {
            logger.warn({ attempt, error: result.error }, 'Message send connection error, retrying...');
            await this.waitForConnection(retryDelay * attempt);
            continue;
          }
        }

        if (result.success && result.messageId) {
          const content = type === 'text' ? (message || '') : (payload.caption || `[${type.toUpperCase()}]`);
          this.addSentMessage(jid, result.messageId, content, type);
        }

        return result;

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        const isStreamError = errorMsg.includes('Stream Errored') || errorMsg.includes('xml-not-well-formed');

        if (isStreamError && attempt < maxRetries) {
          logger.warn({ attempt, error: errorMsg }, 'Stream error during message send, retrying...');
          await this.waitForConnection(retryDelay * attempt);
          continue;
        }

        logger.error({ error, jid, attempt }, 'Message send failed');
        return {
          success: false,
          error: errorMsg,
        };
      }
    }

    return {
      success: false,
      error: 'Maximum retry attempts reached',
    };
  }

  private async waitForConnection(timeout: number): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 500;

    while (Date.now() - startTime < timeout) {
      if (whatsAppService.isReady()) {
        logger.debug('Connection ready');
        return true;
      }
      await this.delay(checkInterval);
    }

    logger.warn({ timeout }, 'Connection wait timeout expired');
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public async getMessageHistoryAsync(jid: string, limit = 50, page = 1): Promise<{
    messages: IncomingMessage[];
    total: number;
    page: number;
    totalPages: number;
    source: 'local' | 'store' | 'combined';
  }> {
    if (this.isGroupJid(jid)) {
      return {
        messages: [],
        total: 0,
        page: 1,
        totalPages: 0,
        source: 'local',
      };
    }

    const formattedJid = this.formatJid(jid);
    const localHistory = this.messageHistory.get(formattedJid) || [];

    let storeHistory: IncomingMessage[] = [];
    try {
      storeHistory = whatsAppService.fetchMessageHistory(jid, 500);
    } catch (error) {
      logger.debug({ error, jid }, 'Failed to get store history');
    }

    const combinedMap = new Map<string, IncomingMessage>();

    for (const msg of storeHistory) {
      combinedMap.set(msg.id, msg);
    }

    for (const msg of localHistory) {
      combinedMap.set(msg.id, msg);
    }

    const combined = Array.from(combinedMap.values());
    const sorted = combined.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const total = sorted.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const messages = sorted.slice(startIndex, startIndex + limit);

    return {
      messages,
      total,
      page,
      totalPages,
      source: storeHistory.length > 0 ? (localHistory.length > 0 ? 'combined' : 'store') : 'local',
    };
  }

  public getAllChats(filters?: ChatFilters): PaginatedResponse<ChatInfo> {
    const {
      archived,
      unread,
      read,
      countryCode,
      search,
      startDate,
      endDate,
      sortBy = 'lastMessage',
      sortOrder = 'desc',
      page = 1,
      limit = 20,
    } = filters || {};

    const chatMap = new Map<string, ChatInfo>();

    try {
      const storeChats = whatsAppService.getChatsFromStore();
      if (storeChats && Array.isArray(storeChats)) {
        for (const chat of storeChats) {
          if (!this.isGroupJid(chat.jid)) {
            chatMap.set(chat.jid, chat);
          }
        }
      }
    } catch {
      logger.debug('Failed to get store chats');
    }

    for (const [jid, messages] of this.messageHistory.entries()) {
      if (this.isGroupJid(jid)) {
        continue;
      }

      const metadata = this.chatMetadata.get(jid) || {
        name: '',
        unreadCount: 0,
        isArchived: false,
        isPinned: false,
        isMuted: false,
      };

      const lastMessage = messages[messages.length - 1] || null;
      const phone = jid.split('@')[0].split(':')[0];
      const extractedCountryCode = whatsAppService.extractCountryCode(phone);

      const chatInfo: ChatInfo = {
        jid,
        name: metadata.name || lastMessage?.fromName || phone,
        phone,
        lastMessage,
        messageCount: messages.length,
        unreadCount: metadata.unreadCount,
        isArchived: metadata.isArchived,
        isPinned: metadata.isPinned,
        isMuted: metadata.isMuted,
        lastMessageAt: lastMessage?.timestamp || null,
        countryCode: extractedCountryCode || undefined,
      };

      const existing = chatMap.get(jid);
      if (!existing || (chatInfo.lastMessageAt && (!existing.lastMessageAt || chatInfo.lastMessageAt > existing.lastMessageAt))) {
        chatMap.set(jid, chatInfo);
      }
    }

    let chats = Array.from(chatMap.values());

    if (archived !== undefined) {
      chats = chats.filter(c => c.isArchived === archived);
    }

    if (unread === true) {
      chats = chats.filter(c => c.unreadCount > 0);
    }

    if (read === true) {
      chats = chats.filter(c => c.unreadCount === 0);
    }

    if (countryCode) {
      const normalizedCode = countryCode.startsWith('+') ? countryCode : `+${countryCode}`;
      chats = chats.filter(c => c.countryCode === normalizedCode);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      chats = chats.filter(c =>
        c.name.toLowerCase().includes(searchLower) ||
        c.phone.includes(search) ||
        c.lastMessage?.content.toLowerCase().includes(searchLower)
      );
    }

    if (startDate) {
      const start = new Date(startDate);
      chats = chats.filter(c => c.lastMessageAt && c.lastMessageAt >= start);
    }

    if (endDate) {
      const end = new Date(endDate);
      chats = chats.filter(c => c.lastMessageAt && c.lastMessageAt <= end);
    }

    chats.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;

      let comparison = 0;

      switch (sortBy) {
        case 'lastMessage':
          const timeA = a.lastMessageAt?.getTime() || 0;
          const timeB = b.lastMessageAt?.getTime() || 0;
          comparison = timeB - timeA;
          break;
        case 'unread':
          comparison = b.unreadCount - a.unreadCount;
          break;
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
      }

      return sortOrder === 'desc' ? comparison : -comparison;
    });

    const total = chats.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const items = chats.slice(startIndex, startIndex + limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  public async markChatAsRead(jid: string): Promise<void> {
    if (this.isGroupJid(jid)) {
      return;
    }

    const formattedJid = this.formatJid(jid);
    const metadata = this.chatMetadata.get(formattedJid);

    if (metadata) {
      metadata.unreadCount = 0;
      this.chatMetadata.set(formattedJid, metadata);
    }

    const history = this.messageHistory.get(formattedJid);
    if (history) {
      for (const msg of history) {
        msg.isRead = true;
      }
    }

    try {
      await whatsAppService.markMessagesAsRead(formattedJid);
      logger.debug({ jid: formattedJid }, 'Messages marked as read');
    } catch (error) {
      logger.debug({ error, jid: formattedJid }, 'Failed to send WhatsApp read receipt');
    }
  }

  public async isOnWhatsApp(phone: string): Promise<ContactInfo | null> {
    return whatsAppService.isOnWhatsApp(phone);
  }

  public async getProfileInfo(jid: string): Promise<ProfileInfo | null> {
    if (this.isGroupJid(jid)) throw new Error('Group profiles are not supported');
    return whatsAppService.getProfileInfo(jid);
  }

  public async sendTyping(jid: string, duration = 3000): Promise<void> {
    if (this.isGroupJid(jid)) throw new Error('Group profiles not supported');

    await whatsAppService.sendPresenceUpdate(jid, 'composing');
    setTimeout(async () => {
      try { await whatsAppService.sendPresenceUpdate(jid, 'paused'); } catch { /* ignore */ }
    }, duration);
  }

  public async sendPresenceUpdate(jid: string, type: 'composing' | 'paused'): Promise<void> {
    if (this.isGroupJid(jid)) throw new Error('Group profiles not supported');
    await whatsAppService.sendPresenceUpdate(jid, type);
  }

  public getChatStats(): {
    totalChats: number;
    totalMessages: number;
    unreadChats: number;
    archivedChats: number;
    pinnedChats: number;
  } {
    let totalChats = 0;
    let totalMessages = 0;
    let unreadChats = 0;
    let archivedChats = 0;
    let pinnedChats = 0;

    for (const [jid, messages] of this.messageHistory.entries()) {
      if (this.isGroupJid(jid)) continue;

      totalChats++;
      totalMessages += messages.length;

      const metadata = this.chatMetadata.get(jid);
      if (metadata) {
        if (metadata.unreadCount > 0) unreadChats++;
        if (metadata.isArchived) archivedChats++;
        if (metadata.isPinned) pinnedChats++;
      }
    }

    return {
      totalChats,
      totalMessages,
      unreadChats,
      archivedChats,
      pinnedChats,
    };
  }

  public getCacheStats(): {
    messageHistory: { chats: number; totalMessages: number };
    chatMetadata: number;
    scheduledMessages: number;
  } {
    let totalMessages = 0;
    for (const messages of this.messageHistory.values()) {
      totalMessages += messages.length;
    }

    return {
      messageHistory: {
        chats: this.messageHistory.size,
        totalMessages
      },
      chatMetadata: this.chatMetadata.size,
      scheduledMessages: 0
    };
  }

  public clearAllCaches(): {
    clearedChats: number;
    clearedMessages: number;
    clearedMetadata: number;
  } {
    const clearedChats = this.messageHistory.size;
    let clearedMessages = 0;
    for (const messages of this.messageHistory.values()) {
      clearedMessages += messages.length;
    }
    const clearedMetadata = this.chatMetadata.size;

    this.messageHistory.clear();
    this.chatMetadata.clear();

    logger.info({ clearedChats, clearedMessages, clearedMetadata }, 'All caches cleared');
    return { clearedChats, clearedMessages, clearedMetadata };
  }

  public clearChatCache(jid: string): {
    clearedMessages: number;
    jid: string;
  } {
    const formattedJid = this.formatJid(jid);
    const messages = this.messageHistory.get(formattedJid) || [];
    const clearedMessages = messages.length;

    this.messageHistory.delete(formattedJid);
    this.chatMetadata.delete(formattedJid);

    logger.info({
      jid: formattedJid,
      clearedMessages
    }, 'Chat cache cleared');

    return {
      clearedMessages,
      jid: formattedJid
    };
  }
}

export default MessageService.getInstance();

