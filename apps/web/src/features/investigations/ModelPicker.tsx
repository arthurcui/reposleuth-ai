/** Discovers server-configured provider models and selects a model for the next investigation. */
import { type ModelCatalog, modelCatalogSchema } from '@reposleuth/shared';
import { useEffect, useState } from 'react';

import { api } from './client';

export function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (disabled) return;
    let disposed = false;
    setLoading(true);
    setError('');
    async function load() {
      try {
        const result = modelCatalogSchema.parse(await api('/models'));
        if (!disposed) setCatalog(result);
      } catch (cause) {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : 'Unable to discover models.');
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    load().catch(() => {
      if (!disposed) setError('Unable to load data. Please retry.');
    });
    return () => {
      disposed = true;
    };
  }, [disabled, retry]);
  const selected = catalog?.models.find((m) => `${m.provider}:${m.model}` === value);
  return (
    <div className="model-picker">
      <label htmlFor="investigation-model">Investigation model</label>
      <select
        id="investigation-model"
        value={value}
        disabled={disabled || loading}
        title={selected?.model ?? catalog?.defaultSelection.model}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {catalog
            ? `Default model (${catalog.defaultSelection.model})`
            : disabled
              ? 'Model selection unavailable in demo or while busy'
              : loading
                ? 'Loading models…'
                : 'Models unavailable'}
        </option>
        {value && !selected && (
          <option value={value} disabled>
            {value} — availability not confirmed
          </option>
        )}
        {(['openai', 'gemini'] as const).map((provider) => (
          <optgroup key={provider} label={provider === 'openai' ? 'OpenAI' : 'Google Gemini'}>
            {catalog?.models
              .filter((m) => m.provider === provider)
              .map((m) => (
                <option key={m.model} value={`${provider}:${m.model}`} disabled={!m.selectable}>
                  {m.model}
                  {!m.selectable ? ' — not enabled' : ''}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {(error || Boolean(catalog?.errors.length)) && (
        <button
          type="button"
          className="secondary"
          disabled={disabled || loading}
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry model discovery
        </button>
      )}
      {selected?.selectable && (
        <p className="muted small">
          Estimated USD per million tokens: ${selected.inputPerMillion} input · $
          {selected.outputPerMillion} output.
        </p>
      )}
      {catalog && (
        <p className="muted small">
          Models come from configured provider accounts. Disabled models need reviewed compatibility
          and pricing. Lists are cached for up to five minutes.
        </p>
      )}
      {catalog && !catalog.models.length && (
        <p className="notice">No models discovered. Check the server’s provider keys.</p>
      )}
      {catalog?.errors.map((item) => (
        <p role="alert" key={item.provider}>
          {item.provider}: {item.message}
        </p>
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
