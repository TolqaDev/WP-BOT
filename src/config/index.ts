import dotenv from 'dotenv';
import path from 'path';
import type { AppConfig } from '../types';

dotenv.config();

const parseCorsWhiteList = (value: string | undefined): string[] => {
  if (!value || value.trim() === '') return [];
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
};

const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionPath: process.env.SESSION_PATH || path.join(process.cwd(), 'public', 'auth_info'),
  timezone: process.env.TZ || 'UTC',
  cacheClearInterval: parseInt(process.env.CACHE_CLEAR_INTERVAL || '0', 10),
  queue: {
    delayMs: parseInt(process.env.QUEUE_DELAY_MS || '3000', 10),
    maxRetry: parseInt(process.env.QUEUE_MAX_RETRY || '3', 10),
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },
  security: {
    apiKey: process.env.API_KEY || '',
  },
  whatsapp: {
    autoRead: process.env.AUTO_READ?.toLowerCase() === 'true',
    notify: process.env.NOTIFY?.toLowerCase() === 'true',
    corsWhiteList: parseCorsWhiteList(process.env.CORS_WHITE_LIST),
    callReject: {
      enabled: process.env.AUTO_REJECT_CALLS?.toLowerCase() === 'true',
    },
  },
};

export default Object.freeze(config);
