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

/**
 * Create a Stripe checkout session for subscription upgrade
 */
async function createCheckoutSession(userId, userEmail, priceId, successUrl, cancelUrl) {
  try {
    // Validate price ID
    if (!Object.values(PRICES).includes(priceId)) {
      throw new Error('Invalid price ID');
    }

    // Create or get Stripe customer
    let customerId = await getOrCreateCustomer(userId, userEmail);

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
      metadata: {
        userId: userId,
        priceId: priceId
      },
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
  createCheckoutSession,
  handleSubscriptionCreated,
  handleSubscriptionCanceled,
  createBillingPortalSession,
  getUserSubscription,
  PRICES
};