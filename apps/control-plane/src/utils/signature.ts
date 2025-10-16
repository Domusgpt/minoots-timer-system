import crypto from 'node:crypto';

import { AuthContext } from '../types/auth';

export interface SignatureEnvelope {
  signature: string;
  issuedAt: string;
}

export const signKernelMetadata = (
  secret: string,
  context: AuthContext,
  payload: Record<string, unknown>,
): SignatureEnvelope => {
  const issuedAt = new Date().toISOString();
  const canonicalPayload = canonicalize({
    ...payload,
    tenantId: context.tenantId,
    principalId: context.principalId,
    requestId: context.requestId,
    issuedAt,
  });
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(canonicalPayload);
  return {
    signature: hmac.digest('hex'),
    issuedAt,
  };
};

const canonicalize = (value: Record<string, unknown>): string => {
  const entries = Object.keys(value)
    .sort()
    .map((key) => {
      const raw = value[key];
      return [key, typeof raw === 'object' && raw !== null ? JSON.stringify(raw) : String(raw ?? '')];
    });
  return entries.map(([key, val]) => `${key}=${val}`).join('&');
};
