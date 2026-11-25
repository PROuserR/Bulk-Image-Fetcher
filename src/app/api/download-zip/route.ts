import { NextRequest, NextResponse } from 'next/server';
import pLimit from 'p-limit';
import { extractBestImageFromDetailPage } from '@/utils/htmlExtractor';
import { unshrinkImageUrl, isLowResUrl } from '@/utils/scraperLogic';
import {
  sanitizeDownloadFilename,
  ensureUniqueFilename,
  resolveImageBufferWithFallbacks,
  fetchDetailPageHtmlSmart,
} from '@/server/fetchHelpers';
import {
  buildCompressedArchive,
  saveStagedArchive,
  consumeStagedArchive,
  readStagedArchive,
  deleteStagedArchive,
  ArchiveEntry,
} from '@/server/archiveBuilder';
import { sanitizeGalleryFolderName } from '@/utils/nestedGalleryLogic';
import {
  buildArchiveFilename,
  buildContentDispositionHeader,
  normalizeArchiveFormat,
} from '@/utils/downloader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ZipImageInput {
  url: string;
  fallbackUrl?: string;
  linkedPageUrl?: string;
  filename?: string;
  galleryTitle?: string;
  galleryId?: string;
  onlyFullRes?: boolean;
}

/**
 * GET /api/download-zip?token=...
 * Streams a previously staged `.7z` or `.zip` archive with HTTP `Range` (`206 Partial Content`)
 * support for resumable client transfers. Deletes immediately on completion unless `resumable=1`.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  if (!token) {
    return NextResponse.json({ error: 'Missing download token' }, { status: 400 });
  }

  const rangeHeader = req.headers.get('range');
  const keepResumable = req.nextUrl.searchParams.get('resumable') === '1' || Boolean(rangeHeader);

  const staged = keepResumable
    ? await readStagedArchive(token)
    : await consumeStagedArchive(token);

  if (!staged) {
    return NextResponse.json(
      { error: 'Archive download token expired or not found' },
      { status: 404 }
    );
  }

  const { buffer, meta } = staged;
  const totalBytes = buffer.length;

  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/i.exec(rangeHeader.trim());
    if (match) {
      const start = parseInt(match[1], 10);
      const requestedEnd = match[2] ? parseInt(match[2], 10) : totalBytes - 1;
      const end = Math.min(totalBytes - 1, requestedEnd);

      if (Number.isNaN(start) || start < 0 || start >= totalBytes || end < start) {
        return new Response(null, {
          status: 416,
          headers: {
            'Content-Range': `bytes */${totalBytes}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }

      const slice = buffer.subarray(start, end + 1);
      return new Response(new Uint8Array(slice), {
        status: 206,
        headers: {
          'Content-Type': meta.contentType,
          'Content-Length': slice.length.toString(),
          'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
          'Accept-Ranges': 'bytes',
          'Content-Disposition': buildContentDispositionHeader(meta.filename),
          'X-Archive-Format': meta.format,
          'X-Archive-Count': meta.fileCount.toString(),
          'Cache-Control': 'no-store',
        },
      });
    }
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': meta.contentType,
      'Content-Length': totalBytes.toString(),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': buildContentDispositionHeader(meta.filename),
      'X-Archive-Format': meta.format,
      'X-Archive-Count': meta.fileCount.toString(),
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * DELETE /api/download-zip?token=...
 * Removes a staged archive binary and metadata file from temporary disk storage.
 */
export async function DELETE(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  if (!token) {
    return NextResponse.json({ error: 'Missing download token' }, { status: 400 });
  }
  await deleteStagedArchive(token);
  return NextResponse.json({ deleted: true });
}

