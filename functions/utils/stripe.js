/**
 * MINOOTS Stripe Payment Processing Utilities
 * Handle subscription creation, upgrades, and webhooks
 */

const admin = require('firebase-admin');

// Initialize Stripe lazily to avoid deployment timeout
let stripe;
const getStripe = () => {
  if (!stripe) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable not set');
    }
    stripe = require('stripe')(stripeKey);
  }
  return stripe;
};

// Get Firestore reference
let db;
const getDb = () => {
  if (!db) {
    db = admin.firestore();
  }
  return db;
};

// Price IDs - These need to be set in environment variables or here
const PRICES = {
  pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || 'price_pro_monthly',
  pro_yearly: process.env.STRIPE_PRICE_PRO_YEARLY || 'price_pro_yearly',
  team_monthly: process.env.STRIPE_PRICE_TEAM_MONTHLY || 'price_team_monthly',
  team_yearly: process.env.STRIPE_PRICE_TEAM_YEARLY || 'price_team_yearly'
};

const toTimestamp = (value) => {
  if (!value) return null;
  if (value instanceof admin.firestore.Timestamp) return value;
  if (value instanceof Date) return admin.firestore.Timestamp.fromDate(value);
  if (typeof value === 'number') {
    return admin.firestore.Timestamp.fromMillis(value);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return admin.firestore.Timestamp.fromDate(parsed);
    }
  }
  return null;
};

/**
 * Create a Stripe checkout session for subscription upgrade
 */
async function createCheckoutSession(userId, userEmail, priceId, successUrl, cancelUrl, options = {}) {
  try {
    // Validate price ID
    if (!Object.values(PRICES).includes(priceId)) {
      throw new Error('Invalid price ID');
    }

    // Create or get Stripe customer
    let customerId = await getOrCreateCustomer(userId, userEmail);

    const metadata = {
      userId: userId,
      priceId: priceId,
    };

    if (options.teamId) {
      metadata.teamId = options.teamId;
    }

    if (options.metadata) {
      Object.assign(metadata, options.metadata);
    }

    // Create checkout session
    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      automatic_tax: {
        enabled: true
      }
    });

    return {
      sessionId: session.id,
      checkoutUrl: session.url
    };
  } catch (error) {
    console.error('Stripe checkout session error:', error);
    throw new Error(`Failed to create checkout session: ${error.message}`);
  }
}

async function linkTeamBilling(teamId, billingInfo = {}) {
  const db = getDb();
  const update = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const values = {
    stripeCustomerId: billingInfo.stripeCustomerId ?? billingInfo.customerId,
    subscriptionId: billingInfo.subscriptionId,
    subscriptionStatus: billingInfo.subscriptionStatus ?? billingInfo.status,
    priceId: billingInfo.priceId ?? billingInfo.planPriceId,
    currentPeriodStart: toTimestamp(billingInfo.currentPeriodStart),
    currentPeriodEnd: toTimestamp(billingInfo.currentPeriodEnd),
    updatedBy: billingInfo.updatedBy || null,
    lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (billingInfo.canceledAt) {
    values.canceledAt = toTimestamp(billingInfo.canceledAt);
  }

  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined) {
      update[`billing.${key}`] = value;
    }
  });

  await db.collection('teams').doc(teamId).set(update, { merge: true });
  return values;
}

async function getTeamBilling(teamId) {
  const db = getDb();
  const doc = await db.collection('teams').doc(teamId).get();
  if (!doc.exists) {
    throw new Error('Team not found');
  }
  const data = doc.data() || {};
  if (!data.billing) {
    throw new Error('Team billing not configured');
  }
  return { id: doc.id, ...data };
}

async function recordUsageForTeam(teamId, { quantity, timestamp = Math.floor(Date.now() / 1000), action = 'set', description, meter = 'timer_seconds' }) {
  if (!quantity || quantity < 0) {
    throw new Error('Usage quantity must be positive');
  }

  const team = await getTeamBilling(teamId);
  const billing = team.billing || {};
  const subscriptionItemId = billing.usageSubscriptionItemId || billing.subscriptionItemId;
  if (!subscriptionItemId) {
    throw new Error('Team is not configured for usage-based billing');
  }

  const record = await getStripe().subscriptionItems.createUsageRecord(subscriptionItemId, {
    quantity,
    timestamp,
    action,
  });

  const db = getDb();
  await db.collection('teams').doc(teamId).collection('usageRecords').add({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    meter,
    quantity,
    action,
    stripeRecordId: record.id,
    stripeStatus: record.status,
    timestamp: admin.firestore.Timestamp.fromMillis(timestamp * 1000),
    description: description || null,
  });

  return record;
}

