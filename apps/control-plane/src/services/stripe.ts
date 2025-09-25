import Stripe from 'stripe';

import { getFirestore, getFieldValue } from './firebaseAdmin';

export interface CheckoutSessionRequest {
  userId: string;
  userEmail: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  sessionId: string;
  checkoutUrl: string;
}

const stripeClient = (): Stripe | null => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.warn('Stripe secret key not configured; billing operations disabled');
    return null;
  }
  return new Stripe(secretKey, { apiVersion: '2022-11-15' });
};

export class StripeService {
  private readonly stripe: Stripe | null;

  constructor() {
    this.stripe = stripeClient();
  }

  async createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession> {
    if (!this.stripe) {
      throw new Error('Stripe is not configured');
    }

    await this.ensureCustomerRecord(request.userId, request.userEmail);

    const session = await this.stripe.checkout.sessions.create({
      customer_email: request.userEmail,
      line_items: [
        {
          price: request.priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      metadata: {
        userId: request.userId,
      },
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
    });

    return {
      sessionId: session.id,
      checkoutUrl: session.url ?? '',
    };
  }

  private async ensureCustomerRecord(userId: string, email: string): Promise<void> {
    try {
      const db = getFirestore();
      const doc = await db.collection('users').doc(userId).get();
      if (!doc.exists) {
        await doc.ref.set({
          email,
          tier: 'free',
          createdAt: getFieldValue().serverTimestamp(),
        });
        return;
      }
      await doc.ref.update({ lastSeen: getFieldValue().serverTimestamp() });
    } catch (error) {
      console.warn('Failed to update billing user record', error);
    }
  }
}

export const createStripeService = () => new StripeService();
