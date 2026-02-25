import { Request, Response } from 'express';
import logger, { logEventBus } from '../utils/logger';

/**
 * Terminal log entry interface
 */
interface TerminalLogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * TerminalController
 * Tüm pino logger çıktılarını SSE üzerinden gerçek zamanlı istemciye aktarır.
 * Filtre yok - terminalde ne görünüyorsa aynısı aktarılır.
 * Buffer tutmaz, cache yapmaz. Sadece canlı akış sağlar.
 */
export class TerminalController {
  private logCounter = 0;
  private sseClients: Set<Response> = new Set();

  constructor() {
    this.setupLogListener();
  }

  /**
   * Pino logger event bus'ını dinle ve her log'u SSE'ye aktar
   */
  private setupLogListener(): void {
    logEventBus.on('log', (logData: { level: TerminalLogEntry['level']; category: string; message: string; data?: Record<string, unknown> }) => {
      const entry: TerminalLogEntry = {
        id: ++this.logCounter,
        timestamp: new Date().toISOString(),
        level: logData.level,
        category: logData.category,
        message: logData.message,
        data: logData.data,
      };

      this.broadcast(entry);
    });
  }

  /**
   * Broadcast a log entry to all connected SSE clients
   * Filtresiz - tüm loglar tüm istemcilere iletilir
   */
  private broadcast(entry: TerminalLogEntry): void {
    for (const res of this.sseClients) {
      try {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(entry)}\n\n`);
        }
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  /**
   * SSE endpoint - Terminal log stream
   * GET /api/terminal/stream
   *
   * Tüm pino logger çıktılarını filtresiz, gerçek zamanlı olarak SSE üzerinden iletir.
   * Terminalde gördüğünüz her log burada da aynı şekilde görünür.
   */
  public streamTerminal(req: Request, res: Response): void {
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // İlk olarak init mesajı gönder
    res.write(`data: ${JSON.stringify({
      id: 0,
      timestamp: new Date().toISOString(),
      level: 'info',
      category: 'system',
      message: 'Terminal stream bağlantısı kuruldu',
      data: {
        connectedClients: this.sseClients.size + 1,
      },
    })}\n\n`);

    // Bu client'ı kaydet
    this.sseClients.add(res);

    logger.info({ connectedClients: this.sseClients.size }, 'Terminal SSE stream başlatıldı');

    // Heartbeat - bağlantıyı canlı tut
    const heartbeatInterval = setInterval(() => {
      try {
        if (!res.writableEnded) {
          res.write(`:heartbeat\n\n`);
        }
      } catch {
        cleanup();
      }
    }, 30000);

    const cleanup = () => {
      clearInterval(heartbeatInterval);
      this.sseClients.delete(res);
      logger.info({ connectedClients: this.sseClients.size }, 'Terminal SSE stream sonlandırıldı');
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
  }
}

export default new TerminalController();

