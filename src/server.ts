import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { rateLimiter } from './middlewares/rateLimiter';
import logger from './utils/logger';
import config from './config';

const SERVER_CONFIG = {
  JSON_LIMIT: '10mb',
  REQUEST_TIMEOUT_MS: 30000,
  KEEP_ALIVE_TIMEOUT_MS: 65000,
  HEADERS_TIMEOUT_MS: 66000,
} as const;

const getCorsOrigin = (): string | string[] | boolean | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void) => {
  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin) {
    if (corsOrigin === '*') return true; // reflect request origin (credentials uyumlu)
    return corsOrigin.split(',').map(s => s.trim()).filter(Boolean);
  }
  return true; // production dahil tüm originlere izin ver (chrome extension için gerekli)
};

const corsOptions = {
  origin: getCorsOrigin(),
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true,
  maxAge: 86400,
};

const helmetOptions = {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' as const },
};

export const createServer = (): Application => {
  const app = express();

  app.set('trust proxy', process.env.TRUST_PROXY ? parseInt(process.env.TRUST_PROXY) || 1 : 1);
  app.use(helmet(helmetOptions));
  app.use(cors(corsOptions));
  app.use(express.json({ limit: SERVER_CONFIG.JSON_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: SERVER_CONFIG.JSON_LIMIT }));
  app.use(rateLimiter);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    res.setHeader('X-Request-ID', requestId);

    res.on('finish', () => {
      const duration = Number(process.hrtime.bigint() - start) / 1_000_000;
      const logData = {
        requestId,
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration: `${duration.toFixed(2)}ms`,
        userAgent: req.get('user-agent')?.substring(0, 50),
      };

      if (res.statusCode >= 500) logger.error(logData, 'Request error');
      else if (res.statusCode >= 400) logger.warn(logData, 'Request failed');
      else logger.debug(logData, 'Request completed');
    });
    next();
  });

  app.get('/health', (_: Request, res: Response) => {
    const memoryUsage = process.memoryUsage();
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      version: process.env.npm_package_version || '1.0.0',
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        unit: 'MB',
      },
    });
  });

  app.use('/api', routes);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export const startServer = (app: Application): void => {
  const server = app.listen(config.port, () => {
    logger.info({
      port: config.port,
      environment: config.nodeEnv,
      nodeVersion: process.version,
    }, 'Server started');
    logger.info(`Health check: http://localhost:${config.port}/health`);
    logger.info(`API base URL: http://localhost:${config.port}/api`);
  });

  server.keepAliveTimeout = SERVER_CONFIG.KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = SERVER_CONFIG.HEADERS_TIMEOUT_MS;
};
