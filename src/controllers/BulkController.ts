import { Request, Response } from 'express';
import queueService from '../services/QueueService';
import whatsAppService from '../services/WhatsAppService';
import { ResponseFormatter } from '../views/ResponseFormatter';
import logger from '../utils/logger';
import type { BulkSendPayload } from '../types';

export class BulkController {
  /** POST /api/bulk/send */
  public create(req: Request, res: Response): void {
    try {
      const payload = req.body as BulkSendPayload;

      if (!payload.recipients || !Array.isArray(payload.recipients) || payload.recipients.length === 0) {
        res.status(400).json(ResponseFormatter.badRequest('recipients must be a non-empty array'));
        return;
      }

      if (payload.recipients.some((r) => typeof r !== 'string')) {
        res.status(400).json(ResponseFormatter.badRequest('All recipients must be strings'));
        return;
      }

      const messageType = payload.type || 'text';

      if (messageType === 'text') {
        if (!payload.message || typeof payload.message !== 'string') {
          res.status(400).json(ResponseFormatter.badRequest('message is required for text messages'));
          return;
        }
      } else {
        if (!payload.mediaUrl && !payload.mediaBase64) {
          res.status(400).json(ResponseFormatter.badRequest('mediaUrl or mediaBase64 is required for media messages'));
          return;
        }
      }

      if (payload.timeWindow) {
        const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
        if (!payload.timeWindow.startTime || !timeRegex.test(payload.timeWindow.startTime)) {
          res.status(400).json(ResponseFormatter.badRequest('Invalid startTime format. Use HH:mm (e.g., 09:00)'));
          return;
        }
        if (!payload.timeWindow.endTime || !timeRegex.test(payload.timeWindow.endTime)) {
          res.status(400).json(ResponseFormatter.badRequest('Invalid endTime format. Use HH:mm (e.g., 18:00)'));
          return;
        }
      }

      if (payload.scheduledAt) {
        const scheduledDate = new Date(payload.scheduledAt);
        if (isNaN(scheduledDate.getTime())) {
          res.status(400).json(ResponseFormatter.badRequest('Invalid scheduledAt format. Use ISO 8601 format.'));
          return;
        }
        if (scheduledDate < new Date(Date.now() + 60000)) {
          res.status(400).json(ResponseFormatter.badRequest('scheduledAt must be at least 1 minute in the future'));
          return;
        }
      }

      if (payload.minDelay !== undefined && (typeof payload.minDelay !== 'number' || payload.minDelay < 0)) {
        res.status(400).json(ResponseFormatter.badRequest('minDelay must be a positive number'));
        return;
      }
      if (payload.maxDelay !== undefined && (typeof payload.maxDelay !== 'number' || payload.maxDelay < 0)) {
        res.status(400).json(ResponseFormatter.badRequest('maxDelay must be a positive number'));
        return;
      }
      if (payload.minDelay !== undefined && payload.maxDelay !== undefined && payload.minDelay > payload.maxDelay) {
        res.status(400).json(ResponseFormatter.badRequest('minDelay cannot be greater than maxDelay'));
        return;
      }

      if (!whatsAppService.isReady()) {
        res.status(503).json(ResponseFormatter.error('Not connected to WhatsApp', 'Service unavailable'));
        return;
      }

      const job = queueService.createBulkJob(payload);
      const stats = queueService.getJobStats(job.jobId);

      res.status(201).json(
        ResponseFormatter.created(
          stats,
          payload.scheduledAt
            ? `Bulk job scheduled for ${new Date(payload.scheduledAt).toISOString()}`
            : 'Bulk job created and queued'
        )
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error }, 'Failed to create bulk job');
      res.status(400).json(ResponseFormatter.badRequest(errorMessage));
    }
  }

  /** GET /api/bulk/status/:jobId */
  public getStatus(req: Request, res: Response): void {
    try {
      const jobId = req.params.jobId as string;
      if (!jobId) { res.status(400).json(ResponseFormatter.badRequest('jobId parameter is required')); return; }

      const stats = queueService.getJobStats(jobId);
      if (!stats) { res.status(404).json(ResponseFormatter.notFound('Job')); return; }

      res.status(200).json(ResponseFormatter.success(stats));
    } catch (error) {
      logger.error({ error }, 'Failed to get job status');
      res.status(500).json(ResponseFormatter.serverError('Failed to get job status'));
    }
  }

  /** GET /api/bulk/status/:jobId/detailed */
  public getDetailedStatus(req: Request, res: Response): void {
    try {
      const jobId = req.params.jobId as string;
      if (!jobId) { res.status(400).json(ResponseFormatter.badRequest('jobId parameter is required')); return; }

      const stats = queueService.getJobDetailedStats(jobId);
      if (!stats) { res.status(404).json(ResponseFormatter.notFound('Job')); return; }

      res.status(200).json(ResponseFormatter.success(stats));
    } catch (error) {
      logger.error({ error }, 'Failed to get detailed job status');
      res.status(500).json(ResponseFormatter.serverError('Failed to get detailed job status'));
    }
  }

  /** GET /api/bulk/jobs */
  public getAllJobs(req: Request, res: Response): void {
    try {
      const jobs = queueService.getAllJobs();
      res.status(200).json(
        ResponseFormatter.success({ jobs, totalJobs: jobs.length, totalPending: queueService.getQueueSize() })
      );
    } catch (error) {
      logger.error({ error }, 'Failed to get all jobs');
      res.status(500).json(ResponseFormatter.serverError('Failed to get all jobs'));
    }
  }

  /** POST /api/bulk/pause/:jobId */
  public pause(req: Request, res: Response): void {
    try {
      const jobId = req.params.jobId as string;
      if (!jobId) { res.status(400).json(ResponseFormatter.badRequest('jobId parameter is required')); return; }

      const success = queueService.pauseJob(jobId, req.body?.reason);
      if (!success) {
        const job = queueService.getJob(jobId);
        if (!job) { res.status(404).json(ResponseFormatter.notFound('Job')); }
        else { res.status(400).json(ResponseFormatter.badRequest('Job cannot be paused (not in processing or queued state)')); }
        return;
      }

      res.status(200).json(ResponseFormatter.success(queueService.getJobStats(jobId), 'Job paused successfully'));
    } catch (error) {
      logger.error({ error }, 'Failed to pause job');
      res.status(500).json(ResponseFormatter.serverError('Failed to pause job'));
    }
  }

  /** POST /api/bulk/resume/:jobId */
  public resume(req: Request, res: Response): void {
    try {
      const jobId = req.params.jobId as string;
      if (!jobId) { res.status(400).json(ResponseFormatter.badRequest('jobId parameter is required')); return; }

      const success = queueService.resumeJob(jobId);
      if (!success) {
        const job = queueService.getJob(jobId);
        if (!job) { res.status(404).json(ResponseFormatter.notFound('Job')); }
        else { res.status(400).json(ResponseFormatter.badRequest('Job cannot be resumed (not in paused state)')); }
        return;
      }

      res.status(200).json(ResponseFormatter.success(queueService.getJobStats(jobId), 'Job resumed successfully'));
    } catch (error) {
      logger.error({ error }, 'Failed to resume job');
      res.status(500).json(ResponseFormatter.serverError('Failed to resume job'));
    }
  }

  /** POST /api/bulk/cancel/:jobId */
  public cancel(req: Request, res: Response): void {
    try {
      const jobId = req.params.jobId as string;
      if (!jobId) { res.status(400).json(ResponseFormatter.badRequest('jobId parameter is required')); return; }

      const success = queueService.cancelJob(jobId);
      if (!success) {
        const job = queueService.getJob(jobId);
        if (!job) { res.status(404).json(ResponseFormatter.notFound('Job')); }
        else { res.status(400).json(ResponseFormatter.badRequest('Job cannot be cancelled (already completed or cancelled)')); }
        return;
      }

      res.status(200).json(ResponseFormatter.success(queueService.getJobStats(jobId), 'Job cancelled successfully'));
    } catch (error) {
      logger.error({ error }, 'Failed to cancel job');
      res.status(500).json(ResponseFormatter.serverError('Failed to cancel job'));
    }
  }

  /** DELETE /api/bulk/job/:jobId */
  public delete(req: Request, res: Response): void {
    try {
      const jobId = req.params.jobId as string;
      if (!jobId) { res.status(400).json(ResponseFormatter.badRequest('jobId parameter is required')); return; }

      const success = queueService.deleteJob(jobId);
      if (!success) {
        const job = queueService.getJob(jobId);
        if (!job) { res.status(404).json(ResponseFormatter.notFound('Job')); }
        else { res.status(400).json(ResponseFormatter.badRequest('Cannot delete job while processing')); }
        return;
      }

      res.status(200).json(ResponseFormatter.noContent('Job deleted successfully'));
    } catch (error) {
      logger.error({ error }, 'Failed to delete job');
      res.status(500).json(ResponseFormatter.serverError('Failed to delete job'));
    }
  }

  /** DELETE /api/bulk/completed */
  public clearCompleted(req: Request, res: Response): void {
    try {
      const count = queueService.clearCompletedJobs();
      res.status(200).json(ResponseFormatter.success({ cleared: count }, `${count} completed jobs cleared`));
    } catch (error) {
      logger.error({ error }, 'Failed to clear completed jobs');
      res.status(500).json(ResponseFormatter.serverError('Failed to clear completed jobs'));
    }
  }
}

export default new BulkController();
