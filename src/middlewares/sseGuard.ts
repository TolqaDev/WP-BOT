import { Request, Response, NextFunction } from 'express';
import settingsService from '../services/SettingsService';
import { ResponseFormatter } from '../views/ResponseFormatter';
import logger from '../utils/logger';

export const sseGuard = (req: Request, res: Response, next: NextFunction): void => {
  const corsWhiteList = settingsService.corsWhiteList;

  if (corsWhiteList.length === 0) {
    next();
    return;
  }

  const hasApiKey = !!(req.query.api_key || req.headers['x-api-key'] || req.headers.authorization);
  if (hasApiKey) {
    next();
    return;
  }

  const origin = req.headers.origin || req.headers.referer;
  const clientIp = req.ip || req.socket.remoteAddress || '';
  let isAllowed = false;

  if (origin) {
    for (const allowed of corsWhiteList) {
      if (origin.includes(allowed) || allowed === '*') { isAllowed = true; break; }
    }
  }

  if (!isAllowed && clientIp) {
    const cleanIp = clientIp.replace('::ffff:', '');
    for (const allowed of corsWhiteList) {
      if (cleanIp === allowed || cleanIp.includes(allowed) || allowed === '*') { isAllowed = true; break; }
    }
  }

  if (!isAllowed) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0].trim();
      for (const allowed of corsWhiteList) {
        if (forwardedIp === allowed || forwardedIp.includes(allowed)) { isAllowed = true; break; }
      }
    }
  }

  if (!isAllowed) {
    logger.warn({ origin, clientIp, corsWhiteList }, 'SSE Guard: Access denied');
    res.status(403).json(ResponseFormatter.error('Access denied: Origin not in CORS whitelist', 'Forbidden'));
    return;
  }

  next();
};

export default sseGuard;
