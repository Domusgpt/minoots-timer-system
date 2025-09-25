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

const randomKey = () => `${API_KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;

const collectionName = 'apiKeys';

export class FirestoreApiKeyService implements ApiKeyService {
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
      InMemoryApiKeyService.instance().store(key, {
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
      return InMemoryApiKeyService.instance().validate(key);
    }
  }
}

class InMemoryApiKeyService {
  private static singleton: InMemoryApiKeyService | undefined;
  private readonly keys = new Map<
    string,
    { userId: string; name: string; createdAt: string; tenantId?: string; tier?: string; revoked?: boolean }
  >();

  static instance(): InMemoryApiKeyService {
    if (!this.singleton) {
      this.singleton = new InMemoryApiKeyService();
    }
    return this.singleton;
  }

  store(
    key: string,
    value: { userId: string; name: string; createdAt: string; tenantId?: string; tier?: string; revoked?: boolean },
  ) {
    this.keys.set(key, value);
  }

  validate(key: string): UserContext | null {
    const record = this.keys.get(key);
    if (!record || record.revoked) {
      return null;
    }
    return {
      id: record.userId,
      tier: record.tier ?? 'free',
      tenantId: record.tenantId,
    };
  }
}

export const createApiKeyService = (): ApiKeyService => {
  return new FirestoreApiKeyService();
};
