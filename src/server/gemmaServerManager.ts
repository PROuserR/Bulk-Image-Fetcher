import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface GemmaRuntimeStatus {
  engine: 'gemma-4-e2b-local';
  modelName: string;
  status: 'ready' | 'starting' | 'stopped' | 'missing_assets';
  serverUrl: string;
  binaryPresent: boolean;
  modelPresent: boolean;
  mmprojPresent: boolean;
  modelPath: string;
  mmprojPath: string;
  lastError?: string;
}

export class GemmaRuntimeError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'GemmaRuntimeError';
    this.status = status;
  }
}

function findFirstExistingFile(candidates: string[], minBytes: number): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
        const stat = fs.statSync(/*turbopackIgnore: true*/ candidate);
        if (stat.isFile() && stat.size >= minBytes) {
          return candidate;
        }
      }
    } catch {
      // ignore stat errors
    }
  }
  return null;
}

export function resolveGemmaPaths() {
  const rootDir = process.cwd();
  const optBase = '/opt/gemma4';
  const localBase = path.resolve(/*turbopackIgnore: true*/ rootDir, 'models', 'gemma4');

  const envBin = (process.env.GEMMA_LLAMA_SERVER_BIN || '').trim();
  const binCandidates = [
    ...(envBin ? [path.resolve(/*turbopackIgnore: true*/ envBin)] : []),
    path.resolve(/*turbopackIgnore: true*/ optBase, 'bin', 'llama-server'),
    path.resolve(/*turbopackIgnore: true*/ localBase, 'bin', 'llama-server'),
  ];
  const binPath = findFirstExistingFile(binCandidates, 4096) || binCandidates[0];
  const binDir = path.dirname(/*turbopackIgnore: true*/ binPath);

  const envModel = (process.env.GEMMA_MODEL_PATH || '').trim();
  const modelCandidates = [
    ...(envModel ? [path.resolve(/*turbopackIgnore: true*/ envModel)] : []),
    path.resolve(/*turbopackIgnore: true*/ optBase, 'gemma-4-E2B-it-UD-IQ2_M.gguf'),
    path.resolve(/*turbopackIgnore: true*/ optBase, 'gemma-4-E2B-it-Q4_K_M.gguf'),
    path.resolve(/*turbopackIgnore: true*/ localBase, 'gemma-4-E2B-it-UD-IQ2_M.gguf'),
    path.resolve(/*turbopackIgnore: true*/ localBase, 'gemma-4-E2B-it-Q4_K_M.gguf'),
  ];
  const modelPath = findFirstExistingFile(modelCandidates, 100 * 1024 * 1024) || modelCandidates[0];

  const envMmproj = (process.env.GEMMA_MMPROJ_PATH || '').trim();
  const mmprojCandidates = [
    ...(envMmproj ? [path.resolve(/*turbopackIgnore: true*/ envMmproj)] : []),
    path.resolve(/*turbopackIgnore: true*/ optBase, 'mmproj-Q8_0.gguf'),
    path.resolve(/*turbopackIgnore: true*/ optBase, 'mmproj-F16.gguf'),
    path.resolve(/*turbopackIgnore: true*/ localBase, 'mmproj-Q8_0.gguf'),
    path.resolve(/*turbopackIgnore: true*/ localBase, 'mmproj-F16.gguf'),
  ];
  const mmprojPath = findFirstExistingFile(mmprojCandidates, 10 * 1024 * 1024) || mmprojCandidates[0];

  const port = Math.max(
    1024,
    Math.min(65535, Number(process.env.GEMMA_LLAMA_PORT || 8089) || 8089)
  );
  const externalUrl = (process.env.GEMMA_SERVER_URL || '').trim().replace(/\/+$/, '');
  const serverUrl = externalUrl || `http://127.0.0.1:${port}`;

  return {
    optBase,
    localBase,
    binDir,
    binPath,
    modelPath,
    mmprojPath,
    port,
    serverUrl,
    isExternal: Boolean(externalUrl),
  };
}

function isNonEmptyFile(filePath: string, minBytes = 1024): boolean {
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) return false;
    const stat = fs.statSync(/*turbopackIgnore: true*/ filePath);
    return stat.isFile() && stat.size >= minBytes;
  } catch {
    return false;
  }
}

function ensureExecutablePermissions(binDir: string, binPath: string) {
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ binPath)) {
      fs.chmodSync(/*turbopackIgnore: true*/ binPath, 0o755);
    }
    if (fs.existsSync(/*turbopackIgnore: true*/ binDir)) {
      const entries = fs.readdirSync(/*turbopackIgnore: true*/ binDir);
      for (const entry of entries) {
        if (entry.startsWith('llama-') || entry.endsWith('.so') || entry.includes('.so.')) {
          const target = path.join(/*turbopackIgnore: true*/ binDir, entry);
          try {
            fs.chmodSync(/*turbopackIgnore: true*/ target, 0o755);
          } catch {
            // ignore non-regular or read-only entries
          }
        }
      }
    }
  } catch {
    // ignore permission adjustment failures
  }
}

