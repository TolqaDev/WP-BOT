import { Request, Response } from 'express';
import fs from 'fs';
import whatsAppService from '../services/WhatsAppService';
import { ResponseFormatter } from '../views/ResponseFormatter';
import logger from '../utils/logger';
import type { StatusResponse, QRResponse } from '../types';

export class AuthController {
  /** GET /api/auth/qr/image */
  public async getQRImage(req: Request, res: Response): Promise<void> {
    try {
      const state = whatsAppService.getState();

      if (state.isConnected) {
        res.status(400).json(ResponseFormatter.error('Already connected, no QR code available'));
        return;
      }

      if (!state.isConnecting) {
        await whatsAppService.connect();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const qrFilePath = whatsAppService.getQRFilePath();
      const exists = await whatsAppService.qrFileExists();

      if (!exists) {
        res.status(404).json(ResponseFormatter.error('QR code not available yet, try again in a few seconds'));
        return;
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const stream = fs.createReadStream(qrFilePath);
      stream.pipe(res);
      stream.on('error', (error) => {
        logger.error({ error }, 'Failed to stream QR image');
        if (!res.headersSent) {
          res.status(500).json(ResponseFormatter.serverError('Failed to read QR image'));
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get QR image');
      res.status(500).json(ResponseFormatter.serverError('Failed to get QR image'));
    }
  }

  /** GET /api/auth/qr */
  public async getQR(req: Request, res: Response): Promise<void> {
    try {
      const state = whatsAppService.getState();

      if (state.isConnected) {
        res.status(200).json(
          ResponseFormatter.success<StatusResponse>(
            { isConnected: true, session: whatsAppService.getSessionInfo() || undefined },
            'Already connected'
          )
        );
        return;
      }

      if (!state.isConnecting) {
        await whatsAppService.connect();
      }

      const qrCode = await this.waitForQR(10000);

      if (qrCode) {
        res.status(200).json(
          ResponseFormatter.success<QRResponse>({ qrCode, expiresIn: 30 }, 'Scan QR code to connect')
        );
      } else {
        const currentState = whatsAppService.getState();
        if (currentState.isConnected) {
          res.status(200).json(
            ResponseFormatter.success<StatusResponse>(
              { isConnected: true, session: whatsAppService.getSessionInfo() || undefined },
              'Connected'
            )
          );
        } else {
          res.status(202).json(
            ResponseFormatter.success({ isConnecting: true }, 'Connection in progress, please try again')
          );
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to get QR code');
      res.status(500).json(ResponseFormatter.serverError('Failed to initialize connection'));
    }
  }

  /** GET /api/auth/qr/stream (SSE) */
  public async streamQR(req: Request, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let isEnded = false;
    let connectionConfirmed = false;
    let connectionConfirmTimeout: NodeJS.Timeout | null = null;

    const safeWrite = (data: string) => {
      if (!isEnded && !res.writableEnded) {
        try { res.write(data); } catch { }
      }
    };

    const safeEnd = () => {
      if (!isEnded && !res.writableEnded) {
        isEnded = true;
        cleanup();
        try { res.end(); } catch { }
      }
    };

    const state = whatsAppService.getState();
    logger.info({ isConnected: state.isConnected, isConnecting: state.isConnecting, hasQR: !!state.qrCode }, 'QR stream requested');

    if (state.isConnected) {
      safeWrite(`data: ${JSON.stringify({ type: 'connected', session: whatsAppService.getSessionInfo() })}\n\n`);
      safeEnd();
      return;
    }

    safeWrite(`data: ${JSON.stringify({ type: 'waiting', message: 'Initializing connection...' })}\n\n`);

    const qrHandler = (qr: string) => {
      logger.debug('QR event received, forwarding to SSE client');
      safeWrite(`data: ${JSON.stringify({ type: 'qr', qrCode: qr })}\n\n`);
    };

    const connectedHandler = (session: any) => {
      safeWrite(`data: ${JSON.stringify({ type: 'connected', session })}\n\n`);
      connectionConfirmed = true;
      if (connectionConfirmTimeout) clearTimeout(connectionConfirmTimeout);

      connectionConfirmTimeout = setTimeout(() => {
        const currentState = whatsAppService.getState();
        if (currentState.isConnected) {
          safeEnd();
        } else {
          connectionConfirmed = false;
        }
      }, 5000);
    };

    const disconnectedHandler = (reason: string) => {
      safeWrite(`data: ${JSON.stringify({ type: 'disconnected', reason })}\n\n`);
      if (connectionConfirmed && !whatsAppService.getState().isConnecting) {
        if (connectionConfirmTimeout) clearTimeout(connectionConfirmTimeout);
      }
    };

    const reconnectingHandler = (data: { attempt: number; delay: number; reason: string }) => {
      safeWrite(`data: ${JSON.stringify({ type: 'reconnecting', ...data })}\n\n`);
      if (connectionConfirmTimeout) {
        clearTimeout(connectionConfirmTimeout);
        connectionConfirmTimeout = null;
      }
    };

    const cleanup = () => {
      whatsAppService.removeListener('qr', qrHandler);
      whatsAppService.removeListener('connected', connectedHandler);
      whatsAppService.removeListener('disconnected', disconnectedHandler);
      whatsAppService.removeListener('reconnecting', reconnectingHandler);
      if (connectionConfirmTimeout) {
        clearTimeout(connectionConfirmTimeout);
        connectionConfirmTimeout = null;
      }
    };

    whatsAppService.on('qr', qrHandler);
    whatsAppService.on('connected', connectedHandler);
    whatsAppService.on('disconnected', disconnectedHandler);
    whatsAppService.on('reconnecting', reconnectingHandler);

    const liveState = whatsAppService.getState();
    if (liveState.isConnecting) {
      logger.info('Active connection attempt detected, cancelling for fresh QR generation');
      whatsAppService.removeListener('disconnected', disconnectedHandler);
      try {
        await whatsAppService.cancelConnection();
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch {
      }
      whatsAppService.on('disconnected', disconnectedHandler);
    }

    logger.info('Starting WhatsApp connection for QR generation...');
    try {
      const connectPromise = whatsAppService.connect();
      connectPromise.then(() => {
        logger.info('connect() resolved, waiting for Baileys QR/connection events');
      }).catch(error => {
        logger.error({ error }, 'connect() failed during QR stream');
        safeWrite(`data: ${JSON.stringify({ type: 'error', message: 'Connection initialization failed' })}\n\n`);
      });
    } catch (syncError) {
      logger.error({ error: syncError }, 'Synchronous error calling connect()');
      safeWrite(`data: ${JSON.stringify({ type: 'error', message: 'Failed to start connection' })}\n\n`);
      safeEnd();
      return;
    }

    const postConnectState = whatsAppService.getState();
    if (postConnectState.qrCode) {
      logger.debug('QR already available, sending immediately');
      safeWrite(`data: ${JSON.stringify({ type: 'qr', qrCode: postConnectState.qrCode })}\n\n`);
    }

    if (postConnectState.isConnected) {
      safeWrite(`data: ${JSON.stringify({ type: 'connected', session: whatsAppService.getSessionInfo() })}\n\n`);
      connectionConfirmed = true;
      connectionConfirmTimeout = setTimeout(() => {
        if (whatsAppService.getState().isConnected) {
          safeEnd();
        }
      }, 5000);
    }

    req.on('close', () => { isEnded = true; cleanup(); });

    setTimeout(() => {
      safeWrite(`data: ${JSON.stringify({ type: 'timeout' })}\n\n`);
      safeEnd();
    }, 160000);
  }

  /** GET /api/auth/status */
  public async getStatus(req: Request, res: Response): Promise<void> {
    const state = whatsAppService.getState();
    const session = whatsAppService.getSessionInfo();
    const hasExistingSession = await whatsAppService.hasExistingSession();

    res.status(200).json(
      ResponseFormatter.success<StatusResponse>({
        isConnected: state.isConnected,
        isConnecting: state.isConnecting,
        hasSession: hasExistingSession,
        session: session || undefined,
      })
    );
  }

  /** POST /api/auth/logout */
  public async logout(req: Request, res: Response): Promise<void> {
    try {
      const state = whatsAppService.getState();

      if (!state.isConnected && !state.isConnecting) {
        const hasSession = await whatsAppService.hasExistingSession();
        if (!hasSession) {
          res.status(409).json(
            ResponseFormatter.conflict('No active session to logout from')
          );
          return;
        }
      }

      await whatsAppService.disconnect();
      res.status(200).json(ResponseFormatter.noContent('Logged out successfully'));
    } catch (error) {
      logger.error({ error }, 'Failed to logout');
      res.status(500).json(ResponseFormatter.serverError('Failed to logout'));
    }
  }

  /** POST /api/auth/cancel */
  public async cancelConnection(req: Request, res: Response): Promise<void> {
    try {
      const state = whatsAppService.getState();

      if (state.isConnected) {
        res.status(400).json(
          ResponseFormatter.badRequest('Cannot cancel: Active session exists. Use /auth/logout to disconnect.')
        );
        return;
      }

      if (!state.isConnecting) {
        res.status(400).json(ResponseFormatter.badRequest('No connection attempt in progress to cancel'));
        return;
      }

      await whatsAppService.cancelConnection();
      res.status(200).json(
        ResponseFormatter.success({ cancelled: true }, 'Connection attempt cancelled successfully')
      );
    } catch (error) {
      logger.error({ error }, 'Failed to cancel connection');
      res.status(500).json(ResponseFormatter.serverError('Failed to cancel connection'));
    }
  }

  private waitForQR(timeout: number): Promise<string | null> {
    return new Promise((resolve) => {
      const currentQR = whatsAppService.getState().qrCode;
      if (currentQR) { resolve(currentQR); return; }

      const timer = setTimeout(() => {
        whatsAppService.removeListener('qr', handler);
        whatsAppService.removeListener('connected', connectedHandler);
        resolve(null);
      }, timeout);

      const handler = (qr: string) => {
        clearTimeout(timer);
        whatsAppService.removeListener('qr', handler);
        whatsAppService.removeListener('connected', connectedHandler);
        resolve(qr);
      };

      const connectedHandler = () => {
        clearTimeout(timer);
        whatsAppService.removeListener('qr', handler);
        whatsAppService.removeListener('connected', connectedHandler);
        resolve(null);
      };

      whatsAppService.on('qr', handler);
      whatsAppService.on('connected', connectedHandler);
    });
  }
}

export default new AuthController();
