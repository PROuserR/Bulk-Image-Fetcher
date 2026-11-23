import { buildDownloadFileUrl, triggerBlobDownload } from './downloader';
import {
  dedupeImageBlobFetch,
  getCachedImageBlob,
  getFullResReusablePreviewUrl,
} from './clientImageCache';

export interface DownloadItemInput {
  id: string;
  url: string;
  filename: string;
  fallbackUrl?: string;
  linkedPageUrl?: string;
  referer?: string;
  relayUrl?: string;
}

export type DownloadItemStatus = 'pending' | 'downloading' | 'saved' | 'failed';

export interface FailedDownloadItem {
  id: string;
  filename: string;
  url: string;
  reason: string;
}

export interface ItemProgressEntry {
  status: DownloadItemStatus;
  bytes?: number;
  error?: string;
  resolvedVia?: string;
}

export interface ProgressiveDownloadProgress {
  total: number;
  completed: number;
  saved: number;
  failed: number;
  activeCount: number;
  percent: number;
  bytesSaved: number;
  currentItems: string[];
  isRunning: boolean;
  isPaused: boolean;
  isCancelled: boolean;
  savedItemIds: string[];
  failedItems: FailedDownloadItem[];
  itemStatuses: Record<string, ItemProgressEntry>;
}

export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Pick<Response, 'ok' | 'status' | 'headers' | 'blob'>>;

export type SaveBlobLike = (blob: Blob, filename: string) => Promise<void> | void;

export interface ProgressiveResumeState {
  savedItemIds?: string[];
  bytesSaved?: number;
  itemStatuses?: Record<string, ItemProgressEntry>;
}

export interface ProgressiveDownloadOptions {
  concurrency?: number;
  staggerMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  initialProgress?: ProgressiveResumeState;
  fetchFn?: FetchLike;
  saveBlobFn?: SaveBlobLike;
  onProgress?: (progress: ProgressiveDownloadProgress) => void;
}

