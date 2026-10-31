/** Validates onboarding responses and surfaces failures without silently resubmitting jobs. */
import { briefingSchema } from '@reposleuth/shared';
export async function briefingRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init);
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `API returned an invalid response (${response.status}). Check that the API is running.`,
      { cause: error },
    );
  }
  if (!response.ok)
    throw new Error(
      typeof value === 'object' &&
        value !== null &&
        'error' in value &&
        typeof value.error === 'string'
        ? value.error
        : `Request failed (${response.status}).`,
    );
  return value;
}
export async function getBriefing(id: string) {
  return briefingSchema.parse(await briefingRequest(`/api/briefings/${encodeURIComponent(id)}`));
}
