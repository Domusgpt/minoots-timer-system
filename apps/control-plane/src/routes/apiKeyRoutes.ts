import express, { Application, Request, Response } from 'express';
import { z } from 'zod';

import { ApiKeyService } from '../services/apiKeyService';

const createKeySchema = z.object({
  name: z.string().min(1).max(64),
});

export const registerApiKeyRoutes = (app: Application, apiKeyService: ApiKeyService) => {
  const router = express.Router();

  router.post('/', async (req: Request, res: Response) => {
    try {
      if (!req.auth) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }
      const payload = createKeySchema.parse(req.body);
      const apiKey = await apiKeyService.generateKey(req.auth.user.id, payload.name);
      res.status(201).json(apiKey);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : 'Failed to create API key' });
    }
  });

  app.use('/api-keys', router);
};
