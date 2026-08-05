// Pyodide (CPython -> WebAssembly) execution worker for the question page.
//
// Python runs entirely in the student's browser, so it needs no external code
// runner at all -- immune to a Wandbox/Piston outage, and instant (no network
// round-trip per run, which matters because the terminal re-runs the program on
// every entered input line).
//
// This MUST be a Worker, not the main thread: a student's `while True: pass`
// cannot be interrupted inside WebAssembly, so the only way to stop it is to
// terminate the whole worker. On the main thread that would freeze the exam page.
//
// Protocol
//   main -> worker : { code, stdin }
//   worker -> main : { ready: true }                       (once, after boot)
//                    { ok: true, stdout, stderr, exitCode }
//                    { ok: false, error }                  (boot/host failure)

/* global importScripts, loadPyodide */

const PYODIDE_VERSION = "0.26.4";
const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/";

let pyodidePromise = null;

function boot() {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    importScripts(PYODIDE_BASE + "pyodide.js");
    const pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
    // Define the runner once. Running the student's code inside a function that
    // swaps sys.stdin/stdout/stderr gives us real CPython semantics -- crucially
    // `input()` on an exhausted StringIO raises the genuine
    // "EOFError: EOF when reading a line", which is exactly the marker the
    // question page looks for to decide it should wait for another input line.
    pyodide.runPython(`
import sys, io, traceback

def __exam_run(user_code, stdin_data):
    old_in, old_out, old_err = sys.stdin, sys.stdout, sys.stderr
    sys.stdin = io.StringIO(stdin_data)
    out, err = io.StringIO(), io.StringIO()
    sys.stdout, sys.stderr = out, err
    exit_code = 0
    try:
        exec(compile(user_code, "main.py", "exec"), {"__name__": "__main__"})
    except SystemExit as e:
        exit_code = e.code if isinstance(e.code, int) else 0
    except BaseException as e:
        # Drop this wrapper's own frame so the traceback starts at the student's
        # first line, matching what a server-side runner would print.
        tb = e.__traceback__
        if tb is not None and tb.tb_next is not None:
            tb = tb.tb_next
        err.write("".join(traceback.format_exception(type(e), e, tb)))
        exit_code = 1
    finally:
        sys.stdin, sys.stdout, sys.stderr = old_in, old_out, old_err
    return [out.getvalue(), err.getvalue(), exit_code]
`);
    return pyodide;
  })();
  return pyodidePromise;
}

// Start loading immediately so the first Run is not stuck behind the download.
boot().then(
  () => self.postMessage({ ready: true }),
  (e) => self.postMessage({ ok: false, error: "Python runtime failed to load: " + String(e) }),
);

self.onmessage = async (ev) => {
  const { code, stdin } = ev.data || {};
  try {
    const pyodide = await boot();
    const res = pyodide.globals.get("__exam_run")(code || "", stdin || "");
    const arr = res.toJs();
    if (res.destroy) res.destroy();
    self.postMessage({ ok: true, stdout: arr[0], stderr: arr[1], exitCode: arr[2] });
  } catch (e) {
    self.postMessage({ ok: false, error: String((e && e.message) || e) });
  }
};
