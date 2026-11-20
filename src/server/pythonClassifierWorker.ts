import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

export interface PythonWorkerResponse<T = unknown> {
  id: string;
  ok: boolean;
  data?: T;
  error?: string;
}

export class OfflineClassifierError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'OfflineClassifierError';
    this.status = status;
  }
}

export function resolvePythonExecutable(): string {
  const envPython = (process.env.HUMAN_CLASSIFIER_PYTHON || '').trim();
  if (envPython && fs.existsSync(/*turbopackIgnore: true*/ envPython)) {
    return envPython;
  }

  const rootDir = process.cwd();
  const venvParts: string[][] = [
    ['.venv', 'bin', 'python'],
    ['.venv', 'Scripts', 'python.exe'],
    ['venv', 'bin', 'python'],
  ];
  for (const parts of venvParts) {
    const candidate = path.resolve(/*turbopackIgnore: true*/ rootDir, ...parts);
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
      return candidate;
    }
  }
  return 'python3';
}

export function resolveClassifierScriptPath(): string {
  const rootDir = process.cwd();
  return path.resolve(/*turbopackIgnore: true*/ rootDir, 'python', 'human_classifier.py');
}

interface PendingJob {
  id: string;
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

class PythonClassifierWorkerManager {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private pending: PendingJob | null = null;
  private stderrTail: string[] = [];
  private tailPromise: Promise<void> = Promise.resolve();
  private reqCounter = 0;

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
      return this.proc;
    }

    const pythonBin = resolvePythonExecutable();
    const scriptPath = resolveClassifierScriptPath();
    if (!fs.existsSync(scriptPath)) {
      throw new OfflineClassifierError(
        `Offline Python classifier script not found at ${scriptPath}.`,
        500
      );
    }

    const child = spawn(pythonBin, [scriptPath, '--worker'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || '2',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.stderrTail = [];
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        this.stderrTail.push(text);
        if (this.stderrTail.length > 20) this.stderrTail.shift();
      }
    });

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) return;
      const active = this.pending;
      if (!active) return;

      try {
        const parsed = JSON.parse(trimmed) as PythonWorkerResponse;
        if (parsed.id && parsed.id !== active.id) return;
        this.pending = null;
        clearTimeout(active.timer);
        if (parsed.ok) {
          active.resolve(parsed.data);
        } else {
          active.reject(
            new OfflineClassifierError(
              parsed.error || 'Offline Python AI worker returned an error.',
              500
            )
          );
        }
      } catch {
        // Ignore non-JSON diagnostic stdout from native C++ libraries
      }
    });

    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      const active = this.pending;
      if (active) {
        this.pending = null;
        clearTimeout(active.timer);
        const detail = this.stderrTail.slice(-4).join(' | ');
        active.reject(
          new OfflineClassifierError(
            `Offline Python AI worker exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})${detail ? `: ${detail}` : ''}`,
            500
          )
        );
      }
      this.cleanup();
    };

    child.on('error', (err) => {
      const active = this.pending;
      if (active) {
        this.pending = null;
        clearTimeout(active.timer);
        active.reject(
          new OfflineClassifierError(
            `Failed to launch offline Python AI runtime (${pythonBin}): ${err.message}`,
            500
          )
        );
      }
      this.cleanup();
    });

    child.on('exit', handleExit);

    this.proc = child;
    this.rl = rl;
    return child;
  }

  private cleanup() {
    try {
      this.rl?.close();
    } catch {
      // ignore
    }
    this.rl = null;
    this.proc = null;
  }

  public runCommand<T = any>(
    cmd: 'analyze-batch' | 'cluster' | 'ping',
    payload: Record<string, unknown>,
    timeoutMs = 180_000
  ): Promise<T> {
    const job = this.tailPromise.then(
      () =>
        new Promise<T>((resolve, reject) => {
          let proc: ChildProcessWithoutNullStreams;
          try {
            proc = this.ensureProcess();
          } catch (err) {
            reject(err);
            return;
          }

          const id = `py_${++this.reqCounter}`;
          const timer = setTimeout(() => {
            if (this.pending?.id === id) {
              this.pending = null;
              try {
                proc.kill('SIGKILL');
              } catch {
                // ignore
              }
              this.cleanup();
              reject(
                new OfflineClassifierError(
                  `Offline Python AI worker timed out after ${Math.round(timeoutMs / 1000)}s.`,
                  504
                )
              );
            }
          }, timeoutMs);

          this.pending = { id, resolve, reject, timer };
          try {
            proc.stdin.write(`${JSON.stringify({ id, cmd, payload })}\n`);
          } catch (err: any) {
            this.pending = null;
            clearTimeout(timer);
            reject(
              new OfflineClassifierError(
                `Failed writing request to offline Python AI worker: ${err?.message || 'stdin error'}`,
                500
              )
            );
          }
        })
    );

    this.tailPromise = job.then(
      () => undefined,
      () => undefined
    );
    return job;
  }

  public shutdown() {
    try {
      this.proc?.kill('SIGTERM');
    } catch {
      // ignore
    }
    this.cleanup();
  }
}

const globalWorkerKey = '__fullres_python_classifier_worker__';
const globalScope = globalThis as typeof globalThis & {
  [globalWorkerKey]?: PythonClassifierWorkerManager;
};

export function getPythonClassifierWorker(): PythonClassifierWorkerManager {
  if (!globalScope[globalWorkerKey]) {
    globalScope[globalWorkerKey] = new PythonClassifierWorkerManager();
  }
  return globalScope[globalWorkerKey];
}
