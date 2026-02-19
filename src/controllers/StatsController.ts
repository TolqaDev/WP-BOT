import { Request, Response } from 'express';
import os from 'os';
import whatsAppService from '../services/WhatsAppService';
import queueService from '../services/QueueService';
import messageService from '../services/MessageService';
import { ResponseFormatter } from '../views/ResponseFormatter';
import logger from '../utils/logger';

interface SystemStats {
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

interface WhatsAppStats {
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

interface QueueStats {
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

interface MessageStats {
  totalChats: number;
  totalMessages: number;
  chats: Array<{
    jid: string;
    messageCount: number;
    lastMessageTime: string | null;
  }>;
}

interface ServerStats {
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
  messages: MessageStats;
  health: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: {
      whatsapp: boolean;
      queue: boolean;
      memory: boolean;
    };
  };
}

export class StatsController {
  private startTime: Date;

  constructor() {
    this.startTime = new Date();
  }

  /**
   * Get comprehensive server statistics
   */
  public getStats(req: Request, res: Response): void {
    try {
      const stats = this.collectStats();
      res.status(200).json(ResponseFormatter.success(stats));
    } catch (error) {
      logger.error({ error }, 'Failed to get server stats');
      res.status(500).json(
        ResponseFormatter.serverError('Failed to get server stats')
      );
    }
  }

  /**
   * Get system statistics only
   */
  public getSystemStats(req: Request, res: Response): void {
    try {
      const system = this.getSystemInfo();
      res.status(200).json(ResponseFormatter.success(system));
    } catch (error) {
      logger.error({ error }, 'Failed to get system stats');
      res.status(500).json(
        ResponseFormatter.serverError('Failed to get system stats')
      );
    }
  }

  /**
   * Get WhatsApp connection statistics
   */
  public getWhatsAppStats(req: Request, res: Response): void {
    try {
      const whatsapp = this.getWhatsAppInfo();
      res.status(200).json(ResponseFormatter.success(whatsapp));
    } catch (error) {
      logger.error({ error }, 'Failed to get WhatsApp stats');
      res.status(500).json(
        ResponseFormatter.serverError('Failed to get WhatsApp stats')
      );
    }
  }

  /**
   * Get queue statistics
   */
  public getQueueStats(req: Request, res: Response): void {
    try {
      const queue = this.getQueueInfo();
      res.status(200).json(ResponseFormatter.success(queue));
    } catch (error) {
      logger.error({ error }, 'Failed to get queue stats');
      res.status(500).json(
        ResponseFormatter.serverError('Failed to get queue stats')
      );
    }
  }

  private collectStats(): ServerStats {
    const now = new Date();
    const uptimeMs = now.getTime() - this.startTime.getTime();

    const system = this.getSystemInfo();
    const whatsapp = this.getWhatsAppInfo();
    const queue = this.getQueueInfo();
    const messages = this.getMessageInfo();
    const health = this.getHealthStatus(system, whatsapp);

    return {
      timestamp: now.toISOString(),
      server: {
        uptime: uptimeMs / 1000,
        uptimeFormatted: this.formatUptime(uptimeMs),
        environment: process.env.NODE_ENV || 'development',
        port: parseInt(process.env.PORT || '3000', 10),
      },
      system,
      whatsapp,
      queue,
      messages,
      health,
    };
  }

  private getSystemInfo(): SystemStats {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      uptime: os.uptime(),
      memory: {
        total: Math.round(totalMem / 1024 / 1024),
        free: Math.round(freeMem / 1024 / 1024),
        used: Math.round(usedMem / 1024 / 1024),
        usagePercent: Math.round((usedMem / totalMem) * 100),
      },
      cpu: {
        cores: os.cpus().length,
        model: os.cpus()[0]?.model || 'Unknown',
        loadAvg: os.loadavg(),
      },
    };
  }

  private getWhatsAppInfo(): WhatsAppStats {
    const connectionStats = whatsAppService.getConnectionStats();

    return {
      isConnected: connectionStats.isConnected,
      isConnecting: connectionStats.isConnecting,
      qrAttempts: connectionStats.qrAttempts,
      maxQrAttempts: connectionStats.maxQrAttempts,
      reconnectAttempts: connectionStats.reconnectAttempts,
      maxReconnectAttempts: connectionStats.maxReconnectAttempts,
      connectionStartTime: connectionStats.connectionStartTime?.toISOString() || null,
      lastConnected: connectionStats.lastConnected?.toISOString() || null,
      session: connectionStats.sessionInfo ? {
        jid: connectionStats.sessionInfo.jid,
        name: connectionStats.sessionInfo.name,
        phone: connectionStats.sessionInfo.phone,
      } : null,
    };
  }

