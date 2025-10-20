import { z } from 'zod';

const stringIdentifier = z.string().trim().min(1);

const parseratorIntegrationSchema = z
  .object({
    workspaceId: stringIdentifier.optional(),
    datasetId: stringIdentifier.optional(),
    recipeSlug: stringIdentifier.optional(),
    callbackUrl: z.string().trim().url().optional(),
    confidenceThreshold: z.number().min(0).max(1).optional(),
    autopilotMode: z.enum(['manual_review', 'assisted', 'autonomous']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one Parserator field',
  });

const reposiologistIntegrationSchema = z
  .object({
    repositoryUrl: z.string().trim().url().optional(),
    branch: stringIdentifier.optional(),
    sweepCadence: z.enum(['daily', 'weekly', 'biweekly', 'monthly']).optional(),
    auditFocus: z.enum(['safety', 'quality', 'compliance', 'ecosystem']).optional(),
    clausePack: stringIdentifier.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one Reposiologist field',
  });

const nimbusGuardianIntegrationSchema = z
  .object({
    policyId: stringIdentifier.optional(),
    gateLevel: z.enum(['advisory', 'enforced']).optional(),
    environment: z.enum(['development', 'staging', 'production']).optional(),
    runbookUrl: z.string().trim().url().optional(),
    enableSecretScan: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one Nimbus Guardian field',
  });

const clearSeasIntegrationSchema = z
  .object({
    engagementId: stringIdentifier.optional(),
    partnerPod: stringIdentifier.optional(),
    serviceTier: z.enum(['discovery', 'pilot', 'retainer']).optional(),
    liaison: stringIdentifier.optional(),
    cadence: z.enum(['weekly', 'biweekly', 'monthly']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one Clear Seas Solutions field',
  });

export const ecosystemSchema = z
  .object({
    parserator: parseratorIntegrationSchema.optional(),
    reposiologist: reposiologistIntegrationSchema.optional(),
    nimbusGuardian: nimbusGuardianIntegrationSchema.optional(),
    clearSeas: clearSeasIntegrationSchema.optional(),
    sharedNarrative: z.string().trim().min(1).optional(),
    nextSyncIso: z.string().datetime().optional(),
  })
  .strict()
  .refine((value) => value.parserator || value.reposiologist || value.nimbusGuardian || value.clearSeas, {
    message: 'At least one ecosystem integration must be provided',
  });

export type EcosystemAlignment = z.infer<typeof ecosystemSchema>;

const sanitizeSection = <T extends Record<string, unknown>>(value?: T): T | undefined => {
  if (!value) {
    return undefined;
  }
  return Object.keys(value).length > 0 ? value : undefined;
};

const mergeSection = <T extends Record<string, unknown>>(existing?: T, incoming?: T): T | undefined => {
  if (!existing) {
    return sanitizeSection(incoming);
  }
  if (!incoming) {
    return sanitizeSection(existing);
  }
  return sanitizeSection({ ...existing, ...incoming });
};

export const sanitizeEcosystem = (value: unknown): EcosystemAlignment | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const result = ecosystemSchema.safeParse(value);
  if (!result.success) {
    return undefined;
  }
  return result.data;
};

export const mergeEcosystem = (
  existing?: EcosystemAlignment,
  incoming?: EcosystemAlignment,
): EcosystemAlignment | undefined => {
  const base = sanitizeEcosystem(existing);
  const next = sanitizeEcosystem(incoming);
  if (!base) {
    return next;
  }
  if (!next) {
    return base;
  }
  const combined = {
    ...base,
    ...next,
    parserator: mergeSection(base.parserator, next.parserator),
    reposiologist: mergeSection(base.reposiologist, next.reposiologist),
    nimbusGuardian: mergeSection(base.nimbusGuardian, next.nimbusGuardian),
    clearSeas: mergeSection(base.clearSeas, next.clearSeas),
    sharedNarrative: next.sharedNarrative ?? base.sharedNarrative,
    nextSyncIso: next.nextSyncIso ?? base.nextSyncIso,
  } as Record<string, unknown>;
  return sanitizeEcosystem(combined);
};

export const readEcosystemFromMetadata = (
  metadata?: Record<string, unknown>,
): EcosystemAlignment | undefined => {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  return sanitizeEcosystem((metadata as Record<string, unknown>).ecosystem);
};

export const embedEcosystemIntoMetadata = (
  metadata: Record<string, unknown> | undefined,
  ecosystem: EcosystemAlignment | undefined,
): Record<string, unknown> | undefined => {
  if (!metadata && !ecosystem) {
    return undefined;
  }
  const base = metadata ? { ...metadata } : {};
  if (!ecosystem) {
    delete (base as Record<string, unknown>).ecosystem;
    return Object.keys(base).length > 0 ? base : undefined;
  }
  return { ...base, ecosystem };
};

const countIntegrations = (ecosystem: EcosystemAlignment): number => {
  let count = 0;
  if (ecosystem.parserator) count += 1;
  if (ecosystem.reposiologist) count += 1;
  if (ecosystem.nimbusGuardian) count += 1;
  if (ecosystem.clearSeas) count += 1;
  return count;
};

const setLabel = (
  labels: Record<string, string>,
  key: string,
  value: string | undefined,
) => {
  if (!value) {
    return;
  }
  labels[key] = value;
};

export const applyEcosystemLabels = (
  labels: Record<string, string>,
  ecosystem: EcosystemAlignment | undefined,
) => {
  if (!ecosystem) {
    return;
  }
  setLabel(labels, 'ecosystem.sources', String(countIntegrations(ecosystem)));
  if (ecosystem.parserator) {
    setLabel(labels, 'ecosystem.parserator/workspace', ecosystem.parserator.workspaceId);
    setLabel(labels, 'ecosystem.parserator/dataset', ecosystem.parserator.datasetId);
    setLabel(labels, 'ecosystem.parserator/recipe', ecosystem.parserator.recipeSlug);
    if (ecosystem.parserator.autopilotMode) {
      setLabel(labels, 'ecosystem.parserator/autopilot', ecosystem.parserator.autopilotMode);
    }
  }
  if (ecosystem.reposiologist) {
    setLabel(labels, 'ecosystem.reposiologist/repository', ecosystem.reposiologist.repositoryUrl);
    setLabel(labels, 'ecosystem.reposiologist/branch', ecosystem.reposiologist.branch);
    if (ecosystem.reposiologist.sweepCadence) {
      setLabel(labels, 'ecosystem.reposiologist/cadence', ecosystem.reposiologist.sweepCadence);
    }
    if (ecosystem.reposiologist.auditFocus) {
      setLabel(labels, 'ecosystem.reposiologist/focus', ecosystem.reposiologist.auditFocus);
    }
  }
  if (ecosystem.nimbusGuardian) {
    setLabel(labels, 'ecosystem.nimbusGuardian/policy', ecosystem.nimbusGuardian.policyId);
    if (ecosystem.nimbusGuardian.environment) {
      setLabel(labels, 'ecosystem.nimbusGuardian/environment', ecosystem.nimbusGuardian.environment);
    }
    if (ecosystem.nimbusGuardian.gateLevel) {
      setLabel(labels, 'ecosystem.nimbusGuardian/gate', ecosystem.nimbusGuardian.gateLevel);
    }
  }
  if (ecosystem.clearSeas) {
    setLabel(labels, 'ecosystem.clearSeas/engagement', ecosystem.clearSeas.engagementId);
    if (ecosystem.clearSeas.serviceTier) {
      setLabel(labels, 'ecosystem.clearSeas/tier', ecosystem.clearSeas.serviceTier);
    }
    if (ecosystem.clearSeas.partnerPod) {
      setLabel(labels, 'ecosystem.clearSeas/pod', ecosystem.clearSeas.partnerPod);
    }
  }
  if (ecosystem.nextSyncIso) {
    setLabel(labels, 'ecosystem.nextSyncIso', ecosystem.nextSyncIso);
  }
};