/**
 * POST /api/download-zip
 * Resolves full-resolution image buffers, packages them as LZMA2 `.7z` or `.zip`,
 * and either returns the binary directly or streams NDJSON stage progress (`streamProgress: true`)
 * ending with a staged download token.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      images,
      referer,
      relayUrl,
      archiveName,
      onlyFullRes: globalOnlyFullRes,
      format: requestedFormat,
      streamProgress,
    } = body || {};

    if (!Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: 'No images provided for archive packaging' }, { status: 400 });
    }

    const archiveFormat = normalizeArchiveFormat(requestedFormat);
    const archiveFilename = buildArchiveFilename(
      typeof archiveName === 'string' ? archiveName : undefined,
      typeof referer === 'string' ? referer : undefined,
      archiveFormat
    );

    const cleanRelayUrl = typeof relayUrl === 'string' ? relayUrl.trim() : '';
    const seenByFolder = new Map<string, Set<string>>();

    // Assign deterministic collision-free archive paths before concurrent fetching
    const plannedTasks = (images as ZipImageInput[]).map((item, idx) => {
      const onlyFullRes = item.onlyFullRes ?? globalOnlyFullRes ?? true;
      const rawUrl = item.url || item.linkedPageUrl;
      const rawName = sanitizeDownloadFilename(item.filename || `image_${idx + 1}.jpg`, rawUrl);
      const folderKey = item.galleryTitle
        ? sanitizeGalleryFolderName(item.galleryTitle, item.galleryId || 'gallery')
        : '';
      let folderSeen = seenByFolder.get(folderKey);
      if (!folderSeen) {
        folderSeen = new Set<string>();
        seenByFolder.set(folderKey, folderSeen);
      }
      const uniqueFile = ensureUniqueFilename(rawName, folderSeen);
      const uniqueName = folderKey ? `${folderKey}/${uniqueFile}` : uniqueFile;
      return { item, onlyFullRes, rawUrl, uniqueName };
    });

    const resolveDetailUrl = async (detailUrl: string): Promise<string | null> => {
      const subResp = await fetchDetailPageHtmlSmart(detailUrl, {
        relayUrl:
          detailUrl.includes('r.jina.ai') || (cleanRelayUrl && detailUrl.includes(cleanRelayUrl))
            ? ''
            : cleanRelayUrl,
        timeoutMs: 9000,
      });
      if (!subResp.ok) return null;
      const resolved = extractBestImageFromDetailPage(subResp.html, subResp.url || detailUrl);
      return resolved?.url || null;
    };

    const fetchAllEntries = async (
      onImageDone?: (info: {
        fetchedCount: number;
        totalCount: number;
        validCount: number;
        bytesFetched: number;
        filename: string;
      }) => void,
      signal?: AbortSignal
    ): Promise<ArchiveEntry[]> => {
      const limit = pLimit(10);
      let fetchedCount = 0;
      let validCount = 0;
      let bytesFetched = 0;
      const totalCount = plannedTasks.length;

      const fetchedEntries = await Promise.all(
        plannedTasks.map((task) =>
          limit(async (): Promise<ArchiveEntry | null> => {
            if (signal?.aborted) return null;
            const { item, onlyFullRes, rawUrl, uniqueName } = task;
            if (!rawUrl) {
              fetchedCount++;
              onImageDone?.({ fetchedCount, totalCount, validCount, bytesFetched, filename: uniqueName });
              return null;
            }

            const unshrinkAttempt = unshrinkImageUrl(rawUrl);
            let targetUrl = unshrinkAttempt.fullUrl || rawUrl;

            if (isLowResUrl(targetUrl) && item.linkedPageUrl && !signal?.aborted) {
              try {
                const masterUrl = await resolveDetailUrl(item.linkedPageUrl);
                if (masterUrl && !isLowResUrl(masterUrl)) {
                  targetUrl = masterUrl;
                }
              } catch {
                // ignore detail lookup failure
              }
            }

            if (onlyFullRes && isLowResUrl(targetUrl) && !item.linkedPageUrl) {
              fetchedCount++;
              onImageDone?.({ fetchedCount, totalCount, validCount, bytesFetched, filename: uniqueName });
              return null;
            }

            if (signal?.aborted) return null;

            const result = await resolveImageBufferWithFallbacks({
              imageUrl: targetUrl,
              explicitReferer: referer,
              relayUrl: cleanRelayUrl,
              fallbackUrl: item.fallbackUrl,
              linkedPageUrl: item.linkedPageUrl,
              minBytes: 1500,
              allowFallbackUrl: !onlyFullRes || !isLowResUrl(item.fallbackUrl),
              resolveDetailPageUrl: resolveDetailUrl,
            });

            fetchedCount++;
            if (result?.buf) {
              validCount++;
              bytesFetched += result.buf.length;
              onImageDone?.({ fetchedCount, totalCount, validCount, bytesFetched, filename: uniqueName });
              return { path: uniqueName, data: result.buf };
            }

            onImageDone?.({ fetchedCount, totalCount, validCount, bytesFetched, filename: uniqueName });
            return null;
          })
        )
      );

      return fetchedEntries.filter((entry): entry is ArchiveEntry => entry !== null);
    };

    if (!streamProgress) {
      const validEntries = await fetchAllEntries(undefined, req.signal);
      if (validEntries.length === 0) {
        return NextResponse.json(
          {
            error:
              'Remote servers rejected or timed out image downloads. Use the in-browser direct download option.',
          },
          { status: 502 }
        );
      }

      const { buffer, contentType, format } = await buildCompressedArchive(validEntries, archiveFormat, {
        signal: req.signal,
      });

      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': buffer.length.toString(),
          'Content-Disposition': buildContentDispositionHeader(archiveFilename),
          'X-Archive-Format': format,
          'X-Archive-Count': validEntries.length.toString(),
          'Cache-Control': 'no-store',
        },
      });
    }

    // NDJSON streaming progress response: fetching (2..60%) -> compressing (60..85%) -> ready (token)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const sendEvent = (payload: Record<string, unknown>) => {
          if (closed || req.signal.aborted) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          } catch {
            closed = true;
          }
        };
        const closeStream = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        try {
          sendEvent({
            stage: 'fetching',
            format: archiveFormat,
            filename: archiveFilename,
            fetchedCount: 0,
            totalCount: plannedTasks.length,
            validCount: 0,
            bytesFetched: 0,
            percent: 2,
          });

          const validEntries = await fetchAllEntries(
            ({ fetchedCount, totalCount, validCount, bytesFetched, filename }) => {
              const ratio = totalCount > 0 ? fetchedCount / totalCount : 1;
              const percent = Math.min(60, Math.max(2, Math.round(2 + ratio * 58)));
              sendEvent({
                stage: 'fetching',
                format: archiveFormat,
                filename: archiveFilename,
                currentFile: filename,
                fetchedCount,
                totalCount,
                validCount,
                bytesFetched,
                percent,
              });
            },
            req.signal
          );

          if (req.signal.aborted) {
            closeStream();
            return;
          }

          if (validEntries.length === 0) {
            sendEvent({
              stage: 'error',
              status: 502,
              error:
                'Remote servers rejected or timed out image downloads. Use the in-browser direct download option.',
            });
            closeStream();
            return;
          }

          let lastCompressSentPct = -1;
          sendEvent({
            stage: 'compressing',
            format: archiveFormat,
            filename: archiveFilename,
            compressPercent: 0,
            validCount: validEntries.length,
            totalCount: plannedTasks.length,
            percent: 60,
          });

          const { buffer, contentType, format } = await buildCompressedArchive(
            validEntries,
            archiveFormat,
            {
              signal: req.signal,
              onProgress: (compressPct) => {
                if (
                  compressPct === 100 ||
                  lastCompressSentPct < 0 ||
                  compressPct - lastCompressSentPct >= 2
                ) {
                  lastCompressSentPct = compressPct;
                  const overallPct = Math.min(85, Math.max(60, Math.round(60 + (compressPct / 100) * 25)));
                  sendEvent({
                    stage: 'compressing',
                    format: archiveFormat,
                    filename: archiveFilename,
                    compressPercent: compressPct,
                    validCount: validEntries.length,
                    totalCount: plannedTasks.length,
                    percent: overallPct,
                  });
                }
              },
            }
          );

          if (req.signal.aborted) {
            closeStream();
            return;
          }

          const stagedMeta = await saveStagedArchive(buffer, {
            filename: archiveFilename,
            format,
            contentType,
            fileCount: validEntries.length,
          });

          sendEvent({
            stage: 'ready',
            token: stagedMeta.token,
            filename: stagedMeta.filename,
            format: stagedMeta.format,
            contentType: stagedMeta.contentType,
            totalBytes: stagedMeta.totalBytes,
            fileCount: stagedMeta.fileCount,
            skippedCount: plannedTasks.length - validEntries.length,
            percent: 85,
          });
        } catch (err: any) {
          if (!req.signal.aborted) {
            sendEvent({
              stage: 'error',
              status: 500,
              error: `Failed to generate archive: ${err?.message || 'Unknown error'}`,
            });
          }
        } finally {
          closeStream();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err: any) {
    console.error('Archive generation error:', err);
    return NextResponse.json(
      { error: `Failed to generate archive: ${err?.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}

