import type { proto } from '@whiskeysockets/baileys';

export interface SessionState {
  isConnected: boolean;
  isConnecting: boolean;
  qrCode: string | null;
  lastConnected: Date | null;
}

export interface SessionInfo {
  jid: string;
  name: string;
  phone: string;
}

export interface IncomingMessage {
  id: string;
  from: string;
  fromName: string;
  content: string;
  timestamp: Date;
  type: MessageType;
  isGroup: boolean;
  isRead?: boolean;
  isFromMe?: boolean;
  fromMe?: boolean;  // Alias for isFromMe - client compatibility
  mediaUrl?: string;
  mimetype?: string;
  fileName?: string;
}

export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contact';

export interface SendMessagePayload {
  jid: string;
  message?: string;
  type?: MessageType;
  mediaUrl?: string;
  mediaBase64?: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
  scheduledAt?: string;
  typingDuration?: number;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface ScheduledMessage {
  id: string;
  jid: string;
  message?: string;
  type: MessageType;
  mediaUrl?: string;
  mediaBase64?: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
  typingDuration?: number;
  scheduledAt: Date;
  createdAt: Date;
  status: ScheduledMessageStatus;
  error?: string;
  messageId?: string;
}

export type ScheduledMessageStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export interface ScheduleMessagePayload {
  jid: string;
  message?: string;
  type?: MessageType;
  mediaUrl?: string;
  mediaBase64?: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
  typingDuration?: number;
  scheduledAt: string;
}

export interface UpdateScheduledMessagePayload {
  message?: string;
  type?: MessageType;
  mediaUrl?: string;
  mediaBase64?: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
  typingDuration?: number;
  scheduledAt?: string;
}

export interface ChatInfo {
  jid: string;
  name: string;
  phone: string;
  lastMessage: IncomingMessage | null;
  messageCount: number;
  unreadCount: number;
  isArchived: boolean;
  isPinned: boolean;
  isMuted: boolean;
  lastMessageAt: Date | null;
  countryCode?: string;
}

export interface ChatFilters {
  archived?: boolean;
  unread?: boolean;
  read?: boolean;
  countryCode?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: 'lastMessage' | 'unread' | 'name';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ContactInfo {
  jid: string;
  name: string;
  phone: string;
  isOnWhatsApp: boolean;
  profilePicUrl?: string;
  status?: string;
  lastSeen?: Date;
}

export interface ProfileInfo {
  jid: string;
  name: string;
  phone: string;
  profilePicUrl?: string;
  status?: string;
}

export interface QueueItem {
  id: string;
  jid: string;
  message?: string;
  type: MessageType;
  mediaUrl?: string;
  mediaBase64?: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
  status: QueueItemStatus;
  retryCount: number;
  createdAt: Date;
  processedAt?: Date;
  error?: string;
  messageId?: string;
}

export type QueueItemStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface BulkJob {
  jobId: string;
  items: QueueItem[];
  status: BulkJobStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  scheduledAt?: Date;
  timeWindow?: TimeWindow;
  messageType: MessageType;
  message?: string;
  mediaUrl?: string;
  mediaBase64?: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
  typingDuration: number;
  minDelay: number;
  maxDelay: number;
  totalCount: number;
  successCount: number;
  failedCount: number;
  pendingCount: number;
  processedInBatch: number;
  isPaused: boolean;
  pauseReason?: string;
}

export interface TimeWindow {
  startTime: string;
  endTime: string;
  timezone?: string;
}

export type BulkJobStatus = 'queued' | 'scheduled' | 'processing' | 'paused' | 'completed' | 'cancelled';

export interface BulkSendPayload {
  recipients: string[];
  message?: string;
  // Message type and media
  type?: MessageType;
  mediaUrl?: string;
  mediaBase64?: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
  // Scheduling
  scheduledAt?: string; // ISO date string - when to start the job
  // Time window - only send during these hours
  timeWindow?: {
    startTime: string; // HH:mm format
    endTime: string;   // HH:mm format
  };
  // Timing settings
  typingDuration?: number; // Typing indicator duration in ms (default: 3000)
  minDelay?: number; // Minimum delay between messages in ms (default: 3000)
  maxDelay?: number; // Maximum delay between messages in ms (default: 5000)
}

export interface BulkJobStats {
  jobId: string;
  status: BulkJobStatus;
  total: number;
  success: number;
  failed: number;
  pending: number;
  progress: number;
  isPaused: boolean;
  pauseReason?: string;
  // Timing info
  createdAt: string;
  startedAt?: string;
  scheduledAt?: string;
  completedAt?: string;
  estimatedCompletionTime?: string;
  averageMessageTime?: number; // Average time per message in ms
  // Message content
  message?: string;
  caption?: string;
  mediaUrl?: string;
  // Settings info
  messageType: MessageType;
  hasMedia: boolean;
  typingDuration: number;
  minDelay: number;
  maxDelay: number;
  timeWindow?: TimeWindow;
}

export interface BulkJobDetailedStats extends BulkJobStats {
  recipients: BulkRecipientStatus[];
}

export interface BulkRecipientStatus {
  id: string;
  jid: string;
  phone: string;
  status: QueueItemStatus;
  messageId?: string;
  error?: string;
  processedAt?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface QRResponse {
  qrCode: string;
  expiresIn: number;
}

export interface StatusResponse {
  isConnected: boolean;
  isConnecting?: boolean;
  hasSession?: boolean;
  session?: SessionInfo;
}

export interface WhatsAppEvents {
  qr: (qr: string) => void;
  connected: (session: SessionInfo) => void;
  disconnected: (reason: string) => void;
  reconnecting: (data: { attempt: number; delay: number; reason: string }) => void;
  message: (message: IncomingMessage) => void;
  messageSent: (result: SendMessageResult) => void;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  sessionPath: string;
  timezone: string;
  queue: QueueConfig;
  rateLimit: RateLimitConfig;
  security: SecurityConfig;
  whatsapp: WhatsAppConfig;
}

export interface CallRejectSettings {
  enabled: boolean;
}

export interface WhatsAppConfig {
  autoRead: boolean;
  notify: boolean;
  corsWhiteList: string[];
  callReject: CallRejectSettings;
}

export interface QueueConfig {
  delayMs: number;
  maxRetry: number;
}

export interface SecurityConfig {
  apiKey: string;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

