const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 90_000;

export function openAiRequestTimeoutMs(env = process.env) {
  const value = Number(env.OPENAI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_OPENAI_REQUEST_TIMEOUT_MS;
}

export async function fetchOpenAI(fetchImpl, url, init = {}, label = "OpenAI request") {
  const timeoutMs = openAiRequestTimeoutMs();
  if (timeoutMs === 0) return await fetchImpl(url, init);

  const controller = new AbortController();
  const callerSignal = init.signal;
  const forwardCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) {
    forwardCallerAbort();
  } else {
    callerSignal?.addEventListener?.("abort", forwardCallerAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener?.("abort", forwardCallerAbort);
  }
}