async function checkServerHealth(serverUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(`${serverUrl}/health`, {
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    });
    if (!resp.ok) return false;
    const data = (await resp.json().catch(() => ({}))) as { status?: string };
    return data.status === 'ok';
  } catch {
    return false;
  }
}

class GemmaServerManager {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<string> | null = null;
  private stderrTail: string[] = [];
  private lastError: string | undefined;

  public async getStatus(): Promise<GemmaRuntimeStatus> {
    const paths = resolveGemmaPaths();
    const binaryPresent = paths.isExternal || isNonEmptyFile(paths.binPath, 4096);
    const modelPresent = paths.isExternal || isNonEmptyFile(paths.modelPath, 100 * 1024 * 1024);
    const mmprojPresent = paths.isExternal || isNonEmptyFile(paths.mmprojPath, 10 * 1024 * 1024);

    const modelName = paths.modelPath.includes('Q4_K_M')
      ? 'Gemma 4 E2B (Open-Source Q4_K_M + Vision)'
      : 'Gemma 4 E2B (Open-Source UD-IQ2_M + Vision Q8_0)';

    if (!paths.isExternal && (!binaryPresent || !modelPresent || !mmprojPresent)) {
      return {
        engine: 'gemma-4-e2b-local',
        modelName,
        status: 'missing_assets',
        serverUrl: paths.serverUrl,
        binaryPresent,
        modelPresent,
        mmprojPresent,
        modelPath: paths.modelPath,
        mmprojPath: paths.mmprojPath,
        lastError: this.lastError,
      };
    }

    const healthy = await checkServerHealth(paths.serverUrl);
    if (healthy) {
      return {
        engine: 'gemma-4-e2b-local',
        modelName,
        status: 'ready',
        serverUrl: paths.serverUrl,
        binaryPresent,
        modelPresent,
        mmprojPresent,
        modelPath: paths.modelPath,
        mmprojPath: paths.mmprojPath,
      };
    }

    return {
      engine: 'gemma-4-e2b-local',
      modelName,
      status:
        this.startPromise || (this.proc && this.proc.exitCode === null)
          ? 'starting'
          : 'stopped',
      serverUrl: paths.serverUrl,
      binaryPresent,
      modelPresent,
      mmprojPresent,
      modelPath: paths.modelPath,
      mmprojPath: paths.mmprojPath,
      lastError: this.lastError,
    };
  }

  private async ensureAssetsDownloaded(paths: ReturnType<typeof resolveGemmaPaths>) {
    if (paths.isExternal) return;
    const targetDir = paths.optBase;
    const binDir = path.join(/*turbopackIgnore: true*/ targetDir, 'bin');
    const targetBin = path.join(/*turbopackIgnore: true*/ binDir, 'llama-server');
    const targetModel = path.join(/*turbopackIgnore: true*/ targetDir, 'gemma-4-E2B-it-UD-IQ2_M.gguf');
    const targetMmproj = path.join(/*turbopackIgnore: true*/ targetDir, 'mmproj-Q8_0.gguf');

    const hasBin = isNonEmptyFile(paths.binPath, 4096) || isNonEmptyFile(targetBin, 4096);
    const hasModel =
      isNonEmptyFile(paths.modelPath, 100 * 1024 * 1024) ||
      isNonEmptyFile(targetModel, 100 * 1024 * 1024);
    const hasMmproj =
      isNonEmptyFile(paths.mmprojPath, 10 * 1024 * 1024) ||
      isNonEmptyFile(targetMmproj, 10 * 1024 * 1024);

    if (hasBin && hasModel && hasMmproj) return;

    fs.mkdirSync(/*turbopackIgnore: true*/ binDir, { recursive: true });
    const runShell = (cmd: string) =>
      new Promise<void>((resolve, reject) => {
        const proc = spawn('bash', ['-lc', cmd], {
          cwd: process.cwd(),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        proc.stderr.on('data', (c: Buffer) => {
          stderr = (stderr + c.toString('utf8')).slice(-800);
        });
        proc.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new GemmaRuntimeError(`Gemma 4 asset setup failed: ${stderr || `exit ${code}`}`, 500));
        });
        proc.on('error', (e) => reject(e));
      });

