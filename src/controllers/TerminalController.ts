import { Request, Response } from 'express';
import logger, { logEventBus } from '../utils/logger';

interface TerminalLogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

export class TerminalController {
  private logCounter = 0;
  private sseClients: Set<Response> = new Set();

  constructor() {
    this.setupLogListener();
  }

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

  private broadcast(entry: TerminalLogEntry): void {
    for (const res of this.sseClients) {
      try {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(entry)}\n\n`);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  /** GET /api/terminal/stream (SSE) */
  public streamTerminal(req: Request, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`data: ${JSON.stringify({
      id: 0,
      timestamp: new Date().toISOString(),
      level: 'info',
      category: 'system',
      message: 'Terminal stream connection established',
      data: { connectedClients: this.sseClients.size + 1 },
    })}\n\n`);

    this.sseClients.add(res);
    logger.info({ connectedClients: this.sseClients.size }, 'Terminal SSE stream started');

    const heartbeatInterval = setInterval(() => {
      try {
        if (!res.writableEnded) res.write(`:heartbeat\n\n`);
      } catch { cleanup(); }
    }, 30000);

    const cleanup = () => {
      clearInterval(heartbeatInterval);
      this.sseClients.delete(res);
      logger.info({ connectedClients: this.sseClients.size }, 'Terminal SSE stream ended');
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
  }
}

export default new TerminalController();
