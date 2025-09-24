const UNIT_MAP: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export const parseDurationMs = (value: string | number): number => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error('Duration must be a positive finite number');
    }
    return value;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) {
    throw new Error(`Unable to parse duration: ${value}`);
  }

  const [, rawAmount, rawUnit] = match;
  const unit = rawUnit.toLowerCase();
  const amount = Number.parseInt(rawAmount, 10);
  const multiplier = UNIT_MAP[unit];

  if (!multiplier) {
    throw new Error(`Unsupported duration unit: ${unit}`);
  }

  return amount * multiplier;
};

export const computeFireTimestamp = (durationMs: number, from: Date = new Date()): string => {
  return new Date(from.getTime() + durationMs).toISOString();
};
