import os from 'node:os';
import { defineConfig } from 'vitest/config';

// Test stability (20 Oct 2026): every test file starts its own ToHuus server in its own worker. With one worker per
// core (vitest's default) plus sharp/libvips threads in each of them, a busy machine (Xcode, a second suite) ran out
// of CPU and 4–14 tests per run hit the 5 s timeout although each passes in well under a second on its own.
// Half the cores (at least two) keeps the suite about as fast and stops the pile-up; test/setup-env.ts keeps the
// suite off the internet and caps libvips to one thread per worker. The longer timeouts are a margin, not a crutch:
// nothing in the suite should come near them.
const workers = Math.max(2, Math.floor((os.availableParallelism?.() ?? os.cpus().length) / 2));

export default defineConfig({
  test: {
    root: '.',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup-env.ts'],
    maxWorkers: Number(process.env.TEST_WORKERS) || workers,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
