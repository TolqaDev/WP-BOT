import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { rateLimiter } from './middlewares/rateLimiter';
import logger from './utils/logger';
import config from './config';

/**
 * Server Configuration Constants
 */
const SERVER_CONFIG = {
  JSON_LIMIT: '10mb',
  REQUEST_TIMEOUT_MS: 30000,
  KEEP_ALIVE_TIMEOUT_MS: 65000,
  HEADERS_TIMEOUT_MS: 66000,
} as const;

/**
 * CORS Configuration
 */
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true,
  maxAge: 86400, // 24 hours preflight cache
};

/**
 * Helmet Security Configuration
 */
const helmetOptions = {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' as const },
};

export const createServer = (): Application => {
  const app = express();

  // Trust proxy for proper IP detection behind reverse proxy
  app.set('trust proxy', 1);

  // Security middleware
  app.use(helmet(helmetOptions));
  app.use(cors(corsOptions));

  // Body parsers with size limits
  app.use(express.json({ limit: SERVER_CONFIG.JSON_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: SERVER_CONFIG.JSON_LIMIT }));

  // Rate limiting
  app.use(rateLimiter);

  // Request logging middleware with performance tracking
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Add request ID to headers for tracing
    res.setHeader('X-Request-ID', requestId);

    res.on('finish', () => {
      const duration = Number(process.hrtime.bigint() - start) / 1_000_000; // Convert to ms
      const logData = {
        requestId,
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration: `${duration.toFixed(2)}ms`,
        userAgent: req.get('user-agent')?.substring(0, 50),
      };

      // Log level based on status code
      if (res.statusCode >= 500) {
        logger.error(logData, 'Request error');
      } else if (res.statusCode >= 400) {
        logger.warn(logData, 'Request failed');
      } else {
        logger.debug(logData, 'Request completed');
      }
    });
    next();
  });

  // Health check endpoint (no auth required)
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

  // API routes
  app.use('/api', routes);

  // Error handlers
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

  // Configure server timeouts for SSE and long-polling
  server.keepAliveTimeout = SERVER_CONFIG.KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = SERVER_CONFIG.HEADERS_TIMEOUT_MS;
};
