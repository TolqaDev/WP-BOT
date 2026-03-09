import { Router } from 'express';
import authController from '../controllers/AuthController';
import messageController from '../controllers/MessageController';
import bulkController from '../controllers/BulkController';
import statsController from '../controllers/StatsController';
import settingsController from '../controllers/SettingsController';
import terminalController from '../controllers/TerminalController';
import { asyncHandler } from '../middlewares/errorHandler';
import { strictRateLimiter } from '../middlewares/rateLimiter';
import { requireConnection } from '../middlewares/connectionGuard';
import authMiddleware from '../middlewares/auth';
import sseGuard from '../middlewares/sseGuard';

const router = Router();

router.use(authMiddleware);

// SSE
router.get('/auth/qr/stream', sseGuard, authController.streamQR.bind(authController));
router.get('/messages/stream', sseGuard, messageController.streamMessages.bind(messageController));
router.get('/terminal/stream', sseGuard, terminalController.streamTerminal.bind(terminalController));

// Auth
router.get('/auth/qr', asyncHandler(authController.getQR.bind(authController)));
router.get('/auth/qr/image', asyncHandler(authController.getQRImage.bind(authController)));
router.get('/auth/status', asyncHandler(authController.getStatus.bind(authController)));
router.post('/auth/logout', asyncHandler(authController.logout.bind(authController)));
router.post('/auth/cancel', asyncHandler(authController.cancelConnection.bind(authController)));

// Messages
router.post(
  '/messages/send',
  requireConnection,
  strictRateLimiter(30, 60000),
  asyncHandler(messageController.send.bind(messageController))
);
router.get('/messages/history/:jid', asyncHandler(messageController.getHistory.bind(messageController)));
router.get('/messages/chats', messageController.getChats.bind(messageController));
router.get(
  '/messages/check/:phone',
  requireConnection,
  asyncHandler(messageController.checkNumber.bind(messageController))
);
router.get(
  '/messages/profile/:jid',
  requireConnection,
  asyncHandler(messageController.getProfile.bind(messageController))
);
router.post(
  '/messages/typing/:jid',
  requireConnection,
  asyncHandler(messageController.sendTyping.bind(messageController))
);
router.post(
  '/messages/read/:jid',
  requireConnection,
  asyncHandler(messageController.markAsRead.bind(messageController))
);
router.get('/messages/stats', messageController.getChatStats.bind(messageController));

// Scheduled Messages
router.post(
  '/messages/schedule',
  requireConnection,
  strictRateLimiter(20, 60000),
  messageController.scheduleMessage.bind(messageController)
);
router.get('/messages/scheduled', messageController.getScheduledMessages.bind(messageController));
router.get('/messages/scheduled/:id', messageController.getScheduledMessage.bind(messageController));
router.put('/messages/scheduled/:id', messageController.updateScheduledMessage.bind(messageController));
router.delete('/messages/scheduled/completed', messageController.clearCompletedScheduled.bind(messageController));
router.delete('/messages/scheduled/:id', messageController.cancelScheduledMessage.bind(messageController));

// Cache
router.delete('/messages/cache', messageController.clearAllCache.bind(messageController));
router.delete('/messages/cache/:jid', messageController.clearChatCache.bind(messageController));

// Bulk
router.post(
  '/bulk/send',
  requireConnection,
  strictRateLimiter(10, 60000),
  bulkController.create.bind(bulkController)
);
router.get('/bulk/jobs', bulkController.getAllJobs.bind(bulkController));
router.get('/bulk/status/:jobId', bulkController.getStatus.bind(bulkController));
router.get('/bulk/status/:jobId/detailed', bulkController.getDetailedStatus.bind(bulkController));
router.post('/bulk/pause/:jobId', bulkController.pause.bind(bulkController));
router.post('/bulk/resume/:jobId', bulkController.resume.bind(bulkController));
router.post('/bulk/cancel/:jobId', bulkController.cancel.bind(bulkController));
router.delete('/bulk/job/:jobId', bulkController.delete.bind(bulkController));
router.delete('/bulk/completed', bulkController.clearCompleted.bind(bulkController));

// Settings & Stats
router.get('/settings', settingsController.getSettings.bind(settingsController));
router.put('/settings', settingsController.updateSettings.bind(settingsController));
router.get('/stats', statsController.getStats.bind(statsController));

export default router;
