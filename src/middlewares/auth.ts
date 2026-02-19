import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { ResponseFormatter } from '../views/ResponseFormatter';
import config from '../config';
import logger from '../utils/logger';

// API Key storage (in-memory, no DB required)
// In production, you would use environment variables or a secure vault
const API_KEYS: Map<string, ApiKeyInfo> = new Map();

interface ApiKeyInfo {
  key: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  isActive: boolean;
}

// Initialize with a master API key from environment
const initializeApiKeys = (): void => {
  const masterKey = config.security.apiKey;
  if (masterKey) {
    API_KEYS.set(masterKey, {
      key: masterKey,
      name: 'Master Key',
      createdAt: new Date(),
      lastUsedAt: null,
      isActive: true,
    });
    logger.info('Master API key initialized from environment');
  } else {
    // Generate a random API key if not provided
    const generatedKey = generateApiKey();
    API_KEYS.set(generatedKey, {
      key: generatedKey,
      name: 'Auto-generated Key',
      createdAt: new Date(),
      lastUsedAt: null,
      isActive: true,
    });
    logger.warn({ apiKey: generatedKey }, '⚠️ No API key configured! Using auto-generated key. Add API_KEY to .env');
  }
};

// Generate a secure API key
const generateApiKey = (): string => {
  return `wba_${crypto.randomBytes(32).toString('hex')}`;
};

// Validate API key
const validateApiKey = (key: string): boolean => {
  const keyInfo = API_KEYS.get(key);
  if (keyInfo && keyInfo.isActive) {
    keyInfo.lastUsedAt = new Date();
    return true;
  }
  return false;
};

// Auth middleware
export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Extract API key from headers
  const apiKey = extractApiKey(req);

  if (!apiKey) {
    res.status(401).json(
      ResponseFormatter.unauthorized('API key is required. Use header: X-API-Key or Authorization: Bearer <key>')
    );
    return;
  }

  if (!validateApiKey(apiKey)) {
    logger.warn({ ip: req.ip }, 'Invalid API key attempt');
    res.status(401).json(
      ResponseFormatter.unauthorized('Invalid API key')
    );
    return;
  }

  next();
};

// Extract API key from request
const extractApiKey = (req: Request): string | null => {
  // Check X-API-Key header
  const xApiKey = req.headers['x-api-key'];
  if (xApiKey && typeof xApiKey === 'string') {
    return xApiKey;
  }

  // Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader) {
    // Support both "Bearer <key>" and just "<key>"
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1];
    }
    if (parts.length === 1) {
      return parts[0];
    }
  }

  // Check query parameter (not recommended for production)
  const queryKey = req.query.api_key;
  if (queryKey && typeof queryKey === 'string') {
    return queryKey;
  }

  return null;
};

// Get all API keys (for admin purposes)
export const getApiKeys = (): Array<Omit<ApiKeyInfo, 'key'> & { keyPreview: string }> => {
  const keys: Array<Omit<ApiKeyInfo, 'key'> & { keyPreview: string }> = [];

  for (const [key, info] of API_KEYS.entries()) {
    keys.push({
      keyPreview: `${key.substring(0, 8)}...${key.substring(key.length - 4)}`,
      name: info.name,
      createdAt: info.createdAt,
      lastUsedAt: info.lastUsedAt,
      isActive: info.isActive,
    });
  }

  return keys;
};

// Add a new API key
export const addApiKey = (name: string): string => {
  const key = generateApiKey();
  API_KEYS.set(key, {
    key,
    name,
    createdAt: new Date(),
    lastUsedAt: null,
    isActive: true,
  });
  logger.info({ name }, 'New API key created');
  return key;
};

// Revoke an API key
export const revokeApiKey = (keyPreview: string): boolean => {
  for (const [key, info] of API_KEYS.entries()) {
    const preview = `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
    if (preview === keyPreview) {
      info.isActive = false;
      logger.info({ name: info.name }, 'API key revoked');
      return true;
    }
  }
  return false;
};

// Initialize on module load
initializeApiKeys();

export default authMiddleware;
