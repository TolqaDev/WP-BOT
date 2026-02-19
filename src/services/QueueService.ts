import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import config from '../config';
import logger from '../utils/logger';
import whatsAppService from './WhatsAppService';
import settingsService from './SettingsService';
import type {
  QueueItem,
  BulkJob,
  BulkJobStats,
  BulkJobDetailedStats,
  BulkRecipientStatus,
  QueueItemStatus,
  BulkJobStatus,
  BulkSendPayload,
  TimeWindow,
  MessageType,
} from '../types';

interface QueueEvents {
  jobCreated: (jobId: string) => void;
  jobStarted: (jobId: string) => void;
  jobCompleted: (jobId: string, stats: BulkJobStats) => void;
  jobCancelled: (jobId: string) => void;
  jobPaused: (jobId: string, reason: string) => void;
  jobResumed: (jobId: string) => void;
  itemProcessed: (jobId: string, item: QueueItem) => void;
  itemFailed: (jobId: string, item: QueueItem) => void;
}

// Default timing settings
const DEFAULT_TYPING_DURATION = 3000;
const DEFAULT_MIN_DELAY = 5000;  // 5 seconds minimum between messages
const DEFAULT_MAX_DELAY = 10000; // 10 seconds maximum between messages
const MIN_ALLOWED_DELAY = 2000;  // Absolute minimum delay (spam protection)
const BATCH_SIZE = 15;           // Take a longer break after this many messages
const BATCH_BREAK_MIN = 30000;   // 30 seconds minimum batch break
const BATCH_BREAK_MAX = 60000;   // 60 seconds maximum batch break

class QueueService extends EventEmitter {
  private static instance: QueueService;
  private jobs: Map<string, BulkJob> = new Map();
  private isProcessing = false;
  private scheduledTimers: Map<string, NodeJS.Timeout> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly checkIntervalMs = 10000; // Check every 10 seconds
  private processingTimes: Map<string, number[]> = new Map(); // Track processing times per job

  private constructor() {
    super();
    this.setMaxListeners(20);
    this.startScheduleChecker();
  }

  public static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  /**
   * Create a new bulk job with advanced options
   */
  public createBulkJob(payload: BulkSendPayload): BulkJob {
    const jobId = randomUUID();
    const now = new Date();

    // Validate and parse scheduledAt
    let scheduledAt: Date | undefined;
    if (payload.scheduledAt) {
      scheduledAt = new Date(payload.scheduledAt);
      if (isNaN(scheduledAt.getTime())) {
        throw new Error('Geçersiz scheduledAt tarih formatı. ISO 8601 formatı kullanın.');
      }
      // Must be at least 1 minute in the future
      const minFutureTime = new Date(now.getTime() + 60000);
      if (scheduledAt < minFutureTime) {
        throw new Error('scheduledAt en az 1 dakika sonrası olmalıdır.');
      }
    }

    // Validate time window
    if (payload.timeWindow) {
      this.validateTimeWindow(payload.timeWindow.startTime, payload.timeWindow.endTime);
    }

    // Determine message type
    const messageType: MessageType = payload.type || 'text';

    // Validate content based on type
    if (messageType === 'text') {
      if (!payload.message || typeof payload.message !== 'string') {
        throw new Error('Text mesajları için message alanı zorunludur.');
      }
    } else {
      if (!payload.mediaUrl && !payload.mediaBase64) {
        throw new Error('Medya mesajları için mediaUrl veya mediaBase64 zorunludur.');
      }
    }

    // Create queue items for each recipient
    const items: QueueItem[] = payload.recipients.map((jid) => ({
      id: randomUUID(),
      jid: this.formatJid(jid),
      message: payload.message,
      type: messageType,
      mediaUrl: payload.mediaUrl,
      mediaBase64: payload.mediaBase64,
      caption: payload.caption,
      fileName: payload.fileName,
      mimetype: payload.mimetype,
      status: 'pending' as QueueItemStatus,
      retryCount: 0,
      createdAt: now,
    }));

    // Create the job
    const job: BulkJob = {
      jobId,
      items,
      status: scheduledAt ? 'scheduled' : 'queued',
      createdAt: now,
      scheduledAt,
      timeWindow: payload.timeWindow ? {
        startTime: payload.timeWindow.startTime,
        endTime: payload.timeWindow.endTime,
        timezone: settingsService.timezone,
      } : undefined,
      messageType,
      message: payload.message,
      mediaUrl: payload.mediaUrl,
      mediaBase64: payload.mediaBase64,
      caption: payload.caption,
      fileName: payload.fileName,
      mimetype: payload.mimetype,
      typingDuration: payload.typingDuration ?? DEFAULT_TYPING_DURATION,
      minDelay: Math.max(payload.minDelay ?? DEFAULT_MIN_DELAY, MIN_ALLOWED_DELAY),
      maxDelay: Math.max(payload.maxDelay ?? DEFAULT_MAX_DELAY, MIN_ALLOWED_DELAY),
      totalCount: items.length,
      successCount: 0,
      failedCount: 0,
      pendingCount: items.length,
      processedInBatch: 0,
      isPaused: false,
    };

    this.jobs.set(jobId, job);
    this.processingTimes.set(jobId, []);
    this.emit('jobCreated', jobId);

    logger.info({
      jobId,
      totalRecipients: payload.recipients.length,
      messageType,
      scheduledAt: scheduledAt?.toISOString(),
      timeWindow: payload.timeWindow,
    }, 'Bulk job created');

    // Schedule or start processing
    if (scheduledAt) {
      this.scheduleJobStart(job);
    } else {
      this.startProcessing();
    }

    return job;
  }

