/** Restores the actual saved model, including records created before provider metadata existed. */
import type { Investigation } from '@reposleuth/shared';

export function savedModelSelection(
  run: Pick<Investigation, 'provider' | 'model' | 'request'>,
): string {
  if (run.provider) return `${run.provider}:${run.model}`;
  const selected = run.request.modelSelection;
  if (selected) return `${selected.provider}:${selected.model}`;
  // Only infer unambiguous historical model families; never silently use today's default.
  if (/^(gpt-|chatgpt-|o\d+(?:-|$))/.test(run.model)) return `openai:${run.model}`;
  if (/^gemini-/.test(run.model)) return `gemini:${run.model}`;
  return `unknown:${run.model}`;
}
