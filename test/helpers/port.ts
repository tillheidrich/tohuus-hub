import net from 'node:net';

const isFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.unref();
    s.once('error', () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });

let next = 0;

/**
 * A free port for tests that must know their URL before importing the server. Each vitest worker running at the same
 * time gets its own block of 50 ports (VITEST_POOL_ID), so two test files can never pick the same port between this
 * check and the server's listen – that race once sent one file's requests to another file's server (CI, 14 Oct 2026).
 */
export async function freePort(): Promise<number> {
  const pool = Number(process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? 0) % 300;
  for (let i = 0; i < 50; i++) {
    const port = 30000 + pool * 50 + (next++ % 50);
    if (await isFree(port)) return port;
  }
  // every port of the block is taken by something else: let the OS choose
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}
