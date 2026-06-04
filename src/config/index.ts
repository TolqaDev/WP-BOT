import dotenv from 'dotenv';
import path from 'path';
import type { AppConfig } from '../types';

dotenv.config();


const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionPath: process.env.SESSION_PATH || path.join(process.cwd(), 'public', 'auth_info'),
  timezone: process.env.TZ || 'UTC',
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
    callReject: {
      enabled: process.env.AUTO_REJECT_CALLS?.toLowerCase() === 'true',
    },
    typingDuration: parseInt(process.env.TYPING_DURATION || '4000', 10),
  },
};

export default Object.freeze(config);
