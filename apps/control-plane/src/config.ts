import { AuthenticatedUser } from './middleware/auth';

type AuthMode = 'firebase' | 'anonymous';
type BackendMode = 'firestore' | 'memory';

type BooleanString = 'true' | 'false' | '1' | '0' | 'yes' | 'no' | 'on' | 'off';

const truthy = new Set(['true', '1', 'yes', 'on']);

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  return truthy.has(value.toLowerCase() as BooleanString);
};

const hasFirebaseCredentials = (): boolean => {
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.FIREBASE_CONFIG ||
      process.env.FIREBASE_CREDENTIALS_JSON ||
      process.env.FIREBASE_CLIENT_EMAIL,
  );
};

const resolveAuthMode = (): AuthMode => {
  const explicit = process.env.CONTROL_PLANE_AUTH_MODE as AuthMode | undefined;
  if (explicit === 'firebase' || explicit === 'anonymous') {
    return explicit;
  }

  const firebaseEnabled = parseBoolean(process.env.CONTROL_PLANE_ENABLE_FIREBASE, hasFirebaseCredentials());
  return firebaseEnabled ? 'firebase' : 'anonymous';
};

const resolveBackend = (envName: string, defaultValue: BackendMode): BackendMode => {
  const candidate = process.env[envName];
  if (!candidate) {
    return defaultValue;
  }
  return candidate === 'firestore' ? 'firestore' : 'memory';
};

const resolveBillingEnabled = (): boolean => {
  const stripePresent = Boolean(process.env.STRIPE_SECRET_KEY);
  return parseBoolean(process.env.CONTROL_PLANE_ENABLE_BILLING, stripePresent);
};

const anonymousUser: AuthenticatedUser = {
  id: process.env.CONTROL_PLANE_ANON_USER_ID ?? 'local-dev-user',
  tier: process.env.CONTROL_PLANE_ANON_TIER ?? 'anonymous',
  email: process.env.CONTROL_PLANE_ANON_EMAIL,
  tenantId: process.env.CONTROL_PLANE_ANON_TENANT_ID,
};

const authMode = resolveAuthMode();

export const controlPlaneConfig = {
  authMode,
  usageTrackerBackend: resolveBackend('USAGE_TRACKER_BACKEND', authMode === 'firebase' ? 'firestore' : 'memory'),
  apiKeyBackend: resolveBackend('API_KEY_BACKEND', authMode === 'firebase' ? 'firestore' : 'memory'),
  billingEnabled: resolveBillingEnabled(),
  anonymousUser,
  publicRoutes: (process.env.CONTROL_PLANE_PUBLIC_ROUTES ?? '/healthz,/docs,/pricing')
    .split(',')
    .map((route) => route.trim())
    .filter((route) => route.length > 0),
};