async function listInvoicesForTeam(teamId, { limit = 12 } = {}) {
  const team = await getTeamBilling(teamId);
  const customerId = team.billing?.stripeCustomerId;
  if (!customerId) {
    throw new Error('Team does not have an associated Stripe customer');
  }

  const invoices = await getStripe().invoices.list({
    customer: customerId,
    limit,
  });

  return invoices.data;
}

async function listPaymentMethodsForTeam(teamId) {
  const team = await getTeamBilling(teamId);
  const customerId = team.billing?.stripeCustomerId;
  if (!customerId) {
    throw new Error('Team does not have an associated Stripe customer');
  }

  const paymentMethods = await getStripe().paymentMethods.list({
    customer: customerId,
    type: 'card',
  });

  return paymentMethods.data;
}

async function attachPaymentMethodToTeam(teamId, paymentMethodId, { makeDefault = false } = {}) {
  const team = await getTeamBilling(teamId);
  const customerId = team.billing?.stripeCustomerId;
  if (!customerId) {
    throw new Error('Team does not have an associated Stripe customer');
  }

  await getStripe().paymentMethods.attach(paymentMethodId, { customer: customerId });

  if (makeDefault) {
    await getStripe().customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  return listPaymentMethodsForTeam(teamId);
}

async function detachPaymentMethodFromTeam(teamId, paymentMethodId) {
  await getStripe().paymentMethods.detach(paymentMethodId);
  return listPaymentMethodsForTeam(teamId);
}

async function startTeamTrial(teamId, { trialDays = 14 } = {}) {
  if (trialDays <= 0) {
    throw new Error('trialDays must be positive');
  }
  const team = await getTeamBilling(teamId);
  const subscriptionId = team.billing?.subscriptionId;
  if (!subscriptionId) {
    throw new Error('Team subscription not found');
  }

  const trialEnd = Math.floor(Date.now() / 1000) + trialDays * 24 * 60 * 60;
  const subscription = await getStripe().subscriptions.update(subscriptionId, {
    trial_end: trialEnd,
    proration_behavior: 'create_prorations',
  });

  await linkTeamBilling(teamId, {
    subscriptionId,
    subscriptionStatus: subscription.status,
    currentPeriodEnd: subscription.current_period_end * 1000,
    currentPeriodStart: subscription.current_period_start * 1000,
  });

  return subscription;
}

async function updateTeamPromotion(teamId, { promotionCode }) {
  const team = await getTeamBilling(teamId);
  const subscriptionId = team.billing?.subscriptionId;
  if (!subscriptionId) {
    throw new Error('Team subscription not found');
  }

  const updates = {};
  if (promotionCode) {
    updates.promotion_code = promotionCode;
  } else {
    updates.coupon = null;
    updates.promotion_code = null;
  }

  const subscription = await getStripe().subscriptions.update(subscriptionId, updates);
  await linkTeamBilling(teamId, {
    subscriptionId,
    subscriptionStatus: subscription.status,
    currentPeriodEnd: subscription.current_period_end * 1000,
    currentPeriodStart: subscription.current_period_start * 1000,
  });

  return subscription;
}

/**
 * Get or create a Stripe customer for a user
 */
async function getOrCreateCustomer(userId, userEmail) {
  const db = getDb();
  
  try {
    // Check if user already has a Stripe customer ID
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    
    if (userData?.stripeCustomerId) {
      // Verify customer still exists in Stripe
      try {
        await getStripe().customers.retrieve(userData.stripeCustomerId);
        return userData.stripeCustomerId;
      } catch (error) {
        // Customer doesn't exist, create new one
        console.log('Stripe customer not found, creating new one');
      }
    }

    // Create new Stripe customer
    const customer = await getStripe().customers.create({
      email: userEmail,
      metadata: {
        userId: userId
      }
    });

    // Save customer ID to user document
    await db.collection('users').doc(userId).update({
      stripeCustomerId: customer.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return customer.id;
  } catch (error) {
    console.error('Customer creation error:', error);
    throw new Error(`Failed to create customer: ${error.message}`);
  }
}

/**
 * Handle successful subscription creation from webhook
 */
async function handleSubscriptionCreated(subscription) {
  const db = getDb();
  
  try {
    const customerId = subscription.customer;
    
    // Find user by Stripe customer ID
    const usersSnapshot = await db.collection('users')
      .where('stripeCustomerId', '==', customerId)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      console.error('User not found for customer:', customerId);
      return;
    }

    const userDoc = usersSnapshot.docs[0];
    const userId = userDoc.id;

    // Determine tier based on price
    const priceId = subscription.items.data[0].price.id;
    let tier = 'free';
    
    if (priceId === PRICES.pro_monthly || priceId === PRICES.pro_yearly) {
      tier = 'pro';
    } else if (priceId === PRICES.team_monthly || priceId === PRICES.team_yearly) {
      tier = 'team';
    }

    // Update user tier and subscription info
    await userDoc.ref.update({
      tier: tier,
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      upgradedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`User ${userId} upgraded to ${tier} tier`);

    // Log the upgrade
    await db.collection('billing_events').add({
      userId: userId,
      type: 'subscription_created',
      subscriptionId: subscription.id,
      tier: tier,
      priceId: priceId,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    const teamId = subscription.metadata?.teamId || subscription.metadata?.team_id;
    if (teamId) {
      await linkTeamBilling(teamId, {
        customerId,
        subscriptionId: subscription.id,
        status: subscription.status,
        priceId,
        currentPeriodStart: subscription.current_period_start * 1000,
        currentPeriodEnd: subscription.current_period_end * 1000,
      });
    }

  } catch (error) {
    console.error('Subscription creation handler error:', error);
  }
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionCanceled(subscription) {
  const db = getDb();
  
  try {
    const customerId = subscription.customer;
    
    // Find user by Stripe customer ID
    const usersSnapshot = await db.collection('users')
      .where('stripeCustomerId', '==', customerId)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      console.error('User not found for customer:', customerId);
      return;
    }

    const userDoc = usersSnapshot.docs[0];
    const userId = userDoc.id;

    // Downgrade to free tier
    await userDoc.ref.update({
      tier: 'free',
      subscriptionStatus: 'canceled',
      canceledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`User ${userId} downgraded to free tier`);

    // Log the cancellation
    await db.collection('billing_events').add({
      userId: userId,
      type: 'subscription_canceled',
      subscriptionId: subscription.id,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    const teamId = subscription.metadata?.teamId || subscription.metadata?.team_id;
    if (teamId) {
      await linkTeamBilling(teamId, {
        customerId,
        subscriptionId: subscription.id,
        status: 'canceled',
        canceledAt: new Date(),
      });
    }

  } catch (error) {
    console.error('Subscription cancellation handler error:', error);
  }
}

/**
 * Get billing portal URL for customer to manage subscription
 */
async function createBillingPortalSession(userId, returnUrl) {
  const db = getDb();
  
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    
    if (!userData?.stripeCustomerId) {
      throw new Error('User has no Stripe customer ID');
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: userData.stripeCustomerId,
      return_url: returnUrl
    });

    return session.url;
  } catch (error) {
    console.error('Billing portal error:', error);
    throw new Error(`Failed to create billing portal: ${error.message}`);
  }
}

/**
 * Get subscription details for a user
 */
async function getUserSubscription(userId) {
  const db = getDb();
  
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    
    if (!userData?.subscriptionId) {
      return {
        tier: 'free',
        status: 'none',
        subscription: null
      };
    }

    // Get subscription from Stripe
    const subscription = await getStripe().subscriptions.retrieve(userData.subscriptionId);
    
    return {
      tier: userData.tier,
      status: subscription.status,
      subscription: {
        id: subscription.id,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end
      }
    };
  } catch (error) {
    console.error('Get subscription error:', error);
    return {
      tier: 'free',
      status: 'error',
      subscription: null
    };
  }
}

module.exports = {
  PRICES,
  createCheckoutSession,
  getOrCreateCustomer,
  handleSubscriptionCreated,
  handleSubscriptionCanceled,
  createBillingPortalSession,
  getUserSubscription,
  linkTeamBilling,
  recordUsageForTeam,
  listInvoicesForTeam,
  listPaymentMethodsForTeam,
  attachPaymentMethodToTeam,
  detachPaymentMethodFromTeam,
  startTeamTrial,
  updateTeamPromotion,
};