import path from 'node:path';
import initSqlJs from 'sql.js';
import type { SqlRunner } from '@/lib/test-engine/grading';

const SQLp = initSqlJs({ locateFile: (f: string) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', f) });

/** Same behaviour as src/lib/test-engine/sql-runner.ts, without the server-only guard. */
export const runSql: SqlRunner = async (seed, query) => {
  const SQL = await SQLp;
  const db = new SQL.Database();
  try {
    db.exec(seed);
    const res = db.exec(query);
    return res.length ? (res[0].values as unknown[][]) : [];
  } finally {
    db.close();
  }
};
