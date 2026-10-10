import 'server-only';
import path from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import type { SqlRunner } from './grading';

let sqlPromise: Promise<SqlJsStatic> | null = null;

function loadSql() {
  sqlPromise ??= initSqlJs({
    locateFile: (file: string) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
  });
  return sqlPromise;
}

/** Authoritative server-side SQL grading: fresh in-memory DB per query. */
export const runSqlOnServer: SqlRunner = async (seed, query) => {
  const SQL = await loadSql();
  const db = new SQL.Database();
  try {
    db.exec(seed);
    const res = db.exec(query);
    return res.length ? (res[0].values as unknown[][]) : [];
  } finally {
    db.close();
  }
};
