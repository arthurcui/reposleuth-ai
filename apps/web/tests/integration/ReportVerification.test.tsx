// @vitest-environment jsdom
/** Verifies report coverage is not presented as independent diagnosis or runtime verification. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { demo } from '../../src/features/demo/demo';
import { Report } from '../../src/features/investigations/Report';
afterEach(cleanup);
it('shows unknown verification for legacy saved reports', () => {
  const run = structuredClone(demo);
  run.id = 'legacy';
  render(<Report run={run} />);
  expect(screen.getByLabelText('Report verification').textContent).toContain(
    'Diagnosis unverified',
  );
  expect(
    screen.getByText('Verification details were not recorded for this saved report.'),
  ).toBeTruthy();
});
it('shows backend coverage and source fidelity separately', () => {
  const run = structuredClone(demo);
  run.id = 'saved';
  run.report!.verification = {
    sourceCitations: 'validated',
    diagnosis: 'unverified',
    runtime: 'not_executed',
    coverage: 'partial',
    filesExamined: ['src/a.ts', 'src/b.ts'],
    rangesExamined: 3,
  };
  render(<Report run={run} />);
  const status = screen.getByLabelText('Report verification').textContent;
  expect(status).toContain('Partial investigation');
  expect(status).toContain('2 files examined');
  expect(status).toContain('Citations matched retrieved source');
  expect(status).toContain('Runtime not tested');
});
