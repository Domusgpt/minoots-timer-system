import express, { Application, Request, Response } from 'express';
import { z } from 'zod';

import { StripeService } from '../services/stripe';

const checkoutSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const registerBillingRoutes = (app: Application, stripeService: StripeService) => {
  const router = express.Router();

  router.post('/checkout', async (req: Request, res: Response) => {
    try {
      if (!req.auth) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      if (!stripeService.isEnabled()) {
        res.status(503).json({ message: 'Billing is disabled in this environment' });
        return;
      }
      const payload = checkoutSchema.parse(req.body);
      const session = await stripeService.createCheckoutSession({
        userId: req.auth.user.id,
        userEmail: req.auth.user.email ?? 'unknown@minoots.dev',
        priceId: payload.priceId,
        successUrl: payload.successUrl,
        cancelUrl: payload.cancelUrl,
      });
      res.status(200).json(session);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : 'Failed to create checkout session' });
    }
  });

  app.use('/billing', router);
};