    if (!hasBin) {
      await runShell(
        `curl -fsSL "https://github.com/ggml-org/llama.cpp/releases/download/b12482/llama-b12482-bin-ubuntu-x64.tar.gz" -o /tmp/llama-gemma4.tgz && tar -xzf /tmp/llama-gemma4.tgz -C "${binDir}" --strip-components=1 && rm -f /tmp/llama-gemma4.tgz && chmod +x "${binDir}"/*`
      );
    }
    if (!hasMmproj) {
      await runShell(
        `curl -fsSL "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/mmproj-gemma-4-E2B-it-Q8_0.gguf" -o "${targetMmproj}"`
      );
    }
    if (!hasModel) {
      await runShell(
        `curl -fsSL "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-UD-IQ2_M.gguf" -o "${targetModel}"`
      );
    }
  }

  public async ensureReady(): Promise<string> {
    let paths = resolveGemmaPaths();
    if (await checkServerHealth(paths.serverUrl)) {
      this.lastError = undefined;
      return paths.serverUrl;
    }

    if (paths.isExternal) {
      throw new GemmaRuntimeError(
        `Configured Gemma 4 server at ${paths.serverUrl} is not reachable.`,
        503
      );
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      await this.ensureAssetsDownloaded(paths);
      paths = resolveGemmaPaths();
      if (!isNonEmptyFile(paths.binPath, 4096)) {
        throw new GemmaRuntimeError(`Local llama-server binary missing at ${paths.binPath}.`, 500);
      }
      if (!isNonEmptyFile(paths.modelPath, 100 * 1024 * 1024)) {
        throw new GemmaRuntimeError(`Gemma 4 E2B GGUF weights not ready yet at ${paths.modelPath}.`, 503);
      }
      if (!isNonEmptyFile(paths.mmprojPath, 10 * 1024 * 1024)) {
        throw new GemmaRuntimeError(`Gemma 4 vision projector (mmproj) not ready yet at ${paths.mmprojPath}.`, 503);
      }
      return this.launchAndWait(paths);
    })()
      .catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
        throw err;
      })
      .finally(() => {
        this.startPromise = null;
      });

    return this.startPromise;
  }

  private async launchAndWait(paths: ReturnType<typeof resolveGemmaPaths>): Promise<string> {
    ensureExecutablePermissions(paths.binDir, paths.binPath);

    if (!this.proc || this.proc.killed || this.proc.exitCode !== null) {
      const threads = String(Math.max(1, Math.min(4, Number(process.env.GEMMA_THREADS || 3) || 3)));
      const ctxSize = String(Math.max(2048, Number(process.env.GEMMA_CTX_SIZE || 4096) || 4096));

      this.stderrTail = [];
      this.lastError = undefined;

      const child = spawn(
        paths.binPath,
        [
          '-m',
          paths.modelPath,
          '--mmproj',
          paths.mmprojPath,
          '--host',
          '127.0.0.1',
          '--port',
          String(paths.port),
          '--threads',
          threads,
          '-c',
          ctxSize,
          '--parallel',
          '1',
          '--no-webui',
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            LD_LIBRARY_PATH: `${paths.binDir}:${process.env.LD_LIBRARY_PATH || ''}`,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      const pushLog = (chunk: Buffer) => {
        const text = chunk.toString('utf8').trim();
        if (!text) return;
        this.stderrTail.push(text);
        if (this.stderrTail.length > 25) this.stderrTail.shift();
      };

      child.stdout.on('data', pushLog);
      child.stderr.on('data', pushLog);

      child.on('exit', (code, signal) => {
        if (this.proc === child) {
          this.proc = null;
        }
        if (code !== 0 && code !== null) {
          this.lastError = `llama-server exited (code=${code}, signal=${signal ?? 'none'}): ${this.stderrTail.slice(-3).join(' | ')}`;
        }
      });

      child.on('error', (err) => {
        this.lastError = `Failed spawning llama-server: ${err.message}`;
        if (this.proc === child) {
          this.proc = null;
        }
      });

      this.proc = child;
    }

    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (await checkServerHealth(paths.serverUrl)) {
        this.lastError = undefined;
        return paths.serverUrl;
      }
      if (!this.proc || this.proc.exitCode !== null) {
        const detail = this.stderrTail.slice(-4).join(' | ');
        throw new GemmaRuntimeError(
          `Local Gemma 4 inference server stopped during startup${detail ? `: ${detail}` : ''}`,
          500
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    throw new GemmaRuntimeError(
      'Local Gemma 4 inference server timed out waiting to become ready.',
      504
    );
  }

  public shutdown() {
    try {
      this.proc?.kill('SIGTERM');
    } catch {
      // ignore
    }
    this.proc = null;
  }
}

const globalGemmaKey = '__fullres_gemma4_server_manager__';
const globalScope = globalThis as typeof globalThis & {
  [globalGemmaKey]?: GemmaServerManager;
};

export function getGemmaServerManager(): GemmaServerManager {
  if (!globalScope[globalGemmaKey]) {
    globalScope[globalGemmaKey] = new GemmaServerManager();
  }
  return globalScope[globalGemmaKey];
}
