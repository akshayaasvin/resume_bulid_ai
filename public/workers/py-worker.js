/* Python runner (Pyodide) in a Web Worker. The main thread kills this worker after 8 s. */
/* eslint-disable no-undef */
let loading = null;

function init(base) {
  if (!loading) {
    importScripts(base + 'pyodide.js');
    loading = loadPyodide({ indexURL: base }).then((py) => {
      // input() would block forever waiting for stdin: make it fail fast instead.
      py.runPython(
        [
          'import builtins',
          'def _blocked_input(*args, **kwargs):',
          '    raise RuntimeError("input() is not available in tests. Use the function arguments instead.")',
          'builtins.input = _blocked_input',
        ].join('\n'),
      );
      return py;
    });
  }
  return loading;
}

const HARNESS = `
import sys, io, json, builtins
_ns = {"__name__": "__main__"}
_buf = io.StringIO()
_old = sys.stdout
sys.stdout = _buf
_err = None
_outs = []
try:
    exec(__rb_code, _ns)
    for _c in __rb_calls:
        try:
            _outs.append(repr(eval(_c, _ns)))
        except Exception as _ex:
            _outs.append(None)
            _err = f"{type(_ex).__name__}: {_ex}"
except Exception as _ex:
    _err = f"{type(_ex).__name__}: {_ex}"
finally:
    sys.stdout = _old
json.dumps({"stdout": _buf.getvalue()[-4000:], "outputs": _outs, "error": _err})
`;

self.onmessage = async (e) => {
  const { id, type, base, code, calls } = e.data;
  try {
    const py = await init(base);
    if (type === 'init') {
      self.postMessage({ id, ok: true });
      return;
    }
    py.globals.set('__rb_code', code);
    py.globals.set('__rb_calls', py.toPy(calls || []));
    const out = py.runPython(HARNESS);
    self.postMessage({ id, ok: true, result: JSON.parse(out) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
