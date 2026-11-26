'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  ShieldCheck,
  ShieldAlert,
  Download,
  Copy,
  Check,
  FolderOpen,
  FileCheck2,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  FileUp,
  RefreshCw,
} from 'lucide-react';
import type { ScrapedImage } from '../utils/scraperLogic';
import { triggerTextDownload, type ArchiveFormat } from '../utils/downloader';
import {
  fetchImageBlobWithFallbacks,
  formatBytes,
  isCacheResolvedVia,
} from '../utils/progressiveDownloader';
import {
  buildChecksumManifestFilename,
  computeSha256Hex,
  formatArchiveSidecarSha256Text,
  formatSha256SumsText,
  formatShortSha256,
  parseSha256SumsText,
  verifyFilesAgainstChecksums,
  type ChecksumEntry,
  type ChecksumVerificationReport,
  type LocalFileHashInput,
} from '../utils/checksumUtils';

export interface ArchiveChecksumMeta {
  filename: string;
  format: ArchiveFormat;
  archiveSha256?: string;
  totalBytes: number;
  validImages: number;
  totalImages: number;
}

interface ChecksumVerifierModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: ScrapedImage[];
  pageTitle: string;
  sourceUrl: string;
  relayUrl?: string;
  initialEntries?: ChecksumEntry[];
  archiveMeta?: ArchiveChecksumMeta | null;
  initialTab?: 'manifest' | 'verify';
  onDownloadMissing?: (missingImages: ScrapedImage[]) => void;
  onNotify?: (message: string) => void;
}

