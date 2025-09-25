import { NextFunction, Request, Response } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';

import { createApiKeyService, ApiKeyService, UserContext } from '../services/apiKeyService';
import { getAuth, getFirestore, getFieldValue } from '../services/firebaseAdmin';

type AuthMethod = 'firebase' | 'apiKey' | 'anonymous';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  tier: string;
  tenantId?: string;
}

export interface AuthContext {
  user: AuthenticatedUser;
  method: AuthMethod;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

interface FirebaseAuthMiddlewareOptions {
  apiKeyService?: ApiKeyService;
  freePaths?: string[];
  allowAnonymous?: boolean;
}

const DEFAULT_FREE_PATHS = ['/healthz', '/docs', '/pricing'];

export class FirebaseAuthMiddleware {
  private readonly apiKeyService: ApiKeyService;
  private readonly freePaths: string[];
  private readonly allowAnonymous: boolean;

  constructor(options: FirebaseAuthMiddlewareOptions = {}) {
    this.apiKeyService = options.apiKeyService ?? createApiKeyService();
    this.freePaths = options.freePaths ?? DEFAULT_FREE_PATHS;
    this.allowAnonymous = options.allowAnonymous ?? false;
  }

  handle = async (req: Request, res: Response, next: NextFunction) => {
    if (this.freePaths.some((path) => req.path.startsWith(path))) {
      return next();
    }

    try {
      const apiKey = extractApiKey(req);
      if (apiKey) {
        const context = await this.apiKeyService.validateKey(apiKey);
        if (context) {
          req.auth = { user: await this.resolveUserContext(context), method: 'apiKey' };
          return next();
        }
      }

      const bearer = extractBearerToken(req);
      if (bearer) {
        const decoded = await getAuth().verifyIdToken(bearer);
        const user = await this.userFromFirebase(decoded);
        req.auth = { user, method: 'firebase' };
        return next();
      }

      if (this.allowAnonymous) {
        req.auth = {
          user: { id: 'anonymous', tier: 'anonymous' },
          method: 'anonymous',
        };
        return next();
      }

      res.status(401).json({ message: 'Authentication required' });
    } catch (error) {
      next(error);
    }
  };

  private async resolveUserContext(context: UserContext): Promise<AuthenticatedUser> {
    if (context.email) {
      return context;
    }

    try {
      const db = getFirestore();
      const doc = await db.collection('users').doc(context.id).get();
      const data = doc.data() as { email?: string; tier?: string; tenantId?: string } | undefined;
      if (data) {
        return {
          id: context.id,
          email: data.email,
          tier: data.tier ?? context.tier,
          tenantId: context.tenantId ?? data.tenantId,
        };
      }
    } catch (error) {
      console.warn('Failed to resolve API key user context', error);
    }

    return context;
  }

  private async userFromFirebase(token: DecodedIdToken): Promise<AuthenticatedUser> {
    try {
      const db = getFirestore();
      const doc = await db.collection('users').doc(token.uid).get();
      if (!doc.exists) {
        await doc.ref.set({
          email: token.email ?? 'unknown',
          tier: 'free',
          tenantId: token.firebase?.tenant,
          createdAt: getFieldValue().serverTimestamp(),
          lastSeen: getFieldValue().serverTimestamp(),
        });
        return {
          id: token.uid,
          email: token.email ?? undefined,
          tier: 'free',
          tenantId: token.firebase?.tenant ?? undefined,
        };
      }

      await doc.ref.update({ lastSeen: getFieldValue().serverTimestamp() });
      const data = doc.data() as { email?: string; tier?: string; tenantId?: string } | undefined;
      return {
        id: token.uid,
        email: data?.email ?? token.email ?? undefined,
        tier: data?.tier ?? 'free',
        tenantId: data?.tenantId ?? token.firebase?.tenant ?? undefined,
      };
    } catch (error) {
      console.warn('Falling back to token claims due to Firestore error', error);
      return {
        id: token.uid,
        email: token.email ?? undefined,
        tier: 'free',
        tenantId: token.firebase?.tenant ?? undefined,
      };
    }
  }
}

const extractApiKey = (req: Request): string | null => {
  const headerKey = req.header('x-api-key');
  if (headerKey) {
    return headerKey;
  }
  const queryKey = req.query.apiKey;
  return typeof queryKey === 'string' ? queryKey : null;
};

const extractBearerToken = (req: Request): string | null => {
  const authHeader = req.header('authorization');
  if (!authHeader) {
    return null;
  }
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
};