function sanitizeClientFilename(rawName: string, fallbackIdx: number): string {
  const cleaned = (rawName || `image_${fallbackIdx + 1}.jpg`)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  if (!cleaned) return `image_${fallbackIdx + 1}.jpg`;
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.jpg`;
}

export function dedupeDownloadItems(items: DownloadItemInput[]): DownloadItemInput[] {
  const seen = new Set<string>();
  return items.map((item, idx) => {
    const baseName = sanitizeClientFilename(item.filename, idx);
    const lastDot = baseName.lastIndexOf('.');
    const ext = lastDot !== -1 ? baseName.slice(lastDot) : '.jpg';
    const stem = lastDot !== -1 ? baseName.slice(0, lastDot) : baseName;

    let unique = baseName;
    let counter = 1;
    while (seen.has(unique.toLowerCase())) {
      unique = `${stem}_${counter}${ext}`;
      counter++;
    }
    seen.add(unique.toLowerCase());
    return { ...item, filename: unique };
  });
}

async function fetchValidBlobWithTimeout(
  fetchFn: FetchLike,
  targetUrl: string,
  init: RequestInit,
  timeoutMs: number,
  outerSignal?: AbortSignal
): Promise<{ blob: Blob | null; status?: number; reason?: string }> {
  if (outerSignal?.aborted) {
    return { blob: null, reason: 'Cancelled' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
  const onOuterAbort = () => controller.abort(outerSignal?.reason);
  if (outerSignal) {
    outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const resp = await fetchFn(targetUrl, { ...init, signal: controller.signal });
    if (!resp.ok) {
      return { blob: null, status: resp.status, reason: `HTTP ${resp.status}` };
    }
    const contentType = (resp.headers?.get?.('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      return { blob: null, status: resp.status, reason: `Unexpected ${contentType} response` };
    }
    const blob = await resp.blob();
    if (!blob || blob.size === 0) {
      return { blob: null, status: resp.status, reason: 'Empty file received' };
    }
    return { blob, status: resp.status };
  } catch (err: any) {
    if (outerSignal?.aborted) {
      return { blob: null, reason: 'Cancelled' };
    }
    return { blob: null, reason: err?.message || 'Network fetch failed' };
  } finally {
    clearTimeout(timer);
    if (outerSignal) {
      outerSignal.removeEventListener('abort', onOuterAbort);
    }
  }
}

export async function fetchImageBlobWithFallbacks(
  item: DownloadItemInput,
  options: {
    fetchFn?: FetchLike;
    timeoutMs?: number;
    signal?: AbortSignal;
    useCache?: boolean;
  } = {}
): Promise<{ blob: Blob | null; resolvedVia?: string; error?: string }> {
  const fetchFn: FetchLike = options.fetchFn || (fetch as unknown as FetchLike);
  const timeoutMs = options.timeoutMs ?? 12000;
  const signal = options.signal;
  const shouldUseCache = options.useCache !== undefined ? options.useCache : !options.fetchFn;

  if (shouldUseCache && item.url) {
    const cachedBlob = getCachedImageBlob(item.url);
    if (cachedBlob) {
      return { blob: cachedBlob, resolvedVia: 'memory-cache' };
    }
  }

  let resolvedViaResult: string | undefined;
  let lastError: string | undefined;

  const executeFetch = async (): Promise<Blob | null> => {
    if (shouldUseCache && item.url) {
      const cachedPreviewUrl = getFullResReusablePreviewUrl(item.url);
      if (cachedPreviewUrl) {
        const cacheInit: RequestInit = cachedPreviewUrl.startsWith('/api/')
          ? { cache: 'force-cache' }
          : { mode: 'cors', cache: 'force-cache' };
        const cacheAttempt = await fetchValidBlobWithTimeout(
          fetchFn,
          cachedPreviewUrl,
          cacheInit,
          Math.min(timeoutMs, 6000),
          signal
        );
        if (cacheAttempt.blob) {
          resolvedViaResult = 'preview-http-cache';
          return cacheAttempt.blob;
        }
        if (signal?.aborted) {
          lastError = 'Cancelled';
          return null;
        }
      }
    }

    const proxyUrl = buildDownloadFileUrl(item.url, item.filename, item.referer, {
      fallbackUrl: item.fallbackUrl,
      linkedPageUrl: item.linkedPageUrl,
      relayUrl: item.relayUrl,
    });

    // Attempt 1: Same-origin /api/download-file proxy (handles Referer, linkedPageUrl, fallbackUrl, relayUrl)
    const proxyAttempt = await fetchValidBlobWithTimeout(fetchFn, proxyUrl, {}, timeoutMs, signal);
    if (proxyAttempt.blob) {
      resolvedViaResult = 'proxy';
      return proxyAttempt.blob;
    }
    if (signal?.aborted) {
      lastError = 'Cancelled';
      return null;
    }

    // Attempt 2: Direct browser CORS fetch (bypasses server IP blocks / rate limits when host supports CORS)
    if (item.url && /^https?:\/\//i.test(item.url)) {
      const directAttempt = await fetchValidBlobWithTimeout(
        fetchFn,
        item.url,
        { mode: 'cors' },
        Math.min(timeoutMs, 10000),
        signal
      );
      if (directAttempt.blob) {
        resolvedViaResult = 'direct-cors';
        return directAttempt.blob;
      }
      if (signal?.aborted) {
        lastError = 'Cancelled';
        return null;
      }
    }

    // Attempt 3: Fallback URL direct CORS fetch
    if (item.fallbackUrl && item.fallbackUrl !== item.url && /^https?:\/\//i.test(item.fallbackUrl)) {
      const fallbackAttempt = await fetchValidBlobWithTimeout(
        fetchFn,
        item.fallbackUrl,
        { mode: 'cors' },
        Math.min(timeoutMs, 10000),
        signal
      );
      if (fallbackAttempt.blob) {
        resolvedViaResult = 'fallback-cors';
        return fallbackAttempt.blob;
      }
    }

    lastError = proxyAttempt.reason || 'Remote host blocked or timed out';
    return null;
  };

  const blob =
    shouldUseCache && item.url && !signal
      ? await dedupeImageBlobFetch(item.url, executeFetch)
      : await executeFetch();

  if (blob) {
    if (shouldUseCache && item.url && resolvedViaResult !== 'memory-cache') {
      // dedupeImageBlobFetch already caches when !signal; ensure cached when signal was passed
      if (signal) {
        const { setCachedImageBlob } = await import('./clientImageCache');
        setCachedImageBlob(item.url, blob);
      }
    }
    return { blob, resolvedVia: resolvedViaResult || 'cache' };
  }

  return {
    blob: null,
    error: lastError || 'Remote host blocked or timed out',
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export async function runProgressiveDownloads(
  rawItems: DownloadItemInput[],
  options: ProgressiveDownloadOptions = {}
): Promise<ProgressiveDownloadProgress> {
  const items = dedupeDownloadItems(rawItems);
  const total = items.length;
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
  const staggerMs = Math.max(0, options.staggerMs ?? 120);
  const timeoutMs = options.timeoutMs ?? 12000;
  const signal = options.signal;
  const fetchFn: FetchLike = options.fetchFn || (fetch as unknown as FetchLike);
  const saveBlobFn: SaveBlobLike =
    options.saveBlobFn || ((blob, filename) => triggerBlobDownload(blob, filename));

  const alreadySavedSet = new Set<string>(options.initialProgress?.savedItemIds || []);
  const itemStatuses: Record<string, ItemProgressEntry> = {};
  const pendingItems: DownloadItemInput[] = [];
  let saved = 0;

  for (const item of items) {
    if (alreadySavedSet.has(item.id)) {
      const prior = options.initialProgress?.itemStatuses?.[item.id];
      itemStatuses[item.id] = prior?.status === 'saved' ? prior : { status: 'saved' };
      saved++;
    } else {
      itemStatuses[item.id] = { status: 'pending' };
      pendingItems.push(item);
    }
  }

  const activeSet = new Set<string>();
  const failedItems: FailedDownloadItem[] = [];
  const savedItemIdsSet = new Set<string>(
    items.filter((it) => alreadySavedSet.has(it.id)).map((it) => it.id)
  );
  let failed = 0;
  let bytesSaved = options.initialProgress?.bytesSaved ?? 0;

  const isPausedSignal = () => Boolean(signal?.aborted && signal.reason === 'PAUSED');
  const isCancelledSignal = () => Boolean(signal?.aborted && signal.reason !== 'PAUSED');

  const buildSnapshot = (isRunning: boolean): ProgressiveDownloadProgress => {
    const completed = saved + failed;
    const percent = total === 0 ? 100 : Math.round((completed / total) * 100);
    return {
      total,
      completed,
      saved,
      failed,
      activeCount: activeSet.size,
      percent,
      bytesSaved,
      currentItems: Array.from(activeSet),
      isRunning,
      isPaused: !isRunning && isPausedSignal(),
      isCancelled: !isRunning && isCancelledSignal(),
      savedItemIds: Array.from(savedItemIdsSet),
      failedItems: [...failedItems],
      itemStatuses: { ...itemStatuses },
    };
  };

  const emit = (isRunning: boolean) => {
    options.onProgress?.(buildSnapshot(isRunning));
  };

  if (total === 0 || pendingItems.length === 0) {
    const emptySnapshot = buildSnapshot(false);
    options.onProgress?.(emptySnapshot);
    return emptySnapshot;
  }

  emit(true);

  // Serialize disk-save triggers with a small stagger so browsers queue every file cleanly
  // while the concurrent fetch pool continues fetching ahead without blocking.
  let saveChain: Promise<void> = Promise.resolve();
  let savedTriggers = 0;

  const enqueueDiskSave = (blob: Blob, filename: string): Promise<void> => {
    const nextTask = saveChain.then(async () => {
      if (signal?.aborted) return;
      if (savedTriggers > 0 && staggerMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, staggerMs));
      }
      if (signal?.aborted) return;
      await saveBlobFn(blob, filename);
      savedTriggers++;
    });
    saveChain = nextTask.catch(() => {});
    return nextTask;
  };

  let cursor = 0;

  const worker = async () => {
    while (true) {
      if (signal?.aborted) return;
      const myIndex = cursor++;
      if (myIndex >= pendingItems.length) return;

      const item = pendingItems[myIndex];
      itemStatuses[item.id] = { status: 'downloading' };
      activeSet.add(item.filename);
      emit(true);

      const { blob, resolvedVia, error } = await fetchImageBlobWithFallbacks(item, {
        fetchFn,
        timeoutMs,
        signal,
      });

      activeSet.delete(item.filename);

      if (signal?.aborted) {
        // When paused, leave unfinished items as 'pending' so resuming picks them up seamlessly
        itemStatuses[item.id] = isPausedSignal()
          ? { status: 'pending' }
          : { status: 'failed', error: 'Cancelled' };
        if (isPausedSignal()) {
          // Wait for outer termination to emit final paused snapshot
        } else {
          emit(true);
        }
        return;
      }

      if (blob && blob.size > 0) {
        try {
          await enqueueDiskSave(blob, item.filename);
          if (signal?.aborted) {
            itemStatuses[item.id] = isPausedSignal()
              ? { status: 'pending' }
              : { status: 'failed', error: 'Cancelled' };
            return;
          }
          saved++;
          bytesSaved += blob.size;
          savedItemIdsSet.add(item.id);
          itemStatuses[item.id] = {
            status: 'saved',
            bytes: blob.size,
            resolvedVia,
          };
        } catch (saveErr: any) {
          failed++;
          const reason = saveErr?.message || 'Browser refused file save';
          itemStatuses[item.id] = { status: 'failed', error: reason };
          failedItems.push({
            id: item.id,
            filename: item.filename,
            url: item.url,
            reason,
          });
        }
      } else {
        failed++;
        const reason = error || 'Download failed';
        itemStatuses[item.id] = { status: 'failed', error: reason };
        failedItems.push({
          id: item.id,
          filename: item.filename,
          url: item.url,
          reason,
        });
      }

      emit(true);
    }
  };

  const workerCount = Math.min(concurrency, pendingItems.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  await saveChain;

  const finalSnapshot = buildSnapshot(false);
  options.onProgress?.(finalSnapshot);
  return finalSnapshot;
}