export const ChecksumVerifierModal: React.FC<ChecksumVerifierModalProps> = ({
  isOpen,
  onClose,
  images,
  pageTitle,
  sourceUrl,
  relayUrl = '',
  initialEntries,
  archiveMeta = null,
  initialTab = 'manifest',
  onDownloadMissing,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<'manifest' | 'verify'>(initialTab);
  const [entries, setEntries] = useState<ChecksumEntry[]>(initialEntries || []);
  const [uploadedManifestEntries, setUploadedManifestEntries] = useState<ChecksumEntry[] | null>(
    null
  );
  const [uploadedManifestName, setUploadedManifestName] = useState<string>('');
  const [isComputingManifest, setIsComputingManifest] = useState(false);
  const [computeProgress, setComputeProgress] = useState({ done: 0, total: 0, cached: 0, failed: 0 });
  const [failedEntryNames, setFailedEntryNames] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [isHashingLocal, setIsHashingLocal] = useState(false);
  const [localHashProgress, setLocalHashProgress] = useState({ done: 0, total: 0 });
  const [localFiles, setLocalFiles] = useState<LocalFileHashInput[]>([]);
  const [archiveFileVerification, setArchiveFileVerification] = useState<{
    filename: string;
    sha256: string;
    matched: boolean;
  } | null>(null);

  const computeAbortRef = useRef<AbortController | null>(null);
  const localFilesInputRef = useRef<HTMLInputElement | null>(null);
  const localFolderInputRef = useRef<HTMLInputElement | null>(null);
  const manifestUploadInputRef = useRef<HTMLInputElement | null>(null);
  const autoComputedKeyRef = useRef<string>('');

  // Reset modal transient state cleanly when opened with new context
  useEffect(() => {
    if (!isOpen) {
      computeAbortRef.current?.abort();
      computeAbortRef.current = null;
      return;
    }
    setActiveTab(initialTab);
    if (initialEntries && initialEntries.length > 0) {
      setEntries(initialEntries);
    } else {
      setEntries([]);
    }
    setLocalFiles([]);
    setArchiveFileVerification(null);
    setUploadedManifestEntries(null);
    setUploadedManifestName('');
    setFailedEntryNames([]);
  }, [isOpen, initialTab, initialEntries]);

  // Attach non-standard webkitdirectory attribute safely without TS warnings
  useEffect(() => {
    if (localFolderInputRef.current) {
      localFolderInputRef.current.setAttribute('webkitdirectory', '');
      localFolderInputRef.current.setAttribute('directory', '');
    }
  }, [isOpen, activeTab]);

  const computeAllImageChecksums = async (targetImages: ScrapedImage[]) => {
    if (targetImages.length === 0) return;
    computeAbortRef.current?.abort();
    const controller = new AbortController();
    computeAbortRef.current = controller;

    setIsComputingManifest(true);
    setFailedEntryNames([]);
    setComputeProgress({ done: 0, total: targetImages.length, cached: 0, failed: 0 });

    const seenNames = new Set<string>();
    const planned = targetImages.map((img, idx) => {
      const base = (img.filename || `image_${idx + 1}.jpg`).trim() || `image_${idx + 1}.jpg`;
      const dotIdx = base.lastIndexOf('.');
      const stem = dotIdx !== -1 ? base.slice(0, dotIdx) : base;
      const ext = dotIdx !== -1 ? base.slice(dotIdx) : '.jpg';
      let unique = base;
      let n = 1;
      while (seenNames.has(unique.toLowerCase())) {
        unique = `${stem}_${n}${ext}`;
        n++;
      }
      seenNames.add(unique.toLowerCase());
      return { img, filename: unique };
    });

    const resultsByIdx: Array<ChecksumEntry | null> = new Array(planned.length).fill(null);
    const failedNames: string[] = [];
    let cursor = 0;
    let done = 0;
    let cached = 0;
    let failed = 0;

    const workerCount = Math.min(6, planned.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (!controller.signal.aborted) {
          const idx = cursor++;
          if (idx >= planned.length) break;
          const { img, filename } = planned[idx];

          const { blob, resolvedVia } = await fetchImageBlobWithFallbacks(
            {
              id: img.id || `chk-${idx}`,
              url: img.fullUrl,
              filename,
              fallbackUrl: img.fallbackUrl,
              linkedPageUrl: img.linkedPageUrl,
              referer: sourceUrl,
              relayUrl: relayUrl.trim() || undefined,
            },
            {
              timeoutMs: 12000,
              signal: controller.signal,
              useCache: true,
            }
          );

          if (controller.signal.aborted) break;

          if (blob && blob.size > 0) {
            const sha256 = await computeSha256Hex(blob).catch(() => '');
            if (sha256) {
              resultsByIdx[idx] = {
                id: img.id,
                filename,
                relativePath: filename,
                sha256,
                bytes: blob.size,
                url: img.fullUrl,
                resolvedVia,
              };
              if (isCacheResolvedVia(resolvedVia)) cached++;
            } else {
              failed++;
              failedNames.push(filename);
            }
          } else {
            failed++;
            failedNames.push(filename);
          }

          done++;
          setComputeProgress({ done, total: planned.length, cached, failed });
          setEntries(resultsByIdx.filter((r): r is ChecksumEntry => r !== null));
        }
      })
    );

    if (computeAbortRef.current === controller) {
      computeAbortRef.current = null;
    }
    setFailedEntryNames(failedNames);
    setIsComputingManifest(false);
  };

  // Auto-generate gallery manifest once when opened without pre-computed entries
  useEffect(() => {
    if (!isOpen) {
      autoComputedKeyRef.current = '';
      return;
    }
    if (initialEntries && initialEntries.length > 0) return;
    if (images.length === 0) return;

    const key = `${sourceUrl}|${images.map((i) => i.id).join(',')}`;
    if (autoComputedKeyRef.current === key) return;
    autoComputedKeyRef.current = key;
    void computeAllImageChecksums(images);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, images, sourceUrl, initialEntries]);

  const effectiveExpectedEntries = useMemo(
    () => (uploadedManifestEntries && uploadedManifestEntries.length > 0 ? uploadedManifestEntries : entries),
    [uploadedManifestEntries, entries]
  );

  const verificationReport: ChecksumVerificationReport | null = useMemo(() => {
    if (localFiles.length === 0 || effectiveExpectedEntries.length === 0) return null;
    return verifyFilesAgainstChecksums(effectiveExpectedEntries, localFiles);
  }, [effectiveExpectedEntries, localFiles]);

  const missingOrCorruptedImages = useMemo(() => {
    if (!verificationReport || images.length === 0) return [];
    const targetEntries = [
      ...verificationReport.missingEntries,
      ...verificationReport.mismatchedEntries.map((m) => m.expected),
    ];
    if (targetEntries.length === 0) return [];

    const matchedIds = new Set<string>();
    const out: ScrapedImage[] = [];

    for (const entry of targetEntries) {
      const found = images.find(
        (img) =>
          (entry.id && img.id === entry.id) ||
          (entry.url && img.fullUrl === entry.url) ||
          img.filename.toLowerCase() === entry.filename.toLowerCase()
      );
      if (found && !matchedIds.has(found.id)) {
        matchedIds.add(found.id);
        out.push(found);
      }
    }
    return out;
  }, [verificationReport, images]);

  const handleCopyText = async (key: string, value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(key);
      setTimeout(() => setCopiedId((prev) => (prev === key ? null : prev)), 1800);
      onNotify?.(`Copied ${label} to clipboard`);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadImageManifest = () => {
    if (effectiveExpectedEntries.length === 0) return;
    const filename = buildChecksumManifestFilename(pageTitle, sourceUrl, '_SHA256SUMS.sha256');
    const text = formatSha256SumsText(effectiveExpectedEntries, [
      `Ultimate Image Processor Checksum Manifest`,
      `Title: ${pageTitle || 'Gallery'}`,
      sourceUrl ? `Source: ${sourceUrl}` : '',
      `Images: ${effectiveExpectedEntries.length} (${formatBytes(
        effectiveExpectedEntries.reduce((sum, e) => sum + (e.bytes || 0), 0)
      )})`,
      `Verify locally with: sha256sum -c ${filename}`,
    ]);
    triggerTextDownload(text, filename, 'text/plain');
    onNotify?.(`Downloaded checksum manifest ${filename}`);
  };

  const handleDownloadArchiveSidecar = () => {
    if (!archiveMeta?.archiveSha256) return;
    const sidecarFilename = `${archiveMeta.filename}.sha256`;
    const text = formatArchiveSidecarSha256Text({
      archiveFilename: archiveMeta.filename,
      archiveSha256: archiveMeta.archiveSha256,
      totalBytes: archiveMeta.totalBytes,
      expectedImageCount: archiveMeta.totalImages,
      entries,
    });
    triggerTextDownload(text, sidecarFilename, 'text/plain');
    onNotify?.(`Downloaded archive checksum ${sidecarFilename}`);
  };

  const handleLocalFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setIsHashingLocal(true);
    setLocalHashProgress({ done: 0, total: files.length });
    setArchiveFileVerification(null);

    const hashed: LocalFileHashInput[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const sha256 = await computeSha256Hex(f).catch(() => '');
      if (sha256) {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        // Check if user picked the compressed archive itself to verify archive integrity
        if (
          files.length === 1 &&
          archiveMeta?.archiveSha256 &&
          /\.(7z|zip)$/i.test(f.name)
        ) {
          setArchiveFileVerification({
            filename: f.name,
            sha256,
            matched: sha256.toLowerCase() === archiveMeta.archiveSha256.toLowerCase(),
          });
        }
        hashed.push({
          filename: f.name,
          relativePath: rel,
          sha256,
          sizeBytes: f.size,
        });
      }
      setLocalHashProgress({ done: i + 1, total: files.length });
    }

    setLocalFiles(hashed);
    setIsHashingLocal(false);
  };

  const handleManifestFileUpload = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    const text = await file.text().catch(() => '');
    const parsed = parseSha256SumsText(text);
    if (parsed.length === 0) {
      onNotify?.('No valid SHA-256 lines found in selected manifest file.');
      return;
    }
    setUploadedManifestEntries(parsed);
    setUploadedManifestName(file.name);
    onNotify?.(`Loaded ${parsed.length} expected checksums from ${file.name}`);
  };

  if (!isOpen) return null;

  const totalBytes = effectiveExpectedEntries.reduce((acc, e) => acc + (e.bytes || 0), 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="checksum-verifier-title"
      data-testid="checksum-verifier-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-6"
    >
      <div className="bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.1] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#DCE1EB] dark:border-white/[0.08]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/70 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2
                id="checksum-verifier-title"
                className="font-display text-base sm:text-lg font-bold text-[#0F141F] dark:text-white truncate"
              >
                Download Checksum &amp; Completeness Verifier
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                SHA-256 integrity manifest &amp; missing-image detector for {pageTitle || 'gallery'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close checksum verifier"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Sub-navigation tabs */}
        <div className="px-5 pt-3 border-b border-[#DCE1EB] dark:border-white/[0.08] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'manifest'}
              data-testid="checksum-tab-manifest"
              onClick={() => setActiveTab('manifest')}
              className={`px-3.5 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                activeTab === 'manifest'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              SHA-256 Manifest ({effectiveExpectedEntries.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'verify'}
              data-testid="checksum-tab-verify"
              onClick={() => setActiveTab('verify')}
              className={`px-3.5 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                activeTab === 'verify'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Verify Local Files
              {verificationReport && (
                <span className="ml-1.5 font-mono text-[11px]">
                  ({verificationReport.verifiedCount}/{verificationReport.expectedCount})
                </span>
              )}
            </button>
          </div>

          <div className="pb-2 flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {isComputingManifest ? (
              <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-semibold">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Hashing {computeProgress.done}/{computeProgress.total}
                {computeProgress.cached > 0 ? ` (${computeProgress.cached} cached)` : ''}
              </span>
            ) : (
              <span>
                {effectiveExpectedEntries.length} checksums · {formatBytes(totalBytes)}
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Archive digest banner if opened after .7Z / .ZIP download */}
          {archiveMeta?.archiveSha256 && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0B0D14] border border-[#DCE1EB] dark:border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap text-xs font-semibold text-[#0F141F] dark:text-white">
                  <span>Archive SHA-256 ({archiveMeta.filename})</span>
                  <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                    {archiveMeta.validImages}/{archiveMeta.totalImages} images packed · SHA256SUMS.txt embedded
                  </span>
                </div>
                <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300 break-all">
                  {archiveMeta.archiveSha256}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    handleCopyText('archive-sha', archiveMeta.archiveSha256!, 'archive SHA-256')
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#141925] border border-[#DCE1EB] dark:border-white/[0.1] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] cursor-pointer"
                >
                  {copiedId === 'archive-sha' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>Copy</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadArchiveSidecar}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>.{archiveMeta.format}.sha256</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'manifest' ? (
            <div className="space-y-4">
              {/* Action bar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    data-testid="modal-download-manifest-btn"
                    disabled={effectiveExpectedEntries.length === 0}
                    onClick={handleDownloadImageManifest}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .sha256 Manifest</span>
                  </button>

                  <button
                    type="button"
                    disabled={effectiveExpectedEntries.length === 0}
                    onClick={() =>
                      handleCopyText(
                        'all-manifest',
                        formatSha256SumsText(effectiveExpectedEntries),
                        'SHA-256 list'
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 text-xs font-semibold text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
                  >
                    {copiedId === 'all-manifest' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>Copy sha256sum</span>
                  </button>

                  {images.length > 0 && (
                    <button
                      type="button"
                      disabled={isComputingManifest}
                      onClick={() => void computeAllImageChecksums(images)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isComputingManifest ? 'animate-spin' : ''}`}
                      />
                      <span>Recompute ({images.length})</span>
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setActiveTab('verify')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  <FileCheck2 className="w-3.5 h-3.5" />
                  <span>Verify Local Folder / Files</span>
                </button>
              </div>

              {failedEntryNames.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/70 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>
                    {failedEntryNames.length} image(s) could not be fetched for hashing:{' '}
                    <span className="font-mono">{failedEntryNames.slice(0, 4).join(', ')}</span>
                    {failedEntryNames.length > 4 ? ` +${failedEntryNames.length - 4} more` : ''}
                  </span>
                </div>
              )}

              {/* Checksum rows */}
              <div className="border border-[#DCE1EB] dark:border-white/[0.08] rounded-xl overflow-hidden">
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-white/[0.06]">
                  {effectiveExpectedEntries.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                      {isComputingManifest
                        ? 'Computing SHA-256 checksums for gallery images...'
                        : 'No checksum entries computed yet.'}
                    </div>
                  ) : (
                    effectiveExpectedEntries.map((entry, idx) => (
                      <div
                        key={`${entry.relativePath}-${idx}`}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-mono font-semibold text-[#0F141F] dark:text-slate-100 truncate">
                            {entry.relativePath || entry.filename}
                          </div>
                          <div
                            className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate"
                            title={entry.sha256}
                          >
                            {entry.sha256}
                          </div>
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0">
                          {entry.bytes > 0 && (
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                              {formatBytes(entry.bytes)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyText(`row-${idx}`, entry.sha256, entry.filename)
                            }
                            aria-label={`Copy SHA-256 for ${entry.filename}`}
                            className="p-1.5 rounded-md text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] cursor-pointer"
                          >
                            {copiedId === `row-${idx}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Step 1: Pick local files/folder + optional .sha256 file */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 rounded-xl border border-[#DCE1EB] dark:border-white/[0.08] bg-slate-50/70 dark:bg-[#0B0D14] space-y-2.5">
                  <div className="text-xs font-semibold text-[#0F141F] dark:text-white">
                    1. Select Downloaded Images or Folder
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Files are hashed locally in your browser via SHA-256 to verify none are missing or truncated.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={localFolderInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        void handleLocalFilesSelected(e.target.files);
                        e.target.value = '';
                      }}
                    />
                    <input
                      ref={localFilesInputRef}
                      data-testid="checksum-local-files-input"
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        void handleLocalFilesSelected(e.target.files);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      disabled={isHashingLocal}
                      onClick={() => localFolderInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Choose Folder</span>
                    </button>
                    <button
                      type="button"
                      disabled={isHashingLocal}
                      onClick={() => localFilesInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-[#141925] border border-[#DCE1EB] dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                    >
                      <FileCheck2 className="w-3.5 h-3.5" />
                      <span>Choose Files</span>
                    </button>
                  </div>
                  {isHashingLocal && (
                    <div className="text-[11px] font-mono text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>
                        Hashing local files ({localHashProgress.done}/{localHashProgress.total})...
                      </span>
                    </div>
                  )}
                  {!isHashingLocal && localFiles.length > 0 && (
                    <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                      Hashed {localFiles.length} local file{localFiles.length === 1 ? '' : 's'}
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-xl border border-[#DCE1EB] dark:border-white/[0.08] bg-slate-50/70 dark:bg-[#0B0D14] space-y-2.5">
                  <div className="text-xs font-semibold text-[#0F141F] dark:text-white">
                    2. Expected Checksum Baseline
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {uploadedManifestName
                      ? `Using uploaded manifest: ${uploadedManifestName} (${uploadedManifestEntries?.length ?? 0} entries)`
                      : `Using current gallery manifest (${effectiveExpectedEntries.length} expected images).`}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={manifestUploadInputRef}
                      type="file"
                      accept=".sha256,.txt,.sha256sums"
                      className="hidden"
                      onChange={(e) => {
                        void handleManifestFileUpload(e.target.files);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => manifestUploadInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-[#141925] border border-[#DCE1EB] dark:border-white/[0.1] hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      <span>Load .sha256 File</span>
                    </button>
                    {uploadedManifestEntries && (
                      <button
                        type="button"
                        onClick={() => {
                          setUploadedManifestEntries(null);
                          setUploadedManifestName('');
                        }}
                        className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Use Gallery Manifest
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Single-archive checksum result if user selected a .7z/.zip */}
              {archiveFileVerification && (
                <div
                  className={`p-3.5 rounded-xl border flex items-center gap-2.5 text-xs ${
                    archiveFileVerification.matched
                      ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-200'
                      : 'bg-rose-50 dark:bg-rose-950/35 border-rose-200 dark:border-rose-800/70 text-rose-900 dark:text-rose-200'
                  }`}
                >
                  {archiveFileVerification.matched ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <span className="font-semibold">
                      {archiveFileVerification.matched
                        ? `Archive ${archiveFileVerification.filename} SHA-256 verified!`
                        : `Archive ${archiveFileVerification.filename} SHA-256 mismatch!`}
                    </span>
                    <div className="font-mono text-[11px] opacity-80 truncate">
                      Computed: {archiveFileVerification.sha256}
                    </div>
                  </div>
                </div>
              )}

              {/* Completeness verification report */}
              {verificationReport && !archiveFileVerification && (
                <div className="space-y-3" data-testid="checksum-verification-report">
                  <div
                    className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
                      verificationReport.isComplete
                        ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-100'
                        : 'bg-amber-50 dark:bg-amber-950/35 border-amber-200 dark:border-amber-800/70 text-amber-950 dark:text-amber-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {verificationReport.isComplete ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                      )}
                      <div>
                        <div className="text-xs sm:text-sm font-bold">
                          {verificationReport.isComplete
                            ? `All ${verificationReport.verifiedCount} of ${verificationReport.expectedCount} images verified`
                            : `${verificationReport.verifiedCount} verified · ${verificationReport.missingCount} missing · ${verificationReport.mismatchedCount} mismatched`}
                        </div>
                        <div className="text-[11px] opacity-85 font-mono tabular-nums">
                          Expected: {verificationReport.expectedCount} · Extra local files:{' '}
                          {verificationReport.extraCount}
                        </div>
                      </div>
                    </div>

                    {missingOrCorruptedImages.length > 0 && onDownloadMissing && (
                      <button
                        type="button"
                        data-testid="checksum-download-missing-btn"
                        onClick={() => {
                          onDownloadMissing(missingOrCorruptedImages);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer tabular-nums"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Missing ({missingOrCorruptedImages.length})</span>
                      </button>
                    )}
                  </div>

                  {/* Per-file status table */}
                  <div className="border border-[#DCE1EB] dark:border-white/[0.08] rounded-xl overflow-hidden">
                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-white/[0.06]">
                      {verificationReport.items.map((item, idx) => (
                        <div
                          key={`${item.expected.relativePath}-${idx}`}
                          className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-mono font-semibold text-[#0F141F] dark:text-slate-100 truncate">
                              {item.expected.relativePath || item.expected.filename}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              Expected: {formatShortSha256(item.expected.sha256)}
                              {item.actual && item.status === 'mismatched'
                                ? ` · Actual: ${formatShortSha256(item.actual.sha256)}`
                                : ''}
                            </div>
                          </div>

                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold shrink-0 ${
                              item.status === 'matched'
                                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                : item.status === 'missing'
                                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                                  : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                            }`}
                          >
                            {item.status === 'matched'
                              ? 'Verified'
                              : item.status === 'missing'
                                ? 'Missing'
                                : 'Mismatch'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
