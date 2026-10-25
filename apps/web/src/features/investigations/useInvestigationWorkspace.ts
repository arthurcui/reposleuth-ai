/** Owns investigation form state, URL navigation, event subscriptions, and lifecycle actions. */
import {
  type Investigation,
  type InvestigationEvent,
  investigationRequestSchema,
} from '@reposleuth/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { z } from 'zod';

import { demoCases, demoForCase } from '../demo/demo';
import { api, eventSchema, isActive, runSchema } from './client';
const currentId = () => new URLSearchParams(location.search).get('investigation');
const currentCase = () => {
  const selected = new URLSearchParams(location.search).get('case');
  return demoCases.find((item) => item.id === selected)?.id ?? demoCases[0]!.id;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to reach the local API.';
export function useInvestigationWorkspace() {
  const [modelSelection, setModelSelection] = useState('');
  const [id, setId] = useState(currentId);
  const [caseId, setCaseId] = useState(currentCase);
  const [run, setRun] = useState<Investigation | null>(null);
  const [events, setEvents] = useState<InvestigationEvent[]>([]);
  const [repository, setRepository] = useState('');
  const [issue, setIssue] = useState('');
  const [question, setQuestion] = useState(
    'Find the relevant code, explain the likely root cause, and recommend a fix.',
  );
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const active = Boolean(run && isActive(run.status));
  const busy = active || submitting || Boolean(id && id !== 'demo' && !run && !error);
  const showingDemo = id === 'demo';
  const caseIndex = demoCases.findIndex((item) => item.id === caseId);
  const formDisabled = busy || showingDemo;
  function leaveDemo() {
    const url = new URL(location.href);
    url.searchParams.delete('investigation');
    url.searchParams.delete('case');
    history.pushState(null, '', url);
    setId(null);
  }
  function select(next: string) {
    const url = new URL(location.href);
    url.searchParams.set('investigation', next);
    if (next === 'demo') url.searchParams.set('case', caseId);
    else url.searchParams.delete('case');
    history.pushState(null, '', url);
    setId(next);
  }
  function selectCase(next: string) {
    const url = new URL(location.href);
    url.searchParams.set('case', next);
    url.hash = '';
    history.pushState(null, '', url);
    setCaseId(next);
  }
  useEffect(() => {
    const pop = () => {
      setId(currentId());
      setCaseId(currentCase());
    };
    window.addEventListener('popstate', pop);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener('popstate', pop);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    setRun(null);
    setEvents([]);
    setError('');
    setCancelling(false);
    if (!id) {
      setConnection('');
      return;
    }
    if (id === 'demo') {
      setRun(demoForCase(caseId));
      setConnection('');
      return;
    }
    let disposed = false;
    let loading = false;
    let terminal = false;
    let formLoaded = false;
    const source = new EventSource(`/api/investigations/${encodeURIComponent(id)}/events`);
    setConnection('Connecting…');
    async function refresh() {
      if (loading || disposed) return;
      loading = true;
      try {
        const result = runSchema.parse(await api(`/${encodeURIComponent(id!)}`));
        if (disposed) return;
        // Populate once when opening a saved run; later progress updates must preserve edits.
        if (!formLoaded) {
          setRepository(result.request.repository);
          setIssue(result.request.issueNumber?.toString() ?? '');
          setQuestion(result.request.question);
          const selection = result.request.modelSelection;
          setModelSelection(
            selection
              ? `${selection.provider}:${selection.model}`
              : result.provider
                ? `${result.provider}:${result.model}`
                : '',
          );
          formLoaded = true;
        }
        setRun(result);
        setError('');
        if (!isActive(result.status)) {
          terminal = true;
          setConnection('Saved locally');
        }
      } catch (cause) {
        if (!disposed) {
          setError(message(cause));
          setConnection('Connection interrupted · retrying');
        }
      } finally {
        loading = false;
      }
    }
    const receive = (event: MessageEvent<string>) => {
      try {
        const parsed = eventSchema.parse(JSON.parse(event.data));
        if (disposed || parsed.investigationId !== id) return;
        setEvents((previous) =>
          previous.some((item) => item.id === parsed.id)
            ? previous
            : [...previous, parsed].sort((a, b) => a.id - b.id).slice(-200),
        );
        if (parsed.type === 'terminal') source.close();
        refresh().catch((cause) => {
          if (!disposed) setError(message(cause));
        });
      } catch {
        /* Polling restores authoritative state if an event is malformed. */
      }
    };
    for (const name of [
      'queued',
      'started',
      'revision',
      'tool_started',
      'tool_finished',
      'usage',
      'validating',
      'validation_failed',
      'terminal',
    ])
      source.addEventListener(name, receive as EventListener);
    source.onopen = () => {
      if (!disposed && !terminal) setConnection('Live updates');
    };
    source.onerror = () => {
      if (terminal) source.close();
      else if (!disposed) setConnection('Reconnecting · polling status');
    };
    refresh().catch((cause) => {
      if (!disposed) setError(message(cause));
    });
    const poll = setInterval(() => {
      if (!terminal)
        refresh().catch((cause) => {
          if (!disposed) setError(message(cause));
        });
    }, 2500);
    return () => {
      disposed = true;
      clearInterval(poll);
      source.close();
    };
  }, [id, caseId, retry]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (formDisabled) return;
    setError('');
    const parsed = investigationRequestSchema.safeParse({
      repository,
      ...(issue ? { issueNumber: Number(issue) } : {}),
      question,
      ...(modelSelection
        ? {
            modelSelection: {
              provider: modelSelection.split(':')[0],
              model: modelSelection.slice(modelSelection.indexOf(':') + 1),
            },
          }
        : {}),
    });
    if (!parsed.success) {
      setError(
        'Enter a repository, a positive issue number (optional), and a question of 5–2,000 characters.',
      );
      return;
    }
    setSubmitting(true);
    try {
      const result = z.object({ id: z.string().regex(/^[\w-]+$/) }).parse(
        await api('', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        }),
      );
      select(result.id);
    } catch (cause) {
      setError(
        `${message(cause)} If the connection failed after submission, the run may still have started; avoid submitting repeatedly.`,
      );
    } finally {
      setSubmitting(false);
    }
  }
  async function cancel() {
    if (!id) return;
    setCancelling(true);
    try {
      await api(`/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    } catch (cause) {
      setError(message(cause));
      setCancelling(false);
    }
  }
  const duration = run
    ? active && run.startedAt
      ? Math.max(run.durationMs, now - Date.parse(run.startedAt))
      : run.durationMs
    : 0;
  return {
    modelSelection,
    setModelSelection,
    id,
    caseId,
    run,
    events,
    repository,
    setRepository,
    issue,
    setIssue,
    question,
    setQuestion,
    error,
    connection,
    submitting,
    cancelling,
    setRetry,
    active,
    busy,
    showingDemo,
    caseIndex,
    formDisabled,
    leaveDemo,
    select,
    selectCase,
    submit: (event: FormEvent) => {
      submit(event).catch((cause) => setError(message(cause)));
    },
    cancel: () => {
      cancel().catch((cause) => setError(message(cause)));
    },
    duration,
  };
}
export type InvestigationWorkspace = ReturnType<typeof useInvestigationWorkspace>;
