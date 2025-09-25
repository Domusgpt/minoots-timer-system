import admin from 'firebase-admin';

let initialized = false;

const initializeIfNeeded = () => {
  if (initialized && admin.apps.length > 0) {
    return;
  }

  if (admin.apps.length === 0) {
    try {
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const credential = admin.credential.applicationDefault();
      admin.initializeApp({
        credential,
        projectId,
      });
    } catch (error) {
      // In local development environments the application default credentials may be
      // unavailable. Defer initialization until credentials are configured.
      console.warn('Firebase Admin initialization skipped:', error);
      return;
    }
  }

  initialized = true;
};

export const getFirebaseApp = () => {
  initializeIfNeeded();
  if (admin.apps.length === 0) {
    throw new Error('Firebase Admin SDK is not configured for this environment');
  }
  return admin.app();
};

export const getAuth = () => {
  return getFirebaseApp().auth();
};

export const getFirestore = () => {
  return getFirebaseApp().firestore();
};

export const getFieldValue = () => admin.firestore.FieldValue;
