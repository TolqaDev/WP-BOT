import pino from 'pino';
import { EventEmitter } from 'events';
import config from '../config';

/**
 * Logger Event Bus
 * Tüm pino log çıktılarını SSE stream'e aktarmak için kullanılır.
 */
export const logEventBus = new EventEmitter();
logEventBus.setMaxListeners(50);

/**
 * Pino log seviyesini terminal seviyesine çevir
 */
const pinoLevelToTerminal = (level: number): 'debug' | 'info' | 'warn' | 'error' => {
  if (level <= 20) return 'debug';
  if (level <= 30) return 'info';
  if (level <= 40) return 'warn';
  return 'error';
};

/**
 * Pino log objesinden okunabilir mesaj çıkar
 */
const extractMessage = (obj: Record<string, unknown>): string => {
  return (obj.msg as string) || (obj.message as string) || '';
};

/**
 * Pino log objesinden kategori çıkar
 */
const extractCategory = (obj: Record<string, unknown>): string => {
  if (obj.category) return obj.category as string;
  const msg = extractMessage(obj);
  if (msg.toLowerCase().includes('whatsapp') || msg.toLowerCase().includes('baileys') || msg.toLowerCase().includes('qr')) return 'whatsapp';
  if (msg.toLowerCase().includes('mesaj') || msg.toLowerCase().includes('message')) return 'message';
  if (msg.toLowerCase().includes('queue') || msg.toLowerCase().includes('bulk') || msg.toLowerCase().includes('kuyruk')) return 'queue';
  return 'system';
};

/**
 * Custom destination that hooks into pino write stream
 */
const createLogHookDestination = () => {
  const dest = config.nodeEnv === 'development'
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      })
    : pino.destination(1); // stdout

  // Intercept write to emit events
  const originalWrite = dest.write.bind(dest);
  dest.write = (chunk: string | Buffer): boolean => {
    try {
      const str = typeof chunk === 'string' ? chunk : chunk.toString();
      const obj = JSON.parse(str);
      const level = pinoLevelToTerminal(obj.level || 30);
      const message = extractMessage(obj);
      const category = extractCategory(obj);

      // data alanı: log objesinden pino meta alanlarını çıkar
      const { level: _l, time: _t, msg: _m, message: _msg, pid: _p, hostname: _h, ...data } = obj;

      logEventBus.emit('log', {
        level,
        category,
        message,
        data: Object.keys(data).length > 0 ? data : undefined,
      });
    } catch {
      // JSON parse hatası - raw mesaj olarak gönder
      const str = typeof chunk === 'string' ? chunk.trim() : chunk.toString().trim();
      if (str) {
        logEventBus.emit('log', {
          level: 'info' as const,
          category: 'system',
          message: str,
        });
      }
    }
    return originalWrite(chunk);
  };

  return dest;
};

const logger = pino({
  level: config.nodeEnv === 'development' ? 'debug' : 'info',
  base: {
    pid: false,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
}, createLogHookDestination());

export default logger;
