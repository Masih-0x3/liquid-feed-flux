export type AdminActionClientErrorCode =
  | 'authorization_failed'
  | 'invalid_request'
  | 'rate_limited'
  | 'admin_action_unavailable'
  | 'admin_action_deadline_exceeded'
  | 'admin_action_failed';

export type AdminActionFailureOptions = {
  failureMessage?: string;
};

const DEFAULT_MESSAGES: Record<AdminActionClientErrorCode, string> = {
  authorization_failed: 'You are not authorized to perform this action.',
  invalid_request: 'The request could not be accepted.',
  rate_limited: 'The request is temporarily rate limited.',
  admin_action_unavailable: 'The service is temporarily unavailable.',
  admin_action_deadline_exceeded: 'The request took too long to complete.',
  admin_action_failed: 'The action could not be completed.',
};

export class AdminActionClientError extends Error {
  readonly code: AdminActionClientErrorCode;
  readonly status: number | undefined;

  constructor(code: AdminActionClientErrorCode, options: AdminActionFailureOptions & { status?: number } = {}) {
    super(options.failureMessage ?? DEFAULT_MESSAGES[code]);
    this.name = 'AdminActionClientError';
    this.code = code;
    this.status = options.status;
  }
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599;
}

export function getAdminFunctionErrorStatus(error: unknown): number | undefined {
  try {
    if (!error || typeof error !== 'object' || !('context' in error)) return undefined;
    const context = (error as { context?: unknown }).context;
    if (!context || typeof context !== 'object' || !('status' in context)) return undefined;
    const status = (context as { status?: unknown }).status;
    return isHttpStatus(status) ? status : undefined;
  } catch {
    return undefined;
  }
}

export function adminActionErrorCodeForStatus(status: number | undefined): AdminActionClientErrorCode {
  switch (status) {
    case 401:
    case 403:
      return 'authorization_failed';
    case 400:
    case 413:
    case 422:
      return 'invalid_request';
    case 429:
      return 'rate_limited';
    default:
      return 'admin_action_unavailable';
  }
}

export function createAdminActionTransportError(error: unknown): AdminActionClientError {
  const status = getAdminFunctionErrorStatus(error);
  return new AdminActionClientError(adminActionErrorCodeForStatus(status), { status });
}

export async function withNormalizedAdminActionTransport<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    throw createAdminActionTransportError(error);
  }
}

export async function withAdminActionDeadline<T>(
  request: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const deadlineMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.floor(timeoutMs)
    : 15_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new AdminActionClientError('admin_action_deadline_exceeded'));
    }, deadlineMs);
  });
  try {
    return await Promise.race([request(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createAdminActionResponseError(options: AdminActionFailureOptions = {}): AdminActionClientError {
  return new AdminActionClientError('admin_action_failed', options);
}
