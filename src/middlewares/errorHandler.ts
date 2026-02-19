import { Request, Response, NextFunction } from 'express';
import { ResponseFormatter } from '../views/ResponseFormatter';
import logger from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error({
    error: {
      message: err.message,
      stack: err.stack,
      statusCode,
    },
    request: {
      method: req.method,
      url: req.url,
      body: req.body,
    },
  }, 'Error occurred');

  if (statusCode === 404) {
    res.status(404).json(ResponseFormatter.notFound('Resource'));
    return;
  }

  if (statusCode === 400) {
    res.status(400).json(ResponseFormatter.badRequest(message));
    return;
  }

  if (statusCode === 401) {
    res.status(401).json(ResponseFormatter.unauthorized(message));
    return;
  }

  res.status(statusCode).json(
    ResponseFormatter.serverError(
      process.env.NODE_ENV === 'development' ? message : 'An unexpected error occurred'
    )
  );
};

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json(
    ResponseFormatter.notFound(`Route ${req.method} ${req.path}`)
  );
};

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
