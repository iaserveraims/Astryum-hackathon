// Thrown when the backend gates an action behind a fresh wallet-signature grant.
// The UI catches this, runs the step-up handshake, and retries with the grant.
export class StepUpRequiredError extends Error {
  readonly feature: string;
  readonly action: string;
  readonly status = 403;
  readonly code = 'STEP_UP_REQUIRED';

  constructor(feature: string, action: string) {
    super(`Step-up signature required for ${feature}:${action}`);
    this.name = 'StepUpRequiredError';
    this.feature = feature;
    this.action = action;
    Object.setPrototypeOf(this, StepUpRequiredError.prototype);
  }
}

export function isStepUpRequired(err: unknown): err is StepUpRequiredError {
  return (
    err instanceof StepUpRequiredError ||
    (typeof err === 'object' && err !== null && (err as any).code === 'STEP_UP_REQUIRED')
  );
}