  /**
   * Format JID to proper WhatsApp format
   */
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
   * Validate time window format
   */
  private validateTimeWindow(startTime: string, endTime: string): void {
    const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;

    if (!timeRegex.test(startTime)) {
      throw new Error('Geçersiz startTime formatı. HH:mm formatı kullanın (örn: 09:00)');
    }

    if (!timeRegex.test(endTime)) {
      throw new Error('Geçersiz endTime formatı. HH:mm formatı kullanın (örn: 18:00)');
    }
  }

  /**
   * Check if current time is within the time window
   */
  private isWithinTimeWindow(timeWindow: TimeWindow): boolean {
    const timezone = timeWindow.timezone || settingsService.timezone;

    // Get current time in the specified timezone
    const now = new Date();
    let currentTimeStr: string;
    try {
      currentTimeStr = now.toLocaleTimeString('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch {
      currentTimeStr = now.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    }

    const [currentHour, currentMinute] = currentTimeStr.split(':').map(Number);
    const [startHour, startMinute] = timeWindow.startTime.split(':').map(Number);
    const [endHour, endMinute] = timeWindow.endTime.split(':').map(Number);

    const currentMinutes = currentHour * 60 + currentMinute;
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    // Handle overnight windows (e.g., 22:00 - 06:00)
    if (startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  /**
   * Get time until next window opens (in ms)
   */
  private getTimeUntilWindowOpens(timeWindow: TimeWindow): number {
    const timezone = timeWindow.timezone || settingsService.timezone;

    const now = new Date();
    let currentTimeStr: string;
    try {
      currentTimeStr = now.toLocaleTimeString('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch {
      currentTimeStr = now.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    }

    const [currentHour, currentMinute] = currentTimeStr.split(':').map(Number);
    const [startHour, startMinute] = timeWindow.startTime.split(':').map(Number);

    const currentMinutes = currentHour * 60 + currentMinute;
    const startMinutes = startHour * 60 + startMinute;

    let minutesUntilStart: number;
    if (currentMinutes < startMinutes) {
      minutesUntilStart = startMinutes - currentMinutes;
    } else {
      // Next day
      minutesUntilStart = (24 * 60 - currentMinutes) + startMinutes;
    }

    return minutesUntilStart * 60 * 1000; // Convert to milliseconds
  }

  /**
   * Schedule a job to start at a specific time
   */
  private scheduleJobStart(job: BulkJob): void {
    if (!job.scheduledAt) return;

    const delay = job.scheduledAt.getTime() - Date.now();

    if (delay <= 0) {
      // Should start immediately
      job.status = 'queued';
      this.startProcessing();
      return;
    }

    const timer = setTimeout(() => {
      job.status = 'queued';
      this.scheduledTimers.delete(job.jobId);
      logger.info({ jobId: job.jobId }, 'Scheduled bulk job starting');
      this.startProcessing();
    }, delay);

    this.scheduledTimers.set(job.jobId, timer);
    logger.info({ jobId: job.jobId, scheduledAt: job.scheduledAt }, 'Bulk job scheduled');
  }

  /**
   * Get a job by ID
   */
  public getJob(jobId: string): BulkJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get job statistics
   */
  public getJobStats(jobId: string): BulkJobStats | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const progress = job.totalCount > 0
      ? Math.round(((job.successCount + job.failedCount) / job.totalCount) * 100)
      : 0;

    // Calculate average message time
    const times = this.processingTimes.get(jobId) || [];
    const averageMessageTime = times.length > 0
      ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      : undefined;

    // Estimate completion time
    let estimatedCompletionTime: string | undefined;
    if (job.status === 'processing' && averageMessageTime && job.pendingCount > 0) {
      const remainingMs = job.pendingCount * averageMessageTime;
      const estimatedCompletion = new Date(Date.now() + remainingMs);
      estimatedCompletionTime = estimatedCompletion.toISOString();
    }

    return {
      jobId: job.jobId,
      status: job.status,
      total: job.totalCount,
      success: job.successCount,
      failed: job.failedCount,
      pending: job.pendingCount,
      progress,
      isPaused: job.isPaused,
      pauseReason: job.pauseReason,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString(),
      scheduledAt: job.scheduledAt?.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      estimatedCompletionTime,
      averageMessageTime,
      messageType: job.messageType,
      message: job.message,
      caption: job.caption,
      mediaUrl: job.mediaUrl,
      hasMedia: job.messageType !== 'text',
      typingDuration: job.typingDuration,
      minDelay: job.minDelay,
      maxDelay: job.maxDelay,
      timeWindow: job.timeWindow,
    };
  }

  /**
   * Get detailed job statistics including recipient status
   */
  public getJobDetailedStats(jobId: string): BulkJobDetailedStats | null {
    const stats = this.getJobStats(jobId);
    if (!stats) return null;

    const job = this.jobs.get(jobId);
    if (!job) return null;

    const recipients: BulkRecipientStatus[] = job.items.map(item => ({
      id: item.id,
      jid: item.jid,
      phone: item.jid.replace('@s.whatsapp.net', ''),
      status: item.status,
      messageId: item.messageId,
      error: item.error,
      processedAt: item.processedAt?.toISOString(),
    }));

    return {
      ...stats,
      recipients,
    };
  }

  /**
   * Get all jobs
   */
  public getAllJobs(): BulkJobStats[] {
    const stats: BulkJobStats[] = [];
    for (const jobId of this.jobs.keys()) {
      const stat = this.getJobStats(jobId);
      if (stat) stats.push(stat);
    }
    // Sort by creation date (newest first)
    return stats.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Pause a job
   */
  public pauseJob(jobId: string, reason?: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status !== 'processing' && job.status !== 'queued') {
      return false;
    }

    job.isPaused = true;
    job.pauseReason = reason || 'Manuel olarak duraklatıldı';
    job.status = 'paused';

    this.emit('jobPaused', jobId, job.pauseReason);
    logger.info({ jobId, reason: job.pauseReason }, 'Bulk job paused');

    return true;
  }

  /**
   * Resume a paused job
   */
  public resumeJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (!job.isPaused && job.status !== 'paused') {
      return false;
    }

    job.isPaused = false;
    job.pauseReason = undefined;
    job.status = 'queued';

    this.emit('jobResumed', jobId);
    logger.info({ jobId }, 'Bulk job resumed');

    this.startProcessing();
    return true;
  }

  /**
   * Cancel a job
   */
  public cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'completed' || job.status === 'cancelled') {
      return false;
    }

    // Clear scheduled timer if exists
    const timer = this.scheduledTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.scheduledTimers.delete(jobId);
    }

