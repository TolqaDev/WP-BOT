import { createServer, startServer } from './server';
import whatsAppService from './services/WhatsAppService';
import './services/MessageService';
import queueService from './services/QueueService';
import logger from './utils/logger';

const initializeServices = (): void => {
  logger.info('MessageService initialized');

  queueService.on('jobCreated', (jobId) => {
    logger.info({ jobId }, 'Bulk job created');
  });

  queueService.on('jobCompleted', (jobId, stats) => {
    logger.info({ jobId, stats }, 'Bulk job completed');
  });

  whatsAppService.on('connected', (session) => {
    logger.info({ session }, 'WhatsApp connected');
  });

  whatsAppService.on('disconnected', (reason) => {
    logger.warn({ reason }, 'WhatsApp disconnected');
  });

  whatsAppService.on('message', (message) => {
    logger.debug({ from: message.from, type: message.type }, 'New message received');
  });

  logger.info('Services initialized');
};

const gracefulShutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Received shutdown signal');

  try {
    await whatsAppService.gracefulClose();
    logger.info('WhatsApp connection closed gracefully');
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
  }

  process.exit(0);
};

process.on('uncaughtException', (error) => {
  logger.fatal({ error, stack: error.stack }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason: any, promise) => {
  const errorInfo = {
    reason: reason,
    message: reason?.message || 'Unknown',
    stack: reason?.stack || 'No stack trace',
    promise: promise
  };
  logger.error(errorInfo, 'Unhandled rejection');

  if (process.env.NODE_ENV === 'production') {
    logger.fatal(errorInfo, 'Unhandled rejection in production - shutting down');
    process.exit(1);
  }
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const main = async (): Promise<void> => {
  try {
    logger.info('Starting WhatsApp BOT API...');

    initializeServices();

    const app = createServer();
    startServer(app);

    const autoConnected = await whatsAppService.autoConnect();
    if (autoConnected) {
      logger.info('Auto-connect initiated with existing session');
    } else {
      logger.info('No existing session - waiting for QR code scan');
    }

    logger.info('Application started successfully');
  } catch (error) {
    logger.fatal({ error }, 'Failed to start application');
    process.exit(1);
  }
};

main();
