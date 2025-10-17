const { randomUUID } = require('crypto');
const admin = require('firebase-admin');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { parseStringPromise } = require('xml2js');
const { addMember } = require('./teamService');

function getDb() {
  return admin.firestore();
}

async function configureSsoProvider(teamId, provider) {
  const db = getDb();
  const providerId = provider.id || randomUUID();
  const docRef = db.collection('teams').doc(teamId).collection('ssoProviders').doc(providerId);
  const existing = await docRef.get();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  const record = {
    id: providerId,
    teamId,
    name: provider.name || providerId,
    type: provider.type || 'oidc',
    settings: provider.settings || {},
    defaultRole: provider.defaultRole || 'member',
    updatedAt: timestamp,
    createdAt: existing.exists ? existing.data().createdAt || timestamp : timestamp,
  };

  await docRef.set(record, { merge: true });
  return { ...record, createdAt: existing.exists ? existing.data().createdAt : new Date() };
}

async function listSsoProviders(teamId) {
  const db = getDb();
  const snapshot = await db.collection('teams').doc(teamId).collection('ssoProviders').get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function deleteSsoProvider(teamId, providerId) {
  const db = getDb();
  await db.collection('teams').doc(teamId).collection('ssoProviders').doc(providerId).delete();
}

async function verifyOidcAssertion(provider, assertion) {
  const settings = provider.settings || {};
  if (!settings.jwksUri) {
    throw new Error('Provider jwksUri not configured');
  }
  if (!settings.issuer || !settings.audience) {
    throw new Error('Provider issuer and audience are required');
  }

  const jwks = createRemoteJWKSet(new URL(settings.jwksUri));
  const { payload } = await jwtVerify(assertion, jwks, {
    issuer: settings.issuer,
    audience: settings.audience,
  });

  const emailClaim = settings.emailClaim || 'email';
  const userIdClaim = settings.userIdClaim || 'sub';

  const email = payload[emailClaim];
  if (!email) {
    throw new Error('OIDC assertion missing email claim');
  }

  const profile = {
    email: email.toLowerCase(),
    userId: payload[userIdClaim] || email.toLowerCase(),
    name: payload.name || payload.preferred_username || email,
    attributes: payload,
  };

  return profile;
}

async function verifySamlAssertion(provider, assertion) {
  const xml = Buffer.from(assertion, 'base64').toString('utf8');
  const parsed = await parseStringPromise(xml, { explicitArray: false });
  const response = parsed['samlp:Response'] || parsed.Response || parsed;
  if (!response) {
    throw new Error('Invalid SAML response');
  }

  const assertionNode = response.Assertion || (response['saml:Assertion'] || {});
  if (!assertionNode) {
    throw new Error('SAML assertion not found');
  }

  const subject = assertionNode.Subject || {};
  const nameId = subject.NameID?._ || subject['saml:NameID']?._;

  let email = nameId;
  const attributes = {};
  const attributeStatement = assertionNode.AttributeStatement || assertionNode['saml:AttributeStatement'];
  if (attributeStatement && attributeStatement.Attribute) {
    const attributeList = Array.isArray(attributeStatement.Attribute)
      ? attributeStatement.Attribute
      : [attributeStatement.Attribute];
    for (const attr of attributeList) {
      const key = attr.$?.Name || attr.$?.FriendlyName;
      const values = attr.AttributeValue || attr['saml:AttributeValue'];
      const normalizedValues = Array.isArray(values)
        ? values.map((value) => (typeof value === 'string' ? value : value._)).filter(Boolean)
        : [typeof values === 'string' ? values : values?._];
      if (key) {
        attributes[key] = normalizedValues.filter(Boolean);
      }
      if (!email && normalizedValues.length > 0 && /email/i.test(key || '')) {
        email = normalizedValues[0];
      }
    }
  }

  if (!email) {
    throw new Error('SAML assertion missing email');
  }

  return {
    email: email.toLowerCase(),
    userId: attributes[provider.settings?.userIdAttribute || 'uid']?.[0] || email.toLowerCase(),
    name: attributes[provider.settings?.displayNameAttribute || 'displayName']?.[0] || email,
    attributes,
  };
}

async function upsertSsoUser(profile) {
  const db = getDb();
  const usersCollection = db.collection('users');
  const normalizedEmail = profile.email.toLowerCase();
  const userRef = usersCollection.doc(normalizedEmail);
  const doc = await userRef.get();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  if (!doc.exists) {
    await userRef.set({
      email: normalizedEmail,
      createdAt: timestamp,
      updatedAt: timestamp,
      name: profile.name,
      sso: {
        lastLoginAt: timestamp,
        attributes: profile.attributes,
      },
    });
  } else {
    await userRef.set(
      {
        name: profile.name || doc.data().name,
        updatedAt: timestamp,
        sso: {
          lastLoginAt: timestamp,
          attributes: profile.attributes,
        },
      },
      { merge: true }
    );
  }

  return { id: userRef.id, email: normalizedEmail };
}

async function handleSsoAssertion(teamId, providerId, assertion) {
  const db = getDb();
  const providerDoc = await db.collection('teams').doc(teamId).collection('ssoProviders').doc(providerId).get();
  if (!providerDoc.exists) {
    throw new Error('SSO provider not found');
  }

  const provider = providerDoc.data();
  const type = provider.type || 'oidc';
  let profile;

  if (type === 'oidc') {
    profile = await verifyOidcAssertion(provider, assertion);
  } else if (type === 'saml') {
    profile = await verifySamlAssertion(provider, assertion);
  } else {
    throw new Error(`Unsupported SSO provider type: ${type}`);
  }

  const user = await upsertSsoUser(profile);
  await addMember(teamId, user.id, provider.defaultRole || 'member', providerId);

  const customToken = await admin.auth().createCustomToken(user.id, {
    teamId,
    providerId,
    email: user.email,
  });

  return {
    customToken,
    profile: {
      email: user.email,
      name: profile.name,
      attributes: profile.attributes,
    },
  };
}

module.exports = {
  configureSsoProvider,
  listSsoProviders,
  deleteSsoProvider,
  handleSsoAssertion,
};
