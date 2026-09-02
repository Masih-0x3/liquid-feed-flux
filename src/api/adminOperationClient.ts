import { invokeAdminAction, invokeAdminRead, type AdminActionBody } from './adminActions';
import { AdminActionClientError, createAdminActionResponseError, withAdminActionDeadline } from './adminActionErrors';

export type AdminOperationStatus = 'committed' | 'failed' | 'still_running' | 'unknown';

export type AdminOperationResult<T = unknown> = {
  operation_id: string;
  operation_status: AdminOperationStatus;
  data?: T;
  error?: string;
};

type AdminOperationEnvelope<T> = {
  operation_id?: unknown;
  operation_status?: unknown;
  error?: unknown;
  [key: string]: unknown;
};

export type InvokeAdminOperationOptions = {
  timeoutMs?: number;
  failureMessage?: string;
};

const OPERATION_DEADLINES: Record<string, number> = {
  reprocess: 10_000,
  hydrate_post: 10_000,
};

// Operation IDs are parsed by both the client and the Edge function. Keep the
// tweet component deliberately narrower than the separator grammar so an ID
// can never be reinterpreted when it is reconciled.
const ADMIN_OPERATION_TWEET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ADMIN_OPERATION_ID_PATTERN = /^(?:reprocess|hydrate:manual_monitoring):[A-Za-z0-9_-]{1,128}$/;

function isOperationStatus(value: unknown): value is AdminOperationStatus {
  return value === 'committed' || value === 'failed' || value === 'still_running' || value === 'unknown';
}

function requireTweetId(body: AdminActionBody): string {
  const tweetId = body.tweet_id;
  if (typeof tweetId !== 'string' || !ADMIN_OPERATION_TWEET_ID_PATTERN.test(tweetId)) {
    throw new AdminActionClientError('invalid_request');
  }
  return tweetId;
}

export function adminOperationIdForBody(body: AdminActionBody): string {
  const tweetId = requireTweetId(body);
  if (body.action === 'reprocess') return `reprocess:${tweetId}`;
  if (body.action === 'hydrate_post') return `hydrate:manual_monitoring:${tweetId}`;
  throw new AdminActionClientError('invalid_request');
}

function unknownResult<T>(operationId: string): AdminOperationResult<T> {
  return { operation_id: operationId, operation_status: 'unknown' };
}

function readEnvelope<T>(value: unknown, operationId: string): AdminOperationResult<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createAdminActionResponseError();
  }
  const envelope = value as AdminOperationEnvelope<T>;
  if (envelope.operation_id !== operationId || !isOperationStatus(envelope.operation_status)) {
    throw new AdminActionClientError('invalid_request');
  }
  const { operation_id: _operationId, operation_status: _operationStatus, error, ...data } = envelope;
  return {
    operation_id: operationId,
    operation_status: envelope.operation_status,
    data: Object.keys(data).length > 0 ? data as T : undefined,
    error: typeof error === 'string' ? error : undefined,
  };
}

function classifyUnknownTransport(error: unknown): error is AdminActionClientError {
  return error instanceof AdminActionClientError && (
    error.code === 'admin_action_deadline_exceeded' || error.code === 'admin_action_unavailable'
  );
}

export async function invokeAdminOperation<T = unknown>(
  body: AdminActionBody,
  options: InvokeAdminOperationOptions = {},
): Promise<AdminOperationResult<T>> {
  const operationId = adminOperationIdForBody(body);
  const timeoutMs = options.timeoutMs ?? OPERATION_DEADLINES[body.action] ?? 10_000;
  const requestBody = { ...body, operation_id: operationId } as AdminActionBody;
  try {
    // FunctionsClient.invoke has no cancellation signal in the pinned client. This
    // deadline only classifies the client outcome; upstream work may continue.
    const response = await withAdminActionDeadline(
      () => invokeAdminAction<AdminOperationEnvelope<T>>(requestBody, { throwOnFailure: false }),
      timeoutMs,
    );
    return readEnvelope<T>(response, operationId);
  } catch (error) {
    if (classifyUnknownTransport(error)) return unknownResult(operationId);
    if (error instanceof AdminActionClientError && options.failureMessage) {
      throw new AdminActionClientError(error.code, {
        failureMessage: options.failureMessage,
        status: error.status,
      });
    }
    throw error;
  }
}

export async function reconcileAdminOperation<T = unknown>(operationId: string): Promise<AdminOperationResult<T>> {
  if (!ADMIN_OPERATION_ID_PATTERN.test(operationId)) {
    throw new AdminActionClientError('invalid_request');
  }
  const response = await invokeAdminRead<AdminOperationEnvelope<T>>({
    action: 'get_admin_operation_status',
    operation_id: operationId,
  });
  return readEnvelope<T>(response, operationId);
}
