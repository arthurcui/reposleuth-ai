/** Provides fixed GitHub tree, blob, and source responses for isolated repository tests. */
/** Small deterministic GitHub API fixture; no credentials or live requests. */
export const FIXTURE_SHA = 'a'.repeat(40);
export const TREE_SHA = 'b'.repeat(40);
export const BLOB_SHA = 'c'.repeat(40);
export const SOURCE =
  'export async function loadCustomers(db) {\n  const customers = await db.customers.findMany();\n  for (const customer of customers) {\n    customer.orders = await db.orders.findMany({ customerId: customer.id });\n  }\n  return customers;\n}\n';
export function fixtureTree() {
  return {
    sha: TREE_SHA,
    truncated: false,
    tree: [
      {
        path: 'src/customers.ts',
        type: 'blob',
        mode: '100644',
        sha: BLOB_SHA,
        size: Buffer.byteLength(SOURCE),
      },
      { path: 'node_modules/lib.js', type: 'blob', mode: '100644', sha: 'd'.repeat(40), size: 5 },
      { path: 'link.ts', type: 'blob', mode: '120000', sha: 'e'.repeat(40), size: 5 },
    ],
  };
}
