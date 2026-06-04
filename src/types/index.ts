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

export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'ptt' | 'document' | 'sticker' | 'location' | 'liveLocation' | 'vcard' | 'contact' | 'poll' | 'event';

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
  messageType: MessageType;
  message?: string;
  mediaUrl?: string;
  mediaBase64?: string;
  mediaItems?: BulkMediaItem[];
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

export type BulkJobStatus = 'queued' | 'scheduled' | 'processing' | 'paused' | 'completed' | 'cancelled';

/** Çoklu medya gönderiminde tek bir dosya (toplu gönderim). */
export interface BulkMediaItem {
  type: MessageType;
  mediaBase64?: string;
  mediaUrl?: string;
  fileName?: string;
  mimetype?: string;
}

export interface BulkSendPayload {
  recipients: string[];
  message?: string;
  type?: MessageType;
  mediaUrl?: string;
  mediaBase64?: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
  /** Birden fazla dosya: her alıcıya sırayla gönderilir (maks 5). */
  mediaItems?: BulkMediaItem[];
  scheduledAt?: string;
  typingDuration?: number;
  minDelay?: number;
  maxDelay?: number;
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
  createdAt: string;
  startedAt?: string;
  scheduledAt?: string;
  completedAt?: string;
  estimatedCompletionTime?: string;
  averageMessageTime?: number;
  message?: string;
  caption?: string;
  mediaUrl?: string;
  messageType: MessageType;
  hasMedia: boolean;
  typingDuration: number;
  minDelay: number;
  maxDelay: number;
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

export interface PairingResponse {
  pairingCode: string;
  expiresIn: number;
}

/** Bir numaranın WhatsApp'ta kayıtlı olup olmadığının sonucu. */
export interface NumberCheckResult {
  phone: string;
  exists: boolean;
  jid: string | null;
}

export interface StatusResponse {
  isConnected: boolean;
  isConnecting?: boolean;
  hasSession?: boolean;
  session?: SessionInfo;
  /** Şifreleme/oturum sorunu algılandı mı? (ADDON kalıcı uyarı gösterir) */
  encryptionAlert?: boolean;
}

export interface WhatsAppEvents {
  qr: (qr: string) => void;
  pairingCode: (code: string) => void;
  connected: (session: SessionInfo) => void;
  disconnected: (reason: string) => void;
  reconnecting: (data: { attempt: number; delay: number; reason: string }) => void;
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
  callReject: CallRejectSettings;
  /** Mesaj göndermeden önce "yazıyor..." gösterme süresi (ms). */
  typingDuration: number;
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

export interface TerminalLogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface SystemStats {
  platform: string;
  arch: string;
  nodeVersion: string;
  uptime: number;
  memory: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  cpu: {
    cores: number;
    model: string;
    loadAvg: number[];
  };
}

export interface WhatsAppStats {
  isConnected: boolean;
  isConnecting: boolean;
  qrAttempts: number;
  maxQrAttempts: number;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  connectionStartTime: string | null;
  lastConnected: string | null;
  session: {
    jid: string;
    name: string;
    phone: string;
  } | null;
}

export interface QueueStats {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  totalPendingMessages: number;
  jobs: Array<{
    jobId: string;
    status: string;
    total: number;
    success: number;
    failed: number;
    pending: number;
    progress: number;
  }>;
}

export interface ServerStats {
  timestamp: string;
  server: {
    uptime: number;
    uptimeFormatted: string;
    environment: string;
    port: number;
  };
  system: SystemStats;
  whatsapp: WhatsAppStats;
  queue: QueueStats;
  health: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: {
      whatsapp: boolean;
      queue: boolean;
      memory: boolean;
    };
  };
}
