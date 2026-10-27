/** Creates provider model adapters without coupling them to investigation orchestration. */
import { type Model, OpenAIChatCompletionsModel, OpenAIResponsesModel } from '@openai/agents';
import OpenAI from 'openai';

import { StopError } from '../budget.js';
import { OPENAI, type ProviderConfig } from '../provider.js';
export function liveModel(apiKey: string, config: ProviderConfig = OPENAI): Model {
  const client = new OpenAI({
    apiKey,
    baseURL:
      config.provider === 'gemini'
        ? 'https://generativelanguage.googleapis.com/v1beta/openai/'
        : 'https://api.openai.com/v1',
    maxRetries: 0,
    timeout: 30000,
  });
  if (config.provider !== 'gemini') return new OpenAIResponsesModel(client, config.model);
  const delegate = new OpenAIChatCompletionsModel(client, config.model);
  return {
    getResponse: (request) =>
      delegate.getResponse({
        ...request,
        // Gemini compatibility uses JSON-object mode, including final reporting.
        // Pass the schema itself (not the SDK envelope) and validate strictly locally.
        systemInstructions: `${request.systemInstructions ?? ''}\nWhen finished, return only JSON matching this schema. Return an instance with actual findings, never the schema itself. No markdown fences or surrounding commentary:\n${JSON.stringify(typeof request.outputType === 'object' ? request.outputType.schema : request.outputType)}`,
        outputType: 'text',
        modelSettings: {
          ...request.modelSettings,
          toolChoice: request.tools.length === 0 ? undefined : request.modelSettings.toolChoice,
          providerData: {
            ...request.modelSettings.providerData,
            response_format: { type: 'json_object' },
          },
        },
      }),
    getStreamedResponse: () => {
      throw new StopError('STREAMING_MODEL_DISABLED');
    },
  };
}
