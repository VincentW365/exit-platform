/** Service-layer error model mapped to safe UI responses (REQ-SEC-034). */
export type ServiceErrorCode = 'VALIDATION' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT';

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  /** User-safe messages (no internals, no record existence leaks). */
  readonly details: readonly string[];

  constructor(code: ServiceErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.details = details;
  }

  static validation(details: readonly string[]): ServiceError {
    return new ServiceError('VALIDATION', 'Validation failed.', details);
  }

  static forbidden(message = 'You are not authorized to perform this action.'): ServiceError {
    return new ServiceError('FORBIDDEN', message);
  }

  /**
   * Used both for genuinely missing records and for records the actor may not
   * discover (restricted cases must not leak existence - IC-S1-011).
   */
  static notFound(message = 'The requested record was not found.'): ServiceError {
    return new ServiceError('NOT_FOUND', message);
  }

  static conflict(message: string): ServiceError {
    return new ServiceError('CONFLICT', message);
  }
}
