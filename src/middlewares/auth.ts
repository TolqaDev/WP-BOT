import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { ResponseFormatter } from '../views/ResponseFormatter';
import config from '../config';
import logger from '../utils/logger';

const API_KEYS: Map<string, ApiKeyInfo> = new Map();

interface ApiKeyInfo {
  key: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  isActive: boolean;
}

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
    const generatedKey = generateApiKey();
    API_KEYS.set(generatedKey, {
      key: generatedKey,
      name: 'Auto-generated Key',
      createdAt: new Date(),
      lastUsedAt: null,
      isActive: true,
    });
    logger.warn({ apiKeyPreview: `${generatedKey.substring(0, 8)}...${generatedKey.substring(generatedKey.length - 4)}` }, 'No API key configured! Auto-generated key created. Add API_KEY to .env');
  }
};

const generateApiKey = (): string => {
  return `wba_${crypto.randomBytes(32).toString('hex')}`;
};

const validateApiKey = (key: string): boolean => {
  const keyInfo = API_KEYS.get(key);
  if (keyInfo && keyInfo.isActive) {
    keyInfo.lastUsedAt = new Date();
    return true;
  }
  return false;
};

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // CORS preflight (OPTIONS) istekleri authentication gerektirmez
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

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

const extractApiKey = (req: Request): string | null => {
  const xApiKey = req.headers['x-api-key'];
  if (xApiKey && typeof xApiKey === 'string') return xApiKey;

  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
    if (parts.length === 1) return parts[0];
  }

  const queryKey = req.query.api_key;
  if (queryKey && typeof queryKey === 'string') return queryKey;

  return null;
};

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

export const addApiKey = (name: string): string => {
  const key = generateApiKey();
  API_KEYS.set(key, { key, name, createdAt: new Date(), lastUsedAt: null, isActive: true });
  logger.info({ name }, 'New API key created');
  return key;
};

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

initializeApiKeys();

export default authMiddleware;
