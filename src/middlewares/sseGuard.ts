import { Request, Response, NextFunction } from 'express';
import settingsService from '../services/SettingsService';
import { ResponseFormatter } from '../views/ResponseFormatter';
import logger from '../utils/logger';

/**
 * SSE Guard Middleware
 * Validates that the request origin is in the CORS white list
 * Used to secure SSE endpoints
 */
export const sseGuard = (req: Request, res: Response, next: NextFunction): void => {
  const corsWhiteList = settingsService.corsWhiteList;

  // If whitelist is empty, allow all (for development)
  if (corsWhiteList.length === 0) {
    logger.debug('SSE Guard: CORS whitelist is empty, allowing all origins');
    next();
    return;
  }

  // Get origin from request headers
  const origin = req.headers.origin || req.headers.referer;
  const clientIp = req.ip || req.socket.remoteAddress || '';

  // Check if origin or IP is in whitelist
  let isAllowed = false;

  if (origin) {
    // Check origin against whitelist
    for (const allowed of corsWhiteList) {
      if (origin.includes(allowed) || allowed === '*') {
        isAllowed = true;
        break;
      }
    }
  }

  // Also check client IP
  if (!isAllowed && clientIp) {
    const cleanIp = clientIp.replace('::ffff:', ''); // Remove IPv6 prefix
    for (const allowed of corsWhiteList) {
      if (cleanIp === allowed || cleanIp.includes(allowed) || allowed === '*') {
        isAllowed = true;
        break;
      }
    }
  }

  // Check X-Forwarded-For header for proxied requests
  if (!isAllowed) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0].trim();
      for (const allowed of corsWhiteList) {
        if (forwardedIp === allowed || forwardedIp.includes(allowed)) {
          isAllowed = true;
          break;
        }
      }
    }
  }

  if (!isAllowed) {
    logger.warn({
      origin,
      clientIp,
      corsWhiteList,
    }, 'SSE Guard: Access denied - origin/IP not in whitelist');

    res.status(403).json(
      ResponseFormatter.error(
        'Access denied: Origin not in CORS whitelist',
        'Forbidden'
      )
    );
    return;
  }

  logger.debug({ origin, clientIp }, 'SSE Guard: Access granted');
  next();
};

export default sseGuard;
