import { Request, Response, NextFunction } from 'express';
import { ResponseFormatter } from '../views/ResponseFormatter';
import config from '../config';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const requestCounts = new Map<string, RateLimitEntry>();
const readRequestCounts = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of requestCounts.entries()) {
    if (entry.resetTime < now) {
      requestCounts.delete(key);
    }
  }
  for (const [key, entry] of readRequestCounts.entries()) {
    if (entry.resetTime < now) {
      readRequestCounts.delete(key);
    }
  }
}, 60000);

/**
 * Standard rate limiter for all API endpoints
 */
export const rateLimiter = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let entry = requestCounts.get(ip);

  if (!entry || entry.resetTime < now) {
    entry = {
      count: 1,
      resetTime: now + config.rateLimit.windowMs,
    };
    requestCounts.set(ip, entry);
  } else {
    entry.count++;
  }

  const remaining = Math.max(0, config.rateLimit.maxRequests - entry.count);
  const resetIn = Math.ceil((entry.resetTime - now) / 1000);

  res.setHeader('X-RateLimit-Limit', config.rateLimit.maxRequests);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetIn);

  if (entry.count > config.rateLimit.maxRequests) {
    res.status(429).json(
      ResponseFormatter.error(
        `Çok fazla istek. ${resetIn} saniye sonra tekrar deneyin.`,
        'Rate limit exceeded'
      )
    );
    return;
  }

  next();
};

/**
 * Relaxed rate limiter for read-only endpoints (GET requests)
 * Allows 3x the normal limit
 */
export const readRateLimiter = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const maxRequests = config.rateLimit.maxRequests * 3; // 3x normal limit

  let entry = readRequestCounts.get(ip);

  if (!entry || entry.resetTime < now) {
    entry = {
      count: 1,
      resetTime: now + config.rateLimit.windowMs,
    };
    readRequestCounts.set(ip, entry);
  } else {
    entry.count++;
  }

  const remaining = Math.max(0, maxRequests - entry.count);
  const resetIn = Math.ceil((entry.resetTime - now) / 1000);

  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetIn);

  if (entry.count > maxRequests) {
    res.status(429).json(
      ResponseFormatter.error(
        `Çok fazla istek. ${resetIn} saniye sonra tekrar deneyin.`,
        'Rate limit exceeded'
      )
    );
    return;
  }

  next();
};

// More aggressive rate limiting for specific endpoints
export const strictRateLimiter = (maxRequests: number, windowMs: number) => {
  const strictCounts = new Map<string, RateLimitEntry>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();

    let entry = strictCounts.get(key);

    if (!entry || entry.resetTime < now) {
      entry = {
        count: 1,
        resetTime: now + windowMs,
      };
      strictCounts.set(key, entry);
    } else {
      entry.count++;
    }

    if (entry.count > maxRequests) {
      const resetIn = Math.ceil((entry.resetTime - now) / 1000);
      res.status(429).json(
        ResponseFormatter.error(
          `Too many requests to this endpoint. Try again in ${resetIn} seconds.`,
          'Rate limit exceeded'
        )
      );
      return;
    }

    next();
  };
};
