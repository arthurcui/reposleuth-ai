/** Extracts bounded failure categories without persisting messages, bodies, headers or credentials. */
export function modelFailure(error: unknown) {
  const field = (value: unknown, key: string): unknown =>
    typeof value === 'object' && value !== null && key in value
      ? (value as Record<string, unknown>)[key]
      : undefined;
  const rawStatus = field(error, 'status');
  const status =
    typeof rawStatus === 'number' &&
    Number.isInteger(rawStatus) &&
    rawStatus >= 100 &&
    rawStatus <= 599
      ? rawStatus
      : null;
  const names = [
    'APIConnectionTimeoutError',
    'APIConnectionError',
    'SyntaxError',
    'TypeError',
    'ZodError',
  ];
  const rawName = field(error, 'name');
  const errorType = typeof rawName === 'string' && names.includes(rawName) ? rawName : 'unknown';
  const transportCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'];
  const rawCode = field(error, 'code') ?? field(field(error, 'cause'), 'code');
  const transportCode =
    typeof rawCode === 'string' && transportCodes.includes(rawCode) ? rawCode : null;
  return {
    status,
    errorType,
    transportCode,
    category:
      status !== null
        ? 'http_response'
        : errorType === 'APIConnectionTimeoutError'
          ? 'timeout'
          : errorType === 'APIConnectionError' || transportCode !== null
            ? 'connection'
            : ['SyntaxError', 'TypeError', 'ZodError'].includes(errorType)
              ? 'local_processing'
              : 'unknown',
  };
}
