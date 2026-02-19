import { Request, Response } from 'express';
import fs from 'fs';
import whatsAppService from '../services/WhatsAppService';
import { ResponseFormatter } from '../views/ResponseFormatter';
import logger from '../utils/logger';
import type { StatusResponse, QRResponse } from '../types';

export class AuthController {
  /**
   * Get QR code as PNG image file
   */
  public async getQRImage(req: Request, res: Response): Promise<void> {
    try {
      const state = whatsAppService.getState();

      // If already connected, no QR needed
      if (state.isConnected) {
        res.status(400).json(
          ResponseFormatter.error('Already connected, no QR code available')
        );
        return;
      }

      // Start connection if not already connecting
      if (!state.isConnecting) {
        await whatsAppService.connect();
        // Wait a bit for QR to be generated
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Check if QR file exists
      const qrFilePath = whatsAppService.getQRFilePath();
      const exists = await whatsAppService.qrFileExists();

      if (!exists) {
        res.status(404).json(
          ResponseFormatter.error('QR code not available yet, try again in a few seconds')
        );
        return;
      }

      // Set headers for image
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      // Stream the file
      const stream = fs.createReadStream(qrFilePath);
      stream.pipe(res);

      stream.on('error', (error) => {
        logger.error({ error }, 'Failed to stream QR image');
        if (!res.headersSent) {
          res.status(500).json(
            ResponseFormatter.serverError('Failed to read QR image')
          );
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get QR image');
      res.status(500).json(
        ResponseFormatter.serverError('Failed to get QR image')
      );
    }
  }

  /**
   * Initialize WhatsApp connection and return QR code
   */
  public async getQR(req: Request, res: Response): Promise<void> {
    try {
      const state = whatsAppService.getState();

      // If already connected, no QR needed
      if (state.isConnected) {
        res.status(200).json(
          ResponseFormatter.success<StatusResponse>(
            { isConnected: true, session: whatsAppService.getSessionInfo() || undefined },
            'Already connected'
          )
        );
        return;
      }

      // Start connection if not already connecting
      if (!state.isConnecting) {
        await whatsAppService.connect();
      }

      // Wait for QR code (max 10 seconds)
      const qrCode = await this.waitForQR(10000);

      if (qrCode) {
        res.status(200).json(
          ResponseFormatter.success<QRResponse>(
            { qrCode, expiresIn: 60 },
            'Scan QR code to connect'
          )
        );
      } else {
        // Check if connected during wait
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
            ResponseFormatter.success(
              { isConnecting: true },
              'Connection in progress, please try again'
            )
          );
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to get QR code');
      res.status(500).json(
        ResponseFormatter.serverError('Failed to initialize connection')
      );
    }
  }

  /**
   * SSE endpoint for real-time QR updates
   */
  public async streamQR(req: Request, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let isEnded = false;
    let connectionConfirmed = false;
    let connectionConfirmTimeout: NodeJS.Timeout | null = null;

    const safeWrite = (data: string) => {
      if (!isEnded && !res.writableEnded) {
        try {
          res.write(data);
        } catch (e) {
          // Connection already closed
        }
      }
    };

    const safeEnd = () => {
      if (!isEnded && !res.writableEnded) {
        isEnded = true;
        cleanup();
        try {
          res.end();
        } catch (e) {
          // Connection already closed
        }
      }
    };

    // Send initial state
    const state = whatsAppService.getState();
    if (state.isConnected) {
      safeWrite(`data: ${JSON.stringify({ type: 'connected', session: whatsAppService.getSessionInfo() })}\n\n`);
      safeEnd();
      return;
    }

    // If QR already available, send it
    if (state.qrCode) {
      safeWrite(`data: ${JSON.stringify({ type: 'qr', qrCode: state.qrCode })}\n\n`);
    }

    // Start connection if not already
    if (!state.isConnecting && !state.isConnected) {
      whatsAppService.connect().catch((err) => {
        logger.error({ err }, 'SSE: Connection failed');
      });
    }

    // Listen for QR updates
    const qrHandler = (qr: string) => {
      safeWrite(`data: ${JSON.stringify({ type: 'qr', qrCode: qr })}\n\n`);
    };

    // Listen for connection
    const connectedHandler = (session: any) => {
      safeWrite(`data: ${JSON.stringify({ type: 'connected', session })}\n\n`);

      // Stream error 515 nedeniyle bağlantı hemen sonra kesilebilir
      // Bu yüzden biraz bekleyip bağlantının stabil olduğunu doğruluyoruz
      connectionConfirmed = true;

      if (connectionConfirmTimeout) {
        clearTimeout(connectionConfirmTimeout);
      }

      // 5 saniye sonra hala bağlıysa stream'i kapat (515 error için daha fazla süre)
      connectionConfirmTimeout = setTimeout(() => {
        const currentState = whatsAppService.getState();
        if (currentState.isConnected) {
          logger.debug('Connection confirmed stable after 5s, closing QR stream');
          safeEnd();
        } else if (currentState.isConnecting) {
          // Reconnecting durumunda, stream'i açık tut
          connectionConfirmed = false;
          logger.debug('Still reconnecting after 5s, keeping stream open');
        } else {
          // Bağlantı kesilmiş, stream'i açık tut ve beklemeye devam et
          connectionConfirmed = false;
          logger.debug('Connection lost after connect event, keeping stream open');
        }
      }, 5000);
    };

    // Listen for disconnection
    const disconnectedHandler = (reason: string) => {
      safeWrite(`data: ${JSON.stringify({ type: 'disconnected', reason })}\n\n`);

      // Eğer bağlantı onaylandıysa ama sonra kesildiyse
      // ve bu bir reconnecting durumu değilse stream'i kapat
      if (connectionConfirmed && !whatsAppService.getState().isConnecting) {
        // Bağlantı kurulduktan sonra kalıcı olarak kesildi
        // (örn: logged out)
        if (connectionConfirmTimeout) {
          clearTimeout(connectionConfirmTimeout);
        }
      }
    };

    // Listen for reconnecting
    const reconnectingHandler = (data: { attempt: number; delay: number; reason: string }) => {
      safeWrite(`data: ${JSON.stringify({ type: 'reconnecting', ...data })}\n\n`);

      // Yeniden bağlanma başladı, confirm timeout'u iptal et
      if (connectionConfirmTimeout) {
        clearTimeout(connectionConfirmTimeout);
        connectionConfirmTimeout = null;
      }
    };

    whatsAppService.on('qr', qrHandler);
    whatsAppService.on('connected', connectedHandler);
    whatsAppService.on('disconnected', disconnectedHandler);
    whatsAppService.on('reconnecting', reconnectingHandler);

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

    // Cleanup on client disconnect
    req.on('close', () => {
      isEnded = true;
      cleanup();
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      safeWrite(`data: ${JSON.stringify({ type: 'timeout' })}\n\n`);
      safeEnd();
    }, 120000);
  }

  /**
   * Get connection status
   */
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

  /**
   * Logout and clear session
   */
  public async logout(req: Request, res: Response): Promise<void> {
    try {
      await whatsAppService.disconnect();
      res.status(200).json(
        ResponseFormatter.noContent('Logged out successfully')
      );
    } catch (error) {
      logger.error({ error }, 'Failed to logout');
      res.status(500).json(
        ResponseFormatter.serverError('Failed to logout')
      );
    }
  }

  /**
   * Cancel ongoing connection attempt (QR generation)
   * Only works when connecting, not when already connected
   */
  public async cancelConnection(req: Request, res: Response): Promise<void> {
    try {
      const state = whatsAppService.getState();

      // Check if already connected - cannot cancel active session
      if (state.isConnected) {
        res.status(400).json(
          ResponseFormatter.badRequest(
            'Cannot cancel: Active session exists. Use /auth/logout to disconnect.'
          )
        );
        return;
      }

      // Check if there's actually a connection in progress
      if (!state.isConnecting) {
        res.status(400).json(
          ResponseFormatter.badRequest('No connection attempt in progress to cancel')
        );
        return;
      }

      // Cancel the connection
      await whatsAppService.cancelConnection();

      res.status(200).json(
        ResponseFormatter.success(
          { cancelled: true },
          'Connection attempt cancelled successfully'
        )
      );
    } catch (error) {
      logger.error({ error }, 'Failed to cancel connection');
      res.status(500).json(
        ResponseFormatter.serverError('Failed to cancel connection')
      );
    }
  }

  private waitForQR(timeout: number): Promise<string | null> {
    return new Promise((resolve) => {
      // Check if QR already available
      const currentQR = whatsAppService.getState().qrCode;
      if (currentQR) {
        resolve(currentQR);
        return;
      }

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
