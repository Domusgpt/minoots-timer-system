import Ajv, { ValidateFunction } from 'ajv';

import schema from './actionBundle.schema.json';

const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
const actionBundleValidator: ValidateFunction = ajv.compile(schema);

export const validateActionBundle = (payload: unknown): void => {
  if (payload === undefined || payload === null) {
    return;
  }
  const valid = actionBundleValidator(payload);
  if (!valid) {
    const message = ajv.errorsText(actionBundleValidator.errors, { separator: '; ' });
    throw new Error(`Action bundle validation failed: ${message}`);
  }
};
