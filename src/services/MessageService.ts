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
  private readonly maxHistoryPerChat = 500; // Increased for better history

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
      // Skip group messages
      if (message.isGroup) {
        logger.debug({ from: message.from }, 'Grup mesajı atlandı');
        return;
      }
      this.addToHistory(message);
    });
  }

  private addToHistory(message: IncomingMessage): void {
    const jid = message.from;

    // Skip group chats
    if (this.isGroupJid(jid)) {
      return;
    }

    if (!this.messageHistory.has(jid)) {
      this.messageHistory.set(jid, []);
    }

    const history = this.messageHistory.get(jid)!;

    // Avoid duplicates
    const exists = history.some(m => m.id === message.id);
    if (!exists) {
      history.push(message);
    }

    // Keep only the last N messages
    if (history.length > this.maxHistoryPerChat) {
      history.shift();
    }

    // Update chat metadata
    if (!this.chatMetadata.has(jid)) {
      this.chatMetadata.set(jid, {
        name: message.fromName || '',
        unreadCount: 0,
        isArchived: false,
        isPinned: false,
        isMuted: false,
      });
    }

    // Increment unread count for incoming messages
    if (!message.isFromMe) {
      const metadata = this.chatMetadata.get(jid)!;
      metadata.unreadCount++;
      if (message.fromName) {
        metadata.name = message.fromName;
      }
      this.chatMetadata.set(jid, metadata);
    }

    logger.debug({ jid, messageCount: history.length }, 'Mesaj geçmişe eklendi');
  }

  /**
   * Add a sent message to history
   */
  public addSentMessage(jid: string, messageId: string, content: string, type: string = 'text'): void {
    // Skip group chats
    if (this.isGroupJid(jid)) {
      return;
    }

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
      fromMe: true,  // Client compatibility
      isRead: true,
    };

    this.addToHistory(message);
  }

  private isGroupJid(jid: string): boolean {
    return jid.includes('@g.us') || jid.includes('@broadcast');
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
   * Send a message (text or media) with typing indicator
   * If scheduledAt is provided, the message will be scheduled instead of sent immediately
   */
  public async sendMessage(payload: SendMessagePayload): Promise<SendMessageResult> {
    const { jid, message, type = 'text', scheduledAt, typingDuration = 3000 } = payload;

    // Check for group JID
    if (this.isGroupJid(jid) || this.isGroupJid(this.formatJid(jid))) {
      return {
        success: false,
        error: 'Grup sohbetlerine mesaj gönderilemez',
      };
    }

    // If scheduledAt is provided, schedule the message instead
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
          error: error instanceof Error ? error.message : 'Mesaj zamanlanamadı',
        };
      }
    }

    // Retry configuration for stream errors
    const maxRetries = 3;
    const retryDelay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Check connection before attempting to send
      if (!whatsAppService.isReady()) {
        if (attempt < maxRetries) {
          logger.debug({ attempt, maxRetries }, 'Bağlantı hazır değil, bekleniyor...');
          await this.waitForConnection(retryDelay * attempt);
          continue;
        }
        return {
          success: false,
          error: 'WhatsApp bağlantısı yok',
        };
      }

      try {
        // Send typing indicator before sending the message (makes it look more human-like)
        // Wrap in try-catch to handle stream errors gracefully
        try {
          await whatsAppService.sendPresenceUpdate(jid, 'composing');
          // Wait for typing duration (reduced for reliability)
          await this.delay(Math.min(typingDuration, 2000));
          // Stop typing
          await whatsAppService.sendPresenceUpdate(jid, 'paused');
        } catch (presenceError) {
          // Presence error occurred - check if it's a stream error
          const errorMsg = presenceError instanceof Error ? presenceError.message : '';
          const isStreamError = errorMsg.includes('Stream Errored') || errorMsg.includes('xml-not-well-formed');

          if (isStreamError && attempt < maxRetries) {
            logger.warn({ attempt, error: errorMsg }, 'Stream hatası, yeniden bağlanma bekleniyor...');
            // Wait for reconnection
            await this.waitForConnection(retryDelay * attempt);
            continue; // Retry the entire send operation
          }

          // Non-stream error or last attempt - log and continue with send
          logger.debug({ error: presenceError, jid }, 'Typing göstergesi gönderilemedi, mesaj gönderiliyor');
        }

        // Check connection again after presence (in case stream error occurred)
        if (!whatsAppService.isReady()) {
          if (attempt < maxRetries) {
            logger.debug({ attempt }, 'Bağlantı koptu, yeniden bağlanma bekleniyor...');
            await this.waitForConnection(retryDelay * attempt);
            continue;
          }
          return {
            success: false,
            error: 'WhatsApp bağlantısı mesaj gönderimi sırasında koptu',
          };
        }

        // Send the actual message
        let result: SendMessageResult;

        if (type === 'text') {
          result = await whatsAppService.sendMessage(jid, message || '');
        } else {
          // Media message
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

        // Check if send failed due to connection
        if (!result.success && result.error?.includes('bağlantı')) {
          if (attempt < maxRetries) {
            logger.warn({ attempt, error: result.error }, 'Mesaj gönderimi bağlantı hatası, tekrar deneniyor...');
            await this.waitForConnection(retryDelay * attempt);
            continue;
          }
        }

        // Add to history if successful
        if (result.success && result.messageId) {
          const content = type === 'text' ? (message || '') : (payload.caption || `[${type.toUpperCase()}]`);
          this.addSentMessage(jid, result.messageId, content, type);
        }

        return result;

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Bilinmeyen hata';
        const isStreamError = errorMsg.includes('Stream Errored') || errorMsg.includes('xml-not-well-formed');

        if (isStreamError && attempt < maxRetries) {
          logger.warn({ attempt, error: errorMsg }, 'Mesaj gönderiminde stream hatası, tekrar deneniyor...');
          await this.waitForConnection(retryDelay * attempt);
          continue;
        }

        logger.error({ error, jid, attempt }, 'Mesaj gönderimi başarısız');
        return {
          success: false,
          error: errorMsg,
        };
      }
    }

    return {
      success: false,
      error: 'Maksimum deneme sayısına ulaşıldı',
    };
  }

  /**
   * Wait for WhatsApp connection to be ready
   */
  private async waitForConnection(timeout: number): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 500;

    while (Date.now() - startTime < timeout) {
      if (whatsAppService.isReady()) {
        logger.debug('Bağlantı hazır');
        return true;
      }
      await this.delay(checkInterval);
    }

    logger.warn({ timeout }, 'Bağlantı bekleme süresi doldu');
    return false;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get message history for a specific chat (combines local cache + WhatsApp store)
   */
  public async getMessageHistoryAsync(jid: string, limit = 50, page = 1): Promise<{
    messages: IncomingMessage[];
    total: number;
    page: number;
    totalPages: number;
    source: 'local' | 'store' | 'combined';
  }> {
    // Check for group JID
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

    // Get local history
    const localHistory = this.messageHistory.get(formattedJid) || [];

    // Get store history (sync now)
    let storeHistory: IncomingMessage[] = [];
    try {
      storeHistory = whatsAppService.fetchMessageHistory(jid, 500); // Get more from store
    } catch (error) {
      logger.debug({ error, jid }, 'Store geçmişi alınamadı');
    }

    // Combine and deduplicate
    const combinedMap = new Map<string, IncomingMessage>();

    // Add store messages first
    for (const msg of storeHistory) {
      combinedMap.set(msg.id, msg);
    }

    // Add local messages (overwrite if exists - local is more recent)
    for (const msg of localHistory) {
      combinedMap.set(msg.id, msg);
    }

    const combined = Array.from(combinedMap.values());

    // Sort by timestamp descending (newest first)
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

  /**
   * Get message history (sync version - local only for backward compatibility)
   */
  public getMessageHistory(jid: string, limit = 50, page = 1): {
    messages: IncomingMessage[];
    total: number;
    page: number;
    totalPages: number;
  } {
    // Check for group JID
    if (this.isGroupJid(jid)) {
      return {
        messages: [],
        total: 0,
        page: 1,
        totalPages: 0,
      };
    }

    const formattedJid = this.formatJid(jid);
    const history = this.messageHistory.get(formattedJid) || [];

    // Sort by timestamp descending (newest first)
    const sorted = [...history].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const total = sorted.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const messages = sorted.slice(startIndex, startIndex + limit);

    return {
      messages,
      total,
      page,
      totalPages,
    };
  }

  /**
   * Get all chats with filtering, pagination, and sorting
   * Combines local cache with WhatsApp store data
   */
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

    // First, add chats from WhatsApp store
    try {
      const storeChats = whatsAppService.getChatsFromStore();
      if (storeChats && Array.isArray(storeChats)) {
        // It's a promise, we need to handle it differently
      }
    } catch {
      // Store might return a promise, handle in async version
    }

    // Add local chats
    for (const [jid, messages] of this.messageHistory.entries()) {
      // Skip group chats
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

      // Only add if not already in map or if local has more recent data
      const existing = chatMap.get(jid);
      if (!existing || (chatInfo.lastMessageAt && (!existing.lastMessageAt || chatInfo.lastMessageAt > existing.lastMessageAt))) {
        chatMap.set(jid, chatInfo);
      }
    }

    let chats = Array.from(chatMap.values());

    // Apply filters
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

    // Sort
    chats.sort((a, b) => {
      // Pinned chats always first
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

    // Pagination
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

  /**
   * Mark chat as read - updates local state AND sends read receipt to WhatsApp
   */
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

    // Mark messages as read in local history
    const history = this.messageHistory.get(formattedJid);
    if (history) {
      for (const msg of history) {
        msg.isRead = true;
      }
    }

    // Send read receipt to WhatsApp for unread messages
    try {
      await whatsAppService.markMessagesAsRead(formattedJid);
      logger.debug({ jid: formattedJid }, 'Mesajlar okundu olarak işaretlendi');
    } catch (error) {
      logger.debug({ error, jid: formattedJid }, 'WhatsApp okundu bildirimi gönderilemedi');
    }
  }

  /**
   * Update chat metadata
   */
  public updateChatMetadata(jid: string, updates: Partial<{
    isArchived: boolean;
    isPinned: boolean;
    isMuted: boolean;
  }>): void {
    if (this.isGroupJid(jid)) {
      return;
    }

    const formattedJid = this.formatJid(jid);
    const metadata = this.chatMetadata.get(formattedJid) || {
      name: '',
      unreadCount: 0,
      isArchived: false,
      isPinned: false,
      isMuted: false,
    };

    Object.assign(metadata, updates);
    this.chatMetadata.set(formattedJid, metadata);
  }

  /**
   * Check if number is on WhatsApp
   */
  public async isOnWhatsApp(phone: string): Promise<ContactInfo | null> {
    return whatsAppService.isOnWhatsApp(phone);
  }

  /**
   * Get profile info
   */
  public async getProfileInfo(jid: string): Promise<ProfileInfo | null> {
    if (this.isGroupJid(jid)) {
      throw new Error('Grup profilleri desteklenmiyor');
    }
    return whatsAppService.getProfileInfo(jid);
  }

  /**
   * Send typing indicator
   */
  public async sendTyping(jid: string, duration = 3000): Promise<void> {
    if (this.isGroupJid(jid)) {
      throw new Error('Grup sohbetleri desteklenmiyor');
    }

    await whatsAppService.sendPresenceUpdate(jid, 'composing');

    // Stop typing after duration
    setTimeout(async () => {
      try {
        await whatsAppService.sendPresenceUpdate(jid, 'paused');
      } catch {
        // Ignore errors
      }
    }, duration);
  }

  /**
   * Send recording indicator
   */
  public async sendRecording(jid: string, duration = 3000): Promise<void> {
    if (this.isGroupJid(jid)) {
      throw new Error('Grup sohbetleri desteklenmiyor');
    }

    await whatsAppService.sendPresenceUpdate(jid, 'recording');

    setTimeout(async () => {
      try {
        await whatsAppService.sendPresenceUpdate(jid, 'paused');
      } catch {
        // Ignore errors
      }
    }, duration);
  }

  /**
   * Delete a message
   */
  public async deleteMessage(jid: string, messageId: string, forEveryone = false): Promise<SendMessageResult> {
    if (this.isGroupJid(jid)) {
      return {
        success: false,
        error: 'Grup sohbetleri desteklenmiyor',
      };
    }

    const result = await whatsAppService.deleteMessage(jid, messageId, forEveryone);

    // Remove from local history if successful
    if (result.success) {
      const formattedJid = this.formatJid(jid);
      const history = this.messageHistory.get(formattedJid);
      if (history) {
        const index = history.findIndex(m => m.id === messageId);
        if (index !== -1) {
          history.splice(index, 1);
        }
      }
    }

    return result;
  }

  /**
   * Archive/Unarchive chat
   */
  public async archiveChat(jid: string, archive: boolean): Promise<void> {
    if (this.isGroupJid(jid)) {
      throw new Error('Grup sohbetleri desteklenmiyor');
    }

    await whatsAppService.archiveChat(jid, archive);
    this.updateChatMetadata(jid, { isArchived: archive });
  }

  /**
   * Pin/Unpin chat
   */
  public async pinChat(jid: string, pin: boolean): Promise<void> {
    if (this.isGroupJid(jid)) {
      throw new Error('Grup sohbetleri desteklenmiyor');
    }

    await whatsAppService.pinChat(jid, pin);
    this.updateChatMetadata(jid, { isPinned: pin });
  }

  /**
   * Mute/Unmute chat
   */
  public async muteChat(jid: string, mute: boolean, duration?: number): Promise<void> {
    if (this.isGroupJid(jid)) {
      throw new Error('Grup sohbetleri desteklenmiyor');
    }

    await whatsAppService.muteChat(jid, mute, duration);
    this.updateChatMetadata(jid, { isMuted: mute });
  }

  public clearHistory(jid?: string): void {
    if (jid) {
      if (this.isGroupJid(jid)) {
        return;
      }
      const formattedJid = this.formatJid(jid);
      this.messageHistory.delete(formattedJid);
      this.chatMetadata.delete(formattedJid);
      logger.info({ jid: formattedJid }, 'Sohbet geçmişi temizlendi');
    } else {
      // Clear only non-group chats
      for (const jid of this.messageHistory.keys()) {
        if (!this.isGroupJid(jid)) {
          this.messageHistory.delete(jid);
          this.chatMetadata.delete(jid);
        }
      }
      logger.info('Tüm sohbet geçmişi temizlendi');
    }
  }

  /**
   * Get chat statistics
   */
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

  /**
   * Get cache statistics
   */
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

  /**
   * Clear all caches and free memory
   */
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

    // Clear message history
    this.messageHistory.clear();

    // Clear chat metadata
    this.chatMetadata.clear();

    logger.info({
      clearedChats,
      clearedMessages,
      clearedMetadata
    }, 'Tüm cache temizlendi');

    return {
      clearedChats,
      clearedMessages,
      clearedMetadata
    };
  }
}

export default MessageService.getInstance();
