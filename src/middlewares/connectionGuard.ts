import { Request, Response, NextFunction } from 'express';
import whatsAppService from '../services/WhatsAppService';
import { ResponseFormatter } from '../views/ResponseFormatter';

export const requireConnection = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!whatsAppService.isReady()) {
    res.status(503).json(
      ResponseFormatter.error('WhatsApp is not connected', 'Service unavailable')
    );
    return;
  }
  next();
};
