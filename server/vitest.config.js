import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Each file gets its own database, so files can run in parallel without
    // one test's fixtures showing up in another's queries.
    fileParallelism: true,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
