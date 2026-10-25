/** Discovers automated tests in dedicated test directories, excluding live evaluation commands. */
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['apps/*/tests/**/*.test.{ts,tsx}', 'packages/*/tests/**/*.test.{ts,tsx}'] },
});
