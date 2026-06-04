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

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: process.env.npm_package_version || '1.0.0',
  });
});

router.use(authMiddleware);

router.get('/auth/qr/stream', authController.streamQR.bind(authController));
router.get('/terminal/stream', terminalController.streamTerminal.bind(terminalController));

router.delete('/terminal/logs', terminalController.clearLogs.bind(terminalController));

router.get('/auth/qr', asyncHandler(authController.getQR.bind(authController)));
router.get('/auth/qr/image', asyncHandler(authController.getQRImage.bind(authController)));
router.get('/auth/status', asyncHandler(authController.getStatus.bind(authController)));
router.post('/auth/pairing-code', strictRateLimiter(5, 60000), asyncHandler(authController.requestPairingCode.bind(authController)));
router.post('/auth/logout', asyncHandler(authController.logout.bind(authController)));
router.post('/auth/cancel', asyncHandler(authController.cancelConnection.bind(authController)));
router.post('/auth/reconnect', asyncHandler(authController.reconnect.bind(authController)));

router.post(
  '/messages/send',
  requireConnection,
  strictRateLimiter(30, 60000),
  asyncHandler(messageController.send.bind(messageController))
);
router.post(
  '/messages/validate',
  requireConnection,
  strictRateLimiter(60, 60000),
  asyncHandler(messageController.validateNumbers.bind(messageController))
);
router.post(
  '/messages/typing/:jid',
  requireConnection,
  asyncHandler(messageController.sendTyping.bind(messageController))
);

router.post(
  '/messages/schedule',
  requireConnection,
  strictRateLimiter(20, 60000),
  asyncHandler(messageController.scheduleMessage.bind(messageController))
);
router.get('/messages/scheduled', messageController.getScheduledMessages.bind(messageController));
router.get('/messages/scheduled/:id', messageController.getScheduledMessage.bind(messageController));
router.put('/messages/scheduled/:id', messageController.updateScheduledMessage.bind(messageController));
router.delete('/messages/scheduled/completed', messageController.clearCompletedScheduled.bind(messageController));
router.post('/messages/scheduled/:id/cancel', messageController.cancelScheduledMessage.bind(messageController));
router.delete('/messages/scheduled/:id', messageController.deleteScheduledMessage.bind(messageController));

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
router.post('/settings/reload', settingsController.reloadSettings.bind(settingsController));
router.get('/stats', statsController.getStats.bind(statsController));

export default router;
