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

const DEFAULT_TYPING_DURATION = 3000;
const DEFAULT_MIN_DELAY = 5000;
const DEFAULT_MAX_DELAY = 10000;
const MIN_ALLOWED_DELAY = 2000;
const BATCH_SIZE = 15;
const BATCH_BREAK_MIN = 30000;
const BATCH_BREAK_MAX = 60000;

class QueueService extends EventEmitter {
  private static instance: QueueService;
  private jobs: Map<string, BulkJob> = new Map();
  private isProcessing = false;
  private scheduledTimers: Map<string, NodeJS.Timeout> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly checkIntervalMs = 10000;
  private processingTimes: Map<string, number[]> = new Map();

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

  public createBulkJob(payload: BulkSendPayload): BulkJob {
    const jobId = randomUUID();
    const now = new Date();

    let scheduledAt: Date | undefined;
    if (payload.scheduledAt) {
      scheduledAt = new Date(payload.scheduledAt);
      if (isNaN(scheduledAt.getTime())) {
        throw new Error('Invalid scheduledAt date format. Use ISO 8601 format.');
      }
      const minFutureTime = new Date(now.getTime() + 60000);
      if (scheduledAt < minFutureTime) {
        throw new Error('scheduledAt must be at least 1 minute in the future.');
      }
    }

    if (payload.timeWindow) {
      this.validateTimeWindow(payload.timeWindow.startTime, payload.timeWindow.endTime);
    }

    const messageType: MessageType = payload.type || 'text';

    if (messageType === 'text') {
      if (!payload.message) {
        throw new Error('message field is required for text messages.');
      }
    } else {
      if (!payload.mediaUrl && !payload.mediaBase64) {
        throw new Error('mediaUrl or mediaBase64 is required for media messages.');
      }
    }

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

    if (scheduledAt) {
      this.scheduleJobStart(job);
    } else {
      this.startProcessing();
    }

    return job;
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

  private validateTimeWindow(startTime: string, endTime: string): void {
    const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;

    if (!timeRegex.test(startTime)) {
      throw new Error('Invalid startTime format. Use HH:mm format (e.g., 09:00)');
    }

    if (!timeRegex.test(endTime)) {
      throw new Error('Invalid endTime format. Use HH:mm format (e.g., 18:00)');
    }
  }

  private isWithinTimeWindow(timeWindow: TimeWindow): boolean {
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
    const [endHour, endMinute] = timeWindow.endTime.split(':').map(Number);

    const currentMinutes = currentHour * 60 + currentMinute;
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    if (startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

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
      minutesUntilStart = (24 * 60 - currentMinutes) + startMinutes;
    }

    return minutesUntilStart * 60 * 1000;
  }

  private scheduleJobStart(job: BulkJob): void {
    if (!job.scheduledAt) return;

    const delay = job.scheduledAt.getTime() - Date.now();

    if (delay <= 0) {
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

  public getJob(jobId: string): BulkJob | undefined {
    return this.jobs.get(jobId);
  }

  public getJobStats(jobId: string): BulkJobStats | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const progress = job.totalCount > 0
      ? Math.round(((job.successCount + job.failedCount) / job.totalCount) * 100)
      : 0;

    const times = this.processingTimes.get(jobId) || [];

    const averageMessageTime = times.length > 0
      ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      : undefined;

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

  public getAllJobs(): BulkJobStats[] {
    const stats: BulkJobStats[] = [];
    for (const jobId of this.jobs.keys()) {
      const stat = this.getJobStats(jobId);
      if (stat) stats.push(stat);
    }
    return stats.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public pauseJob(jobId: string, reason?: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status !== 'processing' && job.status !== 'queued') {
      return false;
    }

    job.isPaused = true;
    job.pauseReason = reason || 'Manually paused';
    job.status = 'paused';

    this.emit('jobPaused', jobId, job.pauseReason);
    logger.info({ jobId, reason: job.pauseReason }, 'Bulk job paused');

    return true;
  }

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

  public cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'completed' || job.status === 'cancelled') {
      return false;
    }

    const timer = this.scheduledTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.scheduledTimers.delete(jobId);
    }

    for (const item of job.items) {
      if (item.status === 'pending') {
        item.status = 'failed';
        item.error = 'Job cancelled';
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

  public deleteJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'processing') {
      return false;
    }

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

  private startProcessing(): void {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    while (this.isProcessing) {
      const nextItem = this.getNextPendingItem();

      if (!nextItem) {
        this.isProcessing = false;
        logger.debug('Queue processing completed - no more items');
        break;
      }

      const { job, item } = nextItem;

      if (job.isPaused || job.status === 'paused') {
        await this.delay(1000);
        continue;
      }

      if (job.timeWindow && !this.isWithinTimeWindow(job.timeWindow)) {
        job.isPaused = true;
        job.pauseReason = `Outside time window (${job.timeWindow.startTime} - ${job.timeWindow.endTime})`;
        job.status = 'paused';

        const waitTime = this.getTimeUntilWindowOpens(job.timeWindow);
        logger.info({
          jobId: job.jobId,
          waitTimeMinutes: Math.round(waitTime / 60000)
        }, 'Job paused - outside time window');

        setTimeout(() => {
          if (job.status === 'paused' && job.pauseReason?.includes('time window')) {
            this.resumeJob(job.jobId);
          }
        }, waitTime);

        continue;
      }

      if (!whatsAppService.isReady()) {
        logger.warn('WhatsApp not connected, pausing queue processing');
        await this.delay(5000);
        continue;
      }

      if (!job.startedAt) {
        job.startedAt = new Date();
        job.status = 'processing';
        this.emit('jobStarted', job.jobId);
      }

      item.status = 'processing';
      job.status = 'processing';

      const startTime = Date.now();
      await this.processItem(job, item);
      const processingTime = Date.now() - startTime;

      const times = this.processingTimes.get(job.jobId) || [];
      times.push(processingTime);
      this.processingTimes.set(job.jobId, times);

      job.processedInBatch++;

      if (job.processedInBatch >= BATCH_SIZE && job.pendingCount > 0) {
        const batchBreak = this.getRandomDelay(BATCH_BREAK_MIN, BATCH_BREAK_MAX);
        logger.info({
          jobId: job.jobId,
          processedInBatch: job.processedInBatch,
          breakDurationSeconds: Math.round(batchBreak / 1000)
        }, 'Taking batch break for spam protection');

        job.processedInBatch = 0;
        await this.delay(batchBreak);
      } else {
        const delay = this.getRandomDelay(job.minDelay, job.maxDelay);
        await this.delay(delay);
      }
    }
  }

  private getNextPendingItem(): { job: BulkJob; item: QueueItem } | null {
    for (const job of this.jobs.values()) {
      if (job.status === 'cancelled' || job.status === 'completed' || job.status === 'scheduled') {
        continue;
      }

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

  private async processItem(job: BulkJob, item: QueueItem): Promise<void> {
    try {
      try {
        await whatsAppService.sendPresenceUpdate(item.jid, 'composing');
        await this.delay(job.typingDuration);
        await whatsAppService.sendPresenceUpdate(item.jid, 'paused');
      } catch (typingError) {
        logger.debug({ error: typingError, jid: item.jid }, 'Failed to send typing indicator');
      }

      let result;

      if (item.type === 'text') {
        result = await whatsAppService.sendMessage(item.jid, item.message || '');
      } else {
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

    this.checkJobCompletion(job);
  }

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
      item.status = 'pending';
      logger.debug({
        jobId: job.jobId,
        jid: item.jid,
        retry: item.retryCount
      }, 'Retrying bulk message');
    }
  }

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

  private getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public getQueueSize(): number {
    let size = 0;
    for (const job of this.jobs.values()) {
      size += job.pendingCount;
    }
    return size;
  }

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

    logger.info({ cleared }, 'Completed queue jobs cleared');
    return cleared;
  }

  private startScheduleChecker(): void {
    this.checkInterval = setInterval(() => {
      const now = Date.now();

      for (const job of this.jobs.values()) {
        if (job.status === 'scheduled' && job.scheduledAt && job.scheduledAt.getTime() <= now) {
          if (!this.scheduledTimers.has(job.jobId)) {
            logger.info({ jobId: job.jobId }, 'Starting scheduled bulk job');
            job.status = 'queued';
            this.startProcessing();
          }
        }

        if (job.status === 'paused' && job.timeWindow && job.pauseReason?.includes('time window')) {
          if (this.isWithinTimeWindow(job.timeWindow)) {
            logger.info({ jobId: job.jobId }, 'Time window opened, resuming job');
            this.resumeJob(job.jobId);
          }
        }
      }
    }, this.checkIntervalMs);
  }

  public stopScheduleChecker(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    for (const timer of this.scheduledTimers.values()) {
      clearTimeout(timer);
    }
    this.scheduledTimers.clear();
  }

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
