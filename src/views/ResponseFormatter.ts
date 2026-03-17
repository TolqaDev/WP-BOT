import type { ApiResponse } from '../types';

export class ResponseFormatter {
  static success<T>(data: T, message?: string): ApiResponse<T> {
    return {
      success: true,
      data,
      message,
      timestamp: new Date().toISOString(),
    };
  }

  static error(error: string, message?: string): ApiResponse<null> {
    return {
      success: false,
      error,
      message,
      timestamp: new Date().toISOString(),
    };
  }

  static created<T>(data: T, message = 'Resource created successfully'): ApiResponse<T> {
    return this.success(data, message);
  }

  static noContent(message = 'Operation completed successfully'): ApiResponse<null> {
    return {
      success: true,
      message,
      timestamp: new Date().toISOString(),
    };
  }

  static notFound(resource = 'Resource'): ApiResponse<null> {
    return this.error(`${resource} not found`, 'The requested resource was not found');
  }

  static badRequest(details: string): ApiResponse<null> {
    return this.error(details, 'Bad request');
  }

  static unauthorized(details = 'Authentication required'): ApiResponse<null> {
    return this.error(details, 'Unauthorized');
  }

  static conflict(details: string): ApiResponse<null> {
    return this.error(details, 'Conflict');
  }

  static serviceUnavailable(details: string): ApiResponse<null> {
    return this.error(details, 'Service unavailable');
  }

  static serverError(details = 'An unexpected error occurred'): ApiResponse<null> {
    return this.error(details, 'Internal server error');
  }
}
