/** Selects report text using Agents SDK 0.21 semantics and records content-free diagnostics. */
import type { ModelResponse } from '@openai/agents';
import { z } from 'zod';

function messageText(item: ModelResponse['output'][number]): string | undefined {
  if (item.type !== 'message' || item.role !== 'assistant') return undefined;
  const parts = item.content.filter((part) => part.type === 'output_text');
  return parts.length ? parts.map((part) => part.text).join('') : undefined;
}

/** Match runner/turnResolution and utils/messages; do not select whichever JSON happens to parse. */
export function reportText(response: ModelResponse): string {
  const output = response.output;
  const segmented =
    output.some((item) =>
      ['reasoning', 'tool_search_call', 'tool_search_output'].includes(item.type ?? ''),
    ) &&
    output.every((item) =>
      ['message', 'reasoning', 'tool_search_call', 'tool_search_output'].includes(item.type ?? ''),
    );
  const messages = output.filter((item) => item.type === 'message');
  const last = messages.at(-1);
  if (!last || messageText(last) === undefined) return '';
  const tail = output.at(-1);
  return (
    (segmented
      ? output.map((item) => messageText(item) ?? '').join('')
      : tail && messageText(tail)) ||
    messageText(last) ||
    ''
  );
}

export function reportDiagnostics(response: ModelResponse) {
  const metadata = z
    .object({
      status: z
        .enum(['completed', 'incomplete', 'failed', 'cancelled', 'in_progress', 'queued'])
        .optional(),
      incomplete_details: z
        .object({ reason: z.enum(['max_output_tokens', 'content_filter']).optional() })
        .nullish(),
      choices: z
        .array(
          z.object({
            finish_reason: z
              .enum(['stop', 'length', 'content_filter', 'tool_calls', 'function_call'])
              .nullable(),
          }),
        )
        .optional(),
    })
    .safeParse(response.providerData);
  const texts = response.output.flatMap((item) => {
    const text = messageText(item);
    return text === undefined ? [] : [text];
  });
  return {
    messageCount: texts.length,
    messageCharacters: texts.map((text) => text.length),
    messageJsonValid: texts.map((text) => {
      try {
        JSON.parse(text);
        return true;
      } catch {
        return false;
      }
    }),
    reasoningItems: response.output.filter((item) => item.type === 'reasoning').length,
    outputTokens: response.usage.outputTokens,
    providerStatus: metadata.success ? (metadata.data.status ?? null) : null,
    incompleteReason: metadata.success ? (metadata.data.incomplete_details?.reason ?? null) : null,
    finishReasons: metadata.success
      ? (metadata.data.choices?.map((choice) => choice.finish_reason) ?? [])
      : [],
  };
}
