import { z } from 'zod';

import { TimerAction } from '../types';

const registry = new Map<string, z.ZodTypeAny>();

export const registerActionSchema = (kind: string, schema: z.ZodTypeAny) => {
  registry.set(kind, schema);
};

export const validateActionParameters = (action: TimerAction): TimerAction => {
  const schema = registry.get(action.kind);
  if (!schema) {
    return action;
  }
  const parameters = schema.parse(action.parameters ?? {});
  return { ...action, parameters };
};
