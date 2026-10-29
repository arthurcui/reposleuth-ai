/** Synthetic adversarial additions for the reliability campaign; private expectations never enter agent input. */
export const reliabilityCases = [
  {
    id: 'insufficient-information',
    question: 'The customer endpoint is slow. The reporter suspects N+1 queries.',
    files: { 'src/api.ts': "import { db } from './db';" },
    expected: {
      outcome: 'insufficient_evidence',
      reason: 'Imports cannot establish query behavior.',
      requiredPaths: [],
    },
  },
  {
    id: 'correct-batching',
    question:
      'The reporter claims this loop makes one database call per customer. Investigate that claim.',
    files: {
      'src/load.ts':
        'export async function load(ids) {\n const orders = await db.orders.findMany({customerId:{in:ids}});\n return ids.map(id => orders.filter(order => order.customerId === id));\n}',
    },
    expected: {
      outcome: 'no_supported_defect',
      reason:
        'One batch query before an in-memory mapping; the alleged per-customer database call is absent from this supplied function.',
      requiredPaths: ['src/load.ts'],
    },
  },
  {
    id: 'wrapper-and-service',
    question: 'Order loading slows as customer count grows. Find the cause supported by code.',
    files: {
      'src/api.ts': "import {load} from './service';\nexport const handler = (ids) => load(ids);",
      'src/service.ts':
        'export async function load(ids) {\n const result=[];\n for(const id of ids) result.push(await db.orders.findMany({customerId:id}));\n return result;\n}',
    },
    expected: {
      outcome: 'supported_hypothesis',
      reason:
        'The wrapper delegates and the service performs one awaited database API call per id. Runtime latency is unmeasured.',
      requiredPaths: ['src/api.ts', 'src/service.ts'],
    },
  },
  {
    id: 'misleading-name',
    question:
      'The reporter says a function named cachedLoad proves stale caching caused missing updates.',
    files: {
      'src/cache.ts':
        'export async function cachedLoad(id) {\n return db.records.findUnique({where:{id}});\n}',
    },
    expected: {
      outcome: 'no_supported_defect',
      reason:
        'The name does not establish caching; supplied source directly calls the database API. Database internals are unknown.',
      requiredPaths: ['src/cache.ts'],
    },
  },
] as const;
