import { Pool } from "pg";

/**
 * Single shared Postgres pool for server-side DB reads.
 *
 * Next.js dev reloads modules on every file change, so we stash the
 * pool on globalThis to avoid exhausting Postgres connections during
 * iterative development.
 */

declare global {
  // eslint-disable-next-line no-var
  var _astraPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.ASTRA_DB_URL;
  if (!connectionString) {
    throw new Error("ASTRA_DB_URL is not configured");
  }
  return new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
  });
}

export function astraPool(): Pool {
  if (!globalThis._astraPool) {
    globalThis._astraPool = createPool();
  }
  return globalThis._astraPool;
}
