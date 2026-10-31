/** Exercises bounded source discovery across Node, React and .NET without model or network calls. */
import { briefingSchema } from '@reposleuth/shared';
import { expect, it, vi } from 'vitest';

import { readCodePath } from '../../src/onboarding/readCodePath.js';

function empty() {
  return briefingSchema.parse({
    id: 'test',
    repository: 'owner/repo',
    commitSha: 'a'.repeat(40),
    createdAt: '',
    scope: '',
    status: 'running',
    durationMs: 0,
    filesDiscovered: 0,
    filesRead: 0,
    languages: [],
    directories: [],
    packages: [],
    documents: [],
    manifests: [],
    readingOrder: [],
    testFiles: [],
    limitations: [],
  });
}
function reader(files: Record<string, string>) {
  return vi.fn(async (path: string) => {
    const text = files[path]!;
    const lines = text.split('\n');
    return {
      repository: 'owner/repo',
      commitSha: 'a'.repeat(40),
      path,
      startLine: 1,
      endLine: lines.length,
      totalLines: lines.length,
      lines: lines.map((text, i) => ({ line: i + 1, text })),
    };
  });
}
const cases: Array<{ name: string; files: Record<string, string> }> = [
  {
    name: 'Node API',
    files: {
      'src/server.ts': "import { app } from './app.js';\napp.listen(3001);",
      'src/app.ts': "import { route } from './routes/orders';\nexport const app = route;",
      'src/routes/orders.ts': 'export const route = {};',
    },
  },
  {
    name: 'React',
    files: {
      'src/main.tsx': "import App from './App';\ncreateRoot(root).render(<App />);",
      'src/App.tsx': "import { Orders } from './Orders';\nexport default () => <Orders />;",
      'src/Orders.tsx': 'export const Orders = () => <p>Orders</p>;',
    },
  },
  {
    name: '.NET',
    files: {
      'Program.cs':
        'builder.Services.AddScoped<BookingService>();\napp.MapGet("/bookings", (BookingService service) => service.List());',
      'BookingService.cs': 'public class BookingService { public BookingStore Store; }',
      'BookingStore.cs': 'public class BookingStore {}',
    },
  },
];
it.each(cases)('reads a connected $name route and retains source ranges', async ({ files }) => {
  const report = empty();
  const contents = files;
  await readCodePath(report, Object.keys(contents), reader(contents));
  expect(report.codeSources).toHaveLength(3);
  expect(report.codeConnections?.length).toBeGreaterThanOrEqual(2);
  for (const source of report.codeSources ?? []) {
    expect(source.text).toBe(contents[source.path]);
    expect(source.endLine).toBe(contents[source.path]!.split('\n').length);
  }
});
it('does not resolve ambiguous targets or follow tests and out-of-scope imports', async () => {
  const files = {
    'src/main.ts': "import './thing';\nimport '../outside';\nimport './main.test';",
    'src/thing.ts': 'one',
    'src/thing.js': 'two',
    'src/main.test.ts': 'test',
  };
  const report = empty();
  await readCodePath(report, Object.keys(files), reader(files));
  expect(report.codeSources?.map((s) => s.path)).toEqual(['src/main.ts']);
  expect(report.codeCoverage?.join(' ')).toContain('ambiguous');
});
it('stops cyclic traversal and exposes truncated coverage', async () => {
  const files: Record<string, string> = {
    'src/main.ts': "import './part1';\n" + 'const text = 1;\n'.repeat(250),
  };
  for (let i = 1; i < 10; i++)
    files[`src/part${i}.ts`] = `import './part${i + 1}';\nimport './main';`;
  const read = reader(files),
    report = empty();
  await readCodePath(report, Object.keys(files), read);
  expect(read).toHaveBeenCalledTimes(6);
  expect(report.codeSources?.[0]?.complete).toBe(false);
  expect(report.codeCoverage?.join(' ')).toContain('six source reads');
});
it('declines to manufacture a route without an entry candidate', async () => {
  const read = reader({ 'helpers.ts': 'export const x = 1;' }),
    report = empty();
  await readCodePath(report, ['helpers.ts'], read);
  expect(read).not.toHaveBeenCalled();
  expect(report.codeCoverage?.join(' ')).toContain('No supported entry candidate');
});

it('prioritizes a component helper over siblings, promoting an already queued target', async () => {
  const files = {
    'src/main.tsx':
      "import './Counter';\nimport './Customer';\nimport './TaskList';\nimport './Cart';\nimport './Tasks';\nimport './api';",
    'src/Counter.tsx': 'export const Counter = () => null;',
    'src/Customer.tsx':
      "import { customer } from './api';\nexport const Customer = () => customer('a');",
    'src/TaskList.tsx': 'export const TaskList = () => null;',
    'src/Cart.tsx': 'export const Cart = () => null;',
    'src/Tasks.tsx': 'export const Tasks = () => null;',
    'src/api.ts': "import { lookup } from './data';\nexport const customer = lookup;",
    'src/data.ts': 'export const lookup = (id: string) => id;',
  };
  const read = reader(files),
    report = empty();
  await readCodePath(report, Object.keys(files), read);
  expect(report.codeSources?.map((s) => s.path)).toEqual([
    'src/main.tsx',
    'src/Counter.tsx',
    'src/Customer.tsx',
    'src/api.ts',
    'src/data.ts',
    'src/TaskList.tsx',
  ]);
  expect(read).toHaveBeenCalledTimes(6);
  expect(report.codeConnections).toContainEqual({
    from: 'src/Customer.tsx',
    to: 'src/api.ts',
    line: 1,
    kind: 'relative import',
  });
  expect(report.codeCoverage?.join(' ')).toContain('six source reads');
});

it('continues to siblings when a deeper dependency is unreadable', async () => {
  const files = {
    'src/main.ts': "import './branch';\nimport './other';",
    'src/branch.ts': "import './missing';",
    'src/other.ts': 'export const value = 1;',
  };
  const normalRead = reader(files);
  const report = empty();
  await readCodePath(report, [...Object.keys(files), 'src/missing.ts'], async (path) =>
    path === 'src/missing.ts' ? undefined : normalRead(path),
  );
  expect(report.codeSources?.map((s) => s.path)).toEqual([
    'src/main.ts',
    'src/branch.ts',
    'src/other.ts',
  ]);
  expect(report.codeConnections?.some((edge) => edge.to === 'src/missing.ts')).toBe(false);
  expect(report.codeCoverage?.join(' ')).toContain('Source unavailable: src/missing.ts');
});
