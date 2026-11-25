import prisma from "@/lib/prisma";

function redactSql(value: unknown) {
  return String(value || "")
    .replace(/'(?:''|[^'])*'/g, "'?'")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export async function readPostgresStatus() {
  const [summary, connections, slowQueries] = await Promise.all([
    prisma.$queryRaw<Array<{
      databaseName: string;
      version: string;
      observedAt: Date;
      maxConnections: number;
    }>>`
      SELECT
        current_database() AS "databaseName",
        version() AS "version",
        now() AS "observedAt",
        current_setting('max_connections')::int AS "maxConnections"
    `,
    prisma.$queryRaw<Array<{ state: string | null; count: bigint }>>`
      SELECT state, count(*)::bigint AS count
      FROM pg_stat_activity
      GROUP BY state
      ORDER BY count(*) DESC
    `,
    prisma.$queryRaw<Array<{
      pid: number;
      databaseName: string | null;
      username: string | null;
      state: string | null;
      durationSeconds: number;
      query: string | null;
    }>>`
      SELECT
        pid,
        datname AS "databaseName",
        usename AS "username",
        state,
        EXTRACT(EPOCH FROM (now() - query_start))::double precision AS "durationSeconds",
        query
      FROM pg_stat_activity
      WHERE state <> 'idle'
        AND pid <> pg_backend_pid()
        AND query_start IS NOT NULL
        AND now() - query_start > interval '5 seconds'
      ORDER BY query_start ASC
      LIMIT 20
    `,
  ]);

  return {
    summary: summary[0]
      ? {
        ...summary[0],
        observedAt: summary[0].observedAt.toISOString(),
      }
      : null,
    connections: connections.map((item) => ({
      state: item.state || "unknown",
      count: Number(item.count),
    })),
    slowQueries: slowQueries.map((item) => ({
      ...item,
      query: redactSql(item.query),
    })),
  };
}