    // Mark all pending items as failed
    for (const item of job.items) {
      if (item.status === 'pending') {
        item.status = 'failed';
        item.error = 'İş iptal edildi';
        job.failedCount++;
        job.pendingCount--;
      }
    }

    job.status = 'cancelled';
    job.completedAt = new Date();
    job.isPaused = false;

    this.emit('jobCancelled', jobId);
    logger.info({ jobId }, 'Bulk job cancelled');

    return true;
  }

  /**
   * Delete a job
   */
  public deleteJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'processing') {
      return false; // Can't delete while processing
    }

    // Clear scheduled timer if exists
    const timer = this.scheduledTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.scheduledTimers.delete(jobId);
    }

    this.jobs.delete(jobId);
    this.processingTimes.delete(jobId);
    logger.info({ jobId }, 'Bulk job deleted');
    return true;
  }

  /**
   * Start processing the queue
   */
  private startProcessing(): void {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.processQueue();
  }

  /**
   * Main queue processing loop
   */
  private async processQueue(): Promise<void> {
    while (this.isProcessing) {
      const nextItem = this.getNextPendingItem();

      if (!nextItem) {
        // No more items to process
        this.isProcessing = false;
        logger.debug('Queue processing completed - no more items');
        break;
      }

      const { job, item } = nextItem;

      // Check if job is paused
      if (job.isPaused || job.status === 'paused') {
        await this.delay(1000);
        continue;
      }

      // Check time window
      if (job.timeWindow && !this.isWithinTimeWindow(job.timeWindow)) {
        // Pause the job until window opens
        job.isPaused = true;
        job.pauseReason = `Zaman penceresi dışında (${job.timeWindow.startTime} - ${job.timeWindow.endTime})`;
        job.status = 'paused';

        const waitTime = this.getTimeUntilWindowOpens(job.timeWindow);
        logger.info({
          jobId: job.jobId,
          waitTimeMinutes: Math.round(waitTime / 60000)
        }, 'Job paused - outside time window');

        // Schedule resume
        setTimeout(() => {
          if (job.status === 'paused' && job.pauseReason?.includes('Zaman penceresi')) {
            this.resumeJob(job.jobId);
          }
        }, waitTime);

        continue;
      }

      // Check if WhatsApp is connected
      if (!whatsAppService.isReady()) {
        logger.warn('WhatsApp not connected, pausing queue processing');
        await this.delay(5000);
        continue;
      }

      // Mark job as started if first item
      if (!job.startedAt) {
        job.startedAt = new Date();
        job.status = 'processing';
        this.emit('jobStarted', job.jobId);
      }

      // Update status
      item.status = 'processing';
      job.status = 'processing';

      // Process the item
      const startTime = Date.now();
      await this.processItem(job, item);
      const processingTime = Date.now() - startTime;

      // Track processing time
      const times = this.processingTimes.get(job.jobId) || [];
      times.push(processingTime);
      this.processingTimes.set(job.jobId, times);

      // Increment batch counter
      job.processedInBatch++;

      // Check if we need a batch break (spam protection)
      if (job.processedInBatch >= BATCH_SIZE && job.pendingCount > 0) {
        const batchBreak = this.getRandomDelay(BATCH_BREAK_MIN, BATCH_BREAK_MAX);
        logger.info({
          jobId: job.jobId,
          processedInBatch: job.processedInBatch,
          breakDurationSeconds: Math.round(batchBreak / 1000)
        }, 'Taking batch break for spam protection');

        job.processedInBatch = 0; // Reset counter
        await this.delay(batchBreak);
      } else {
        // Normal delay between messages
        const delay = this.getRandomDelay(job.minDelay, job.maxDelay);
        await this.delay(delay);
      }
    }
  }

  /**
   * Get the next pending item from any active job
   */
  private getNextPendingItem(): { job: BulkJob; item: QueueItem } | null {
    for (const job of this.jobs.values()) {
      // Skip non-active jobs
      if (job.status === 'cancelled' || job.status === 'completed' || job.status === 'scheduled') {
        continue;
      }

      // Skip paused jobs (unless checking for window resume)
      if (job.isPaused && job.status === 'paused') {
        continue;
      }

      for (const item of job.items) {
        if (item.status === 'pending') {
          return { job, item };
        }
      }
    }
    return null;
  }

  /**
   * Process a single queue item
   */
  private async processItem(job: BulkJob, item: QueueItem): Promise<void> {
    try {
      // Send typing indicator
      try {
        await whatsAppService.sendPresenceUpdate(item.jid, 'composing');
        await this.delay(job.typingDuration);
        await whatsAppService.sendPresenceUpdate(item.jid, 'paused');
      } catch (typingError) {
        // Ignore typing errors, continue with sending
        logger.debug({ error: typingError, jid: item.jid }, 'Typing göstergesi gönderilemedi');
      }

      let result;

      if (item.type === 'text') {
        // Send text message
        result = await whatsAppService.sendMessage(item.jid, item.message || '');
      } else {
        // Send media message
        result = await whatsAppService.sendMedia(item.jid, {
          type: item.type,
          url: item.mediaUrl,
          base64: item.mediaBase64,
          caption: item.caption,
          fileName: item.fileName,
          mimetype: item.mimetype,
        });
      }

      if (result.success) {
        item.status = 'completed';
        item.messageId = result.messageId;
        item.processedAt = new Date();
        job.successCount++;
        job.pendingCount--;

        this.emit('itemProcessed', job.jobId, item);
        logger.debug({
          jobId: job.jobId,
          jid: item.jid,
          messageId: result.messageId
        }, 'Bulk message sent successfully');
      } else {
        this.handleItemFailure(job, item, result.error || 'Send failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.handleItemFailure(job, item, errorMessage);
    }

    // Check if job is completed
    this.checkJobCompletion(job);
  }

  /**
   * Handle item failure with retry logic
   */
  private handleItemFailure(job: BulkJob, item: QueueItem, error: string): void {
    item.retryCount++;
    const maxRetry = config.queue.maxRetry;

    if (item.retryCount >= maxRetry) {
      item.status = 'failed';
      item.error = error;
      item.processedAt = new Date();
      job.failedCount++;
      job.pendingCount--;

      this.emit('itemFailed', job.jobId, item);
      logger.warn({
        jobId: job.jobId,
        jid: item.jid,
        error,
        retryCount: item.retryCount
      }, 'Bulk message failed after max retries');
    } else {
      // Reset to pending for retry
      item.status = 'pending';
      logger.debug({
        jobId: job.jobId,
        jid: item.jid,
        retry: item.retryCount
      }, 'Retrying bulk message');
    }
  }

  /**
   * Check if job is completed and update status
   */
  private checkJobCompletion(job: BulkJob): void {
    if (job.pendingCount === 0) {
      job.status = 'completed';
      job.completedAt = new Date();
      job.isPaused = false;

      const stats = this.getJobStats(job.jobId);
      if (stats) {
        this.emit('jobCompleted', job.jobId, stats);
        logger.info({
          jobId: job.jobId,
          success: job.successCount,
          failed: job.failedCount,
          duration: job.completedAt.getTime() - (job.startedAt?.getTime() || job.createdAt.getTime())
        }, 'Bulk job completed');
      }
    }
  }

  /**
   * Get random delay between min and max
   */
  private getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get total pending items across all jobs
   */
  public getQueueSize(): number {
    let size = 0;
    for (const job of this.jobs.values()) {
      size += job.pendingCount;
    }
    return size;
  }

  /**
   * Clear completed and cancelled jobs
   */
  public clearCompletedJobs(): number {
    let cleared = 0;
    const completedStatuses = ['completed', 'failed', 'cancelled'];

    for (const [jobId, job] of this.jobs.entries()) {
      if (completedStatuses.includes(job.status)) {
        this.jobs.delete(jobId);
        this.processingTimes.delete(jobId);
        cleared++;
      }
    }

    logger.info({ cleared }, 'Tamamlanan kuyruk işleri temizlendi');
    return cleared;
  }

  /**
   * Periodic checker for scheduled jobs and time windows
   */
  private startScheduleChecker(): void {
    this.checkInterval = setInterval(() => {
      const now = Date.now();

      for (const job of this.jobs.values()) {
        // Check scheduled jobs that should start
        if (job.status === 'scheduled' && job.scheduledAt && job.scheduledAt.getTime() <= now) {
          if (!this.scheduledTimers.has(job.jobId)) {
            logger.info({ jobId: job.jobId }, 'Starting scheduled bulk job');
            job.status = 'queued';
            this.startProcessing();
          }
        }

        // Check paused jobs with time window that should resume
        if (job.status === 'paused' && job.timeWindow && job.pauseReason?.includes('Zaman penceresi')) {
          if (this.isWithinTimeWindow(job.timeWindow)) {
            logger.info({ jobId: job.jobId }, 'Time window opened, resuming job');
            this.resumeJob(job.jobId);
          }
        }
      }
    }, this.checkIntervalMs);
  }

  /**
   * Stop the schedule checker
   */
  public stopScheduleChecker(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Clear all scheduled timers
    for (const timer of this.scheduledTimers.values()) {
      clearTimeout(timer);
    }
    this.scheduledTimers.clear();
  }

  // Type-safe event emitter
  public override on<K extends keyof QueueEvents>(
    event: K,
    listener: QueueEvents[K]
  ): this {
    return super.on(event, listener);
  }

  public override emit<K extends keyof QueueEvents>(
    event: K,
    ...args: Parameters<QueueEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

export default QueueService.getInstance();