  private getQueueInfo(): QueueStats {
    const allJobs = queueService.getAllJobs();

    let activeJobs = 0;
    let completedJobs = 0;
    let failedJobs = 0;
    let cancelledJobs = 0;

    for (const job of allJobs) {
      switch (job.status) {
        case 'queued':
        case 'processing':
          activeJobs++;
          break;
        case 'completed':
          completedJobs++;
          break;
        case 'cancelled':
          cancelledJobs++;
          break;
      }
      // Count failed from completed jobs with failures
      failedJobs += job.failed;
    }

    return {
      totalJobs: allJobs.length,
      activeJobs,
      completedJobs,
      failedJobs,
      cancelledJobs,
      totalPendingMessages: queueService.getQueueSize(),
      jobs: allJobs,
    };
  }

  private getMessageInfo(): MessageStats {
    const chatsResponse = messageService.getAllChats();
    let totalMessages = 0;

    const chatStats = chatsResponse.items.map(chat => {
      totalMessages += chat.messageCount;
      return {
        jid: chat.jid,
        messageCount: chat.messageCount,
        lastMessageTime: chat.lastMessage?.timestamp.toISOString() || null,
      };
    });

    return {
      totalChats: chatsResponse.total,
      totalMessages,
      chats: chatStats,
    };
  }

  private getHealthStatus(
    system: SystemStats,
    whatsapp: WhatsAppStats
  ): ServerStats['health'] {
    const checks = {
      whatsapp: whatsapp.isConnected,
      queue: true, // Queue is always available (in-memory)
      memory: system.memory.usagePercent < 90,
    };

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (!checks.memory) {
      status = 'unhealthy';
    } else if (!checks.whatsapp) {
      status = 'degraded';
    }

    return { status, checks };
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Get cache statistics
   * GET /api/cache/stats
   */
  public async getCacheStats(req: Request, res: Response): Promise<void> {
    try {
      const cacheStats = (messageService as any).getCacheStats();
      const memoryBefore = process.memoryUsage();

      res.status(200).json(ResponseFormatter.success({
        cache: cacheStats,
        memory: {
          heapUsed: Math.round(memoryBefore.heapUsed / 1024 / 1024 * 100) / 100,
          heapTotal: Math.round(memoryBefore.heapTotal / 1024 / 1024 * 100) / 100,
          rss: Math.round(memoryBefore.rss / 1024 / 1024 * 100) / 100,
          external: Math.round(memoryBefore.external / 1024 / 1024 * 100) / 100,
          unit: 'MB'
        }
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to get cache stats');
      res.status(500).json(
        ResponseFormatter.serverError('Cache istatistikleri alınamadı')
      );
    }
  }

  /**
   * Clear all caches and free up memory
   * POST /api/cache/clear
   */
  public async clearCache(req: Request, res: Response): Promise<void> {
    try {
      const memoryBefore = process.memoryUsage();

      // Clear message service caches
      const clearedStats = (messageService as any).clearAllCaches();

      // Clear queue completed jobs
      const queueCleared = queueService.clearCompletedJobs();

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const memoryAfter = process.memoryUsage();
      const freedMemory = memoryBefore.heapUsed - memoryAfter.heapUsed;

      logger.info({
        clearedStats,
        queueCleared,
        freedMemory: Math.round(freedMemory / 1024 / 1024 * 100) / 100
      }, 'Cache temizlendi');

      res.status(200).json(ResponseFormatter.success({
        message: 'Cache başarıyla temizlendi',
        cleared: {
          ...clearedStats,
          queueJobs: queueCleared
        },
        memory: {
          before: {
            heapUsed: Math.round(memoryBefore.heapUsed / 1024 / 1024 * 100) / 100,
            heapTotal: Math.round(memoryBefore.heapTotal / 1024 / 1024 * 100) / 100,
          },
          after: {
            heapUsed: Math.round(memoryAfter.heapUsed / 1024 / 1024 * 100) / 100,
            heapTotal: Math.round(memoryAfter.heapTotal / 1024 / 1024 * 100) / 100,
          },
          freed: Math.round(freedMemory / 1024 / 1024 * 100) / 100,
          unit: 'MB'
        }
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to clear cache');
      res.status(500).json(
        ResponseFormatter.serverError('Cache temizlenemedi')
      );
    }
  }
}

export default new StatsController();
