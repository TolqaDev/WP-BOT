import { Router } from 'express';
import authController from '../controllers/AuthController';
import messageController from '../controllers/MessageController';
import bulkController from '../controllers/BulkController';
import statsController from '../controllers/StatsController';
import settingsController from '../controllers/SettingsController';
import { asyncHandler } from '../middlewares/errorHandler';
import { strictRateLimiter } from '../middlewares/rateLimiter';
import { requireConnection } from '../middlewares/connectionGuard';
import authMiddleware from '../middlewares/auth';
import sseGuard from '../middlewares/sseGuard';

const router = Router();

router.use(authMiddleware);

router.get('/auth/qr/stream', sseGuard, authController.streamQR.bind(authController));
router.get('/messages/stream', sseGuard, messageController.streamMessages.bind(messageController));

router.get('/auth/qr', asyncHandler(authController.getQR.bind(authController)));
router.get('/auth/qr/image', asyncHandler(authController.getQRImage.bind(authController)));
router.get('/auth/status', authController.getStatus.bind(authController));
router.post('/auth/logout', asyncHandler(authController.logout.bind(authController)));
router.post('/auth/cancel', asyncHandler(authController.cancelConnection.bind(authController)));

router.post(
  '/messages/send',
  requireConnection,
  strictRateLimiter(30, 60000),
  asyncHandler(messageController.send.bind(messageController))
);
// Message history - daha gevşek rate limit çünkü sık çağrılıyor
router.get('/messages/history/:jid', asyncHandler(messageController.getHistory.bind(messageController)));
router.get('/messages/chats', messageController.getChats.bind(messageController));
router.delete('/messages/history/:jid?', messageController.clearHistory.bind(messageController));

router.post(
  '/messages/schedule',
  requireConnection,
  strictRateLimiter(20, 60000),
  messageController.scheduleMessage.bind(messageController)
);
router.get('/messages/scheduled', messageController.getScheduledMessages.bind(messageController));
router.get('/messages/scheduled/:id', messageController.getScheduledMessage.bind(messageController));
router.put(
  '/messages/scheduled/:id',
  messageController.updateScheduledMessage.bind(messageController)
);
router.delete(
  '/messages/scheduled/completed',
  messageController.clearCompletedScheduled.bind(messageController)
);
router.delete(
  '/messages/scheduled/:id',
  messageController.cancelScheduledMessage.bind(messageController)
);

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

router.delete(
  '/messages/:jid/:messageId',
  requireConnection,
  asyncHandler(messageController.deleteMessage.bind(messageController))
);

router.get('/messages/stats', messageController.getChatStats.bind(messageController));

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

router.get('/settings', settingsController.getSettings.bind(settingsController));
router.put('/settings', settingsController.updateSettings.bind(settingsController));

router.get('/stats', statsController.getStats.bind(statsController));
router.get('/stats/system', statsController.getSystemStats.bind(statsController));
router.get('/stats/whatsapp', statsController.getWhatsAppStats.bind(statsController));
router.get('/stats/queue', statsController.getQueueStats.bind(statsController));

// Cache management
router.post('/cache/clear', asyncHandler(statsController.clearCache.bind(statsController)));
router.get('/cache/stats', asyncHandler(statsController.getCacheStats.bind(statsController)));

export default router;
