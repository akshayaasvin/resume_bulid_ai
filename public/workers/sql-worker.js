/* SQL runner (sql.js / SQLite wasm) in a Web Worker. Preview only: grading re-runs on the server. */
/* eslint-disable no-undef */
let loading = null;

function init(base) {
  if (!loading) {
    importScripts(base + 'sql-wasm.js');
    loading = initSqlJs({ locateFile: (f) => base + f });
  }
  return loading;
}

self.onmessage = async (e) => {
  const { id, type, base, seed, query } = e.data;
  try {
    const SQL = await init(base);
    if (type === 'init') {
      self.postMessage({ id, ok: true });
      return;
    }
    const db = new SQL.Database();
    try {
      db.exec(seed);
      const res = db.exec(query);
      const first = res.length ? res[0] : { columns: [], values: [] };
      self.postMessage({ id, ok: true, result: { columns: first.columns, values: first.values.slice(0, 200) } });
    } finally {
      db.close();
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
