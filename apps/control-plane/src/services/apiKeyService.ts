import crypto from 'node:crypto';

import { getFieldValue, getFirestore } from './firebaseAdmin';

export interface ApiKeyData {
  key: string;
  name: string;
  userId: string;
  createdAt: string;
  lastUsedAt?: string;
  tenantId?: string;
  tier?: string;
}

export interface UserContext {
  id: string;
  email?: string;
  tier: string;
  tenantId?: string;
}

export interface ApiKeyService {
  generateKey(userId: string, name: string): Promise<ApiKeyData>;
  validateKey(key: string): Promise<UserContext | null>;
}

const API_KEY_PREFIX = process.env.API_KEY_PREFIX ?? 'mnt_';

type StoredKey = {
  userId: string;
  name: string;
  createdAt: string;
  tenantId?: string;
  tier?: string;
  revoked?: boolean;
};

const randomKey = () => `${API_KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;

const collectionName = 'apiKeys';

export class InMemoryApiKeyService implements ApiKeyService {
  private readonly keys = new Map<string, StoredKey>();

  constructor(private readonly defaultTier = 'free') {}

  async generateKey(userId: string, name: string): Promise<ApiKeyData> {
    const key = randomKey();
    const record: StoredKey = {
      userId,
      name,
      createdAt: new Date().toISOString(),
      tier: this.defaultTier,
      revoked: false,
    };
    this.store(key, record);

    return {
      key,
      name,
      userId,
      createdAt: record.createdAt,
      tenantId: record.tenantId,
      tier: record.tier,
    };
  }

  async validateKey(key: string): Promise<UserContext | null> {
    if (!key.startsWith(API_KEY_PREFIX)) {
      return null;
    }
    const record = this.keys.get(key);
    if (!record || record.revoked) {
      return null;
    }
    return {
      id: record.userId,
      tier: record.tier ?? this.defaultTier,
      tenantId: record.tenantId,
    };
  }

  store(key: string, record: StoredKey) {
    this.keys.set(key, record);
  }
}

export class FirestoreApiKeyService implements ApiKeyService {
  constructor(private readonly fallback: InMemoryApiKeyService = new InMemoryApiKeyService()) {}

  async generateKey(userId: string, name: string): Promise<ApiKeyData> {
    const key = randomKey();
    const now = new Date().toISOString();

    try {
      const db = getFirestore();
      await db.collection(collectionName).doc(key).set({
        userId,
        name,
        createdAt: getFieldValue().serverTimestamp(),
        tier: 'free',
        revoked: false,
      });
    } catch (error) {
      console.warn('Failed to persist API key to Firestore, falling back to in-memory store', error);
      this.fallback.store(key, {
        userId,
        name,
        createdAt: now,
        revoked: false,
      });
    }

    return {
      key,
      name,
      userId,
      createdAt: now,
    };
  }

  async validateKey(key: string): Promise<UserContext | null> {
    if (!key.startsWith(API_KEY_PREFIX)) {
      return null;
    }

    try {
      const db = getFirestore();
      const doc = await db.collection(collectionName).doc(key).get();
      if (!doc.exists) {
        return null;
      }

      const data = doc.data() as { userId: string; tenantId?: string; tier?: string; revoked?: boolean };
      if (data.revoked) {
        return null;
      }

      await doc.ref.update({ lastUsedAt: getFieldValue().serverTimestamp() });
      return {
        id: data.userId,
        tier: data.tier ?? 'free',
        tenantId: data.tenantId,
      };
    } catch (error) {
      console.warn('Falling back to in-memory API key validation', error);
      return this.fallback.validateKey(key);
    }
  }
}

export const createApiKeyService = (backend: 'firestore' | 'memory' = 'firestore'): ApiKeyService => {
  if (backend === 'memory') {
    return new InMemoryApiKeyService();
  }
  return new FirestoreApiKeyService(new InMemoryApiKeyService());
};
