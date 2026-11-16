'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Users,
  FolderOpen,
  ImagePlus,
  Sparkles,
  FolderInput,
  Loader2,
  Download,
  FolderDown,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Edit3,
  Check,
  X,
  ArrowRightLeft,
  Merge,
  UserCheck,
  UserX,
} from 'lucide-react';
import {
  buildClassificationManifest,
  chunkItemsForAnalysis,
  FolderNamingMode,
  HumanImageBiometricProfile,
  IdentityCluster,
  mergeClusters,
  moveImageBetweenClusters,
  normalizeClusterAssignments,
  renameClusterFolder,
  resolveUniqueFilenames,
  sanitizeFolderName,
} from '../utils/humanClassifierLogic';
import { triggerBlobDownload } from '../utils/downloader';
import { fetchApiJson } from '../utils/safeFetchJson';
import { ScrapedImage } from '../utils/scraperLogic';

interface ClassifierImageItem {
  id: string;
  sourceKind: 'browser' | 'disk' | 'remote';
  filename: string;
  relativePath: string;
  previewUrl: string;
  objectUrlToRevoke?: string;
  file?: File;
  sizeBytes: number;
}

interface HumanClassifierStudioProps {
  seededScrapedImages?: ScrapedImage[];
  seededSourceUrl?: string;
  onClearSeeded?: () => void;
  onNotify?: (message: string) => void;
}

type IntakeMode = 'browser' | 'disk';

const SAMPLE_PORTRAIT_FILES = [
  'random_001.jpg',
  'random_002.jpg',
  'random_003.jpg',
  'random_004.jpg',
  'random_005.jpg',
  'random_006.jpg',
];

async function encodeImageUrlToThumbnailBase64(
  srcUrl: string,
  maxEdge = 512
): Promise<{ mimeType: string; base64Data: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => {
      reject(new Error('Image thumbnail encoding timed out'));
    }, 12000);

    img.onload = () => {
      clearTimeout(timer);
      const natW = Math.max(1, img.naturalWidth || img.width || 1);
      const natH = Math.max(1, img.naturalHeight || img.height || 1);
      const scale = Math.min(1, maxEdge / Math.max(natW, natH));
      const targetW = Math.max(1, Math.round(natW * scale));
      const targetH = Math.max(1, Math.round(natH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('2D canvas unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const base64Data = dataUrl.split(',')[1] || '';
      resolve({ mimeType: 'image/jpeg', base64Data });
    };

    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Failed to decode image for classification'));
    };

    img.src = srcUrl;
  });
}

export const HumanClassifierStudio: React.FC<HumanClassifierStudioProps> = ({
  seededScrapedImages = [],
  seededSourceUrl = '',
  onClearSeeded,
  onNotify,
}) => {
  const [intakeMode, setIntakeMode] = useState<IntakeMode>('browser');
  const [items, setItems] = useState<ClassifierImageItem[]>([]);
  const [sourceLabel, setSourceLabel] = useState<string>('');
  const [folderNamingMode, setFolderNamingMode] = useState<FolderNamingMode>('indexed');
  const [isDraggingFiles, setIsDraggingFiles] = useState<boolean>(false);

  // Disk mode inputs
  const [diskPathInput, setDiskPathInput] = useState<string>('');
  const [diskScannedRoot, setDiskScannedRoot] = useState<string>('');
  const [diskOutputDir, setDiskOutputDir] = useState<string>('');
  const [diskRecursive, setDiskRecursive] = useState<boolean>(true);
  const [diskWriteSummary, setDiskWriteSummary] = useState<{
    outputDir: string;
    foldersCount: number;
    writtenFilesCount: number;
  } | null>(null);

  // AI Classification results & progress
  const [profiles, setProfiles] = useState<HumanImageBiometricProfile[]>([]);
  const [clusters, setClusters] = useState<IdentityCluster[]>([]);
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);

  const [isClassifying, setIsClassifying] = useState<boolean>(false);
  const [progressStage, setProgressStage] = useState<string>('');
  const [progressCounts, setProgressCounts] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Folder editing state
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>('');
  const [canDirectSaveToFolder, setCanDirectSaveToFolder] = useState<boolean>(false);

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const revokableUrlsRef = useRef<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onClearSeededRef = useRef(onClearSeeded);

  useEffect(() => {
    onClearSeededRef.current = onClearSeeded;
  }, [onClearSeeded]);

  useEffect(() => {
    setCanDirectSaveToFolder(
      typeof window !== 'undefined' &&
        'showDirectoryPicker' in window &&
        window.self === window.top
    );
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      for (const u of revokableUrlsRef.current) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const clearRevokableUrls = () => {
    for (const u of revokableUrlsRef.current) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        // ignore
      }
    }
    revokableUrlsRef.current = [];
  };

  // Seed scraped images when sent from GalleryView
  useEffect(() => {
    if (!seededScrapedImages || seededScrapedImages.length === 0) return;
    clearRevokableUrls();
    const stamp = Date.now();
    const imported: ClassifierImageItem[] = seededScrapedImages.slice(0, 200).map((img, idx) => {
      const proxied = `/api/proxy?url=${encodeURIComponent(img.fullUrl)}&referer=${encodeURIComponent(seededSourceUrl || '')}`;
      const fname = img.filename || `scraped_${idx + 1}.${img.format || 'jpg'}`;
      return {
        id: `scraped_${stamp}_${idx}`,
        sourceKind: 'remote',
        filename: fname,
        relativePath: fname,
        previewUrl: proxied,
        sizeBytes: 0,
      };
    });

    setIntakeMode('browser');
    setItems(imported);
    setProfiles([]);
    setClusters([]);
    setActiveClusterId(null);
    setDiskScannedRoot('');
    setDiskWriteSummary(null);
    setErrorMsg(null);
    setSourceLabel(`Scraper Selection (${imported.length})`);
    setStatusMsg(
      `Imported ${imported.length} image${imported.length === 1 ? '' : 's'} from Scraper Studio. Click "Classify Humans with AI" to group unique people into separate folders.`
    );
    onClearSeededRef.current?.();
  }, [seededScrapedImages, seededSourceUrl]);

  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const profileById = useMemo(
    () => new Map(profiles.map((p) => [p.imageId, p])),
    [profiles]
  );

  const activeCluster = useMemo(
    () => clusters.find((c) => c.clusterId === activeClusterId) || clusters[0] || null,
    [clusters, activeClusterId]
  );

  const uniqueHumanCount = useMemo(
    () => clusters.filter((c) => !c.isNonHuman).length,
    [clusters]
  );

  const resetClassificationState = () => {
    setProfiles([]);
    setClusters([]);
    setActiveClusterId(null);
    setDiskWriteSummary(null);
    setErrorMsg(null);
    setEditingClusterId(null);
  };

  const ingestFiles = (fileList: FileList | File[], label: string, append = false) => {
    const valid = Array.from(fileList).filter((f) => {
      if (f.type && f.type.startsWith('image/')) return true;
      return /\.(jpe?g|png|webp|avif|gif|bmp)$/i.test(f.name);
    });

    if (valid.length === 0) {
      setErrorMsg('No supported image files found in the selection.');
      return;
    }

    const capped = valid.slice(0, 250);
    if (!append) {
      clearRevokableUrls();
    }

    const stamp = Date.now();
    const mapped: ClassifierImageItem[] = capped.map((file, idx) => {
      const objUrl = URL.createObjectURL(file);
      revokableUrlsRef.current.push(objUrl);
      const rel = (file as any).webkitRelativePath || file.name;
      return {
        id: `img_${stamp}_${idx}`,
        sourceKind: 'browser',
        filename: file.name,
        relativePath: rel,
        previewUrl: objUrl,
        objectUrlToRevoke: objUrl,
        file,
        sizeBytes: file.size,
      };
    });

    resetClassificationState();
    setItems((prev) => (append ? [...prev, ...mapped].slice(0, 250) : mapped));
    setDiskScannedRoot('');
    setSourceLabel(label);
    setStatusMsg(
      `Loaded ${mapped.length} image${mapped.length === 1 ? '' : 's'}. Ready to analyze facial structure & body proportions.`
    );
  };

  const handleLoadSampleBatch = async () => {
    setErrorMsg(null);
    clearRevokableUrls();
    resetClassificationState();

    try {
      const loaded: ClassifierImageItem[] = await Promise.all(
        SAMPLE_PORTRAIT_FILES.map(async (fname, idx) => {
          const url = `/samples/humans/${fname}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Failed to fetch sample image ${fname}`);
          const blob = await res.blob();
          const file = new File([blob], fname, { type: blob.type || 'image/jpeg' });
          const objUrl = URL.createObjectURL(file);
          revokableUrlsRef.current.push(objUrl);
          return {
            id: `sample_${idx + 1}`,
            sourceKind: 'browser',
            filename: fname,
            relativePath: fname,
            previewUrl: objUrl,
            objectUrlToRevoke: objUrl,
            file,
            sizeBytes: file.size,
          };
        })
      );

      setIntakeMode('browser');
      setItems(loaded);
      setDiskScannedRoot('');
      setSourceLabel('Sample Portrait Batch');
      setStatusMsg(
        `Loaded ${loaded.length} sample portraits (3 distinct people across varied attire & locations). Click "Classify Humans with AI" to sort each person into their own folder.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not load sample portraits.');
    }
  };

  const handleRunBrowserClassification = async () => {
    if (items.length === 0 || isClassifying) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsClassifying(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setDiskWriteSummary(null);
    setProgressStage('Encoding thumbnails & analyzing facial structure and body proportions...');
    setProgressCounts({ done: 0, total: items.length });

    try {
      const batches = chunkItemsForAnalysis(items, 5);
      const collectedProfiles: HumanImageBiometricProfile[] = [];
      let completedCount = 0;

      const CONCURRENCY = 3;
      for (let i = 0; i < batches.length; i += CONCURRENCY) {
        if (controller.signal.aborted) {
          throw new Error('Classification cancelled.');
        }

        const wave = batches.slice(i, i + CONCURRENCY);
        const waveProfiles = await Promise.all(
          wave.map(async (batch) => {
            const encodedBatch = await Promise.all(
              batch.map(async (item) => {
                const encoded = await encodeImageUrlToThumbnailBase64(item.previewUrl, 512);
                return {
                  imageId: item.id,
                  filename: item.filename,
                  mimeType: encoded.mimeType,
                  base64Data: encoded.base64Data,
                };
              })
            );

            const { ok, data, error } = await fetchApiJson('/api/ai/classify-humans/analyze-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ images: encodedBatch }),
              signal: controller.signal,
            });

            if (!ok || !data?.profiles) {
              throw new Error(data?.error || error || 'AI batch analysis failed.');
            }
            return data.profiles as HumanImageBiometricProfile[];
          })
        );

        for (const profList of waveProfiles) {
          collectedProfiles.push(...profList);
          completedCount += profList.length;
        }
        setProgressCounts({ done: completedCount, total: items.length });
      }

      if (controller.signal.aborted) {
        throw new Error('Classification cancelled.');
      }

      setProgressStage('Clustering unique individuals across all biometric profiles...');
      const { ok, data, error } = await fetchApiJson('/api/ai/classify-humans/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profiles: collectedProfiles,
          folderNamingMode,
        }),
        signal: controller.signal,
      });

      if (!ok || !data?.clusters) {
        throw new Error(data?.error || error || 'AI identity clustering failed.');
      }

      const nextClusters = data.clusters as IdentityCluster[];
      setProfiles(collectedProfiles);
      setClusters(nextClusters);
      setActiveClusterId(nextClusters[0]?.clusterId || null);

      const humanFolders = nextClusters.filter((c) => !c.isNonHuman).length;
      const summaryText = `Classified ${items.length} image${items.length === 1 ? '' : 's'} into ${humanFolders} unique human folder${humanFolders === 1 ? '' : 's'}.`;
      if (onNotify) {
        onNotify(summaryText);
      } else {
        setStatusMsg(summaryText);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || /cancelled/i.test(err?.message || '')) {
        setStatusMsg('Classification cancelled.');
      } else {
        setErrorMsg(err?.message || 'Human classification failed.');
      }
    } finally {
      setIsClassifying(false);
      setProgressStage('');
      abortControllerRef.current = null;
    }
  };

  const handleRunDiskClassification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!diskPathInput.trim() || isClassifying) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsClassifying(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setDiskWriteSummary(null);
    setProgressStage('Scanning directory...');
    setProgressCounts({ done: 0, total: 0 });

    try {
      const res = await fetch('/api/ai/classify-humans/disk-classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceDir: diskPathInput.trim(),
          recursive: diskRecursive,
          folderNamingMode,
          limit: 250,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error('Failed to start disk directory classification.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.type === 'error') {
            throw new Error(evt.error || 'Disk classification error.');
          } else if (evt.type === 'scanned') {
            clearRevokableUrls();
            const scannedRoot = evt.resolvedSourceDir as string;
            const diskItems: ClassifierImageItem[] = (evt.images || []).map((img: any) => ({
              id: img.imageId,
              sourceKind: 'disk',
              filename: img.filename,
              relativePath: img.relativePath,
              previewUrl: `/api/crop-resize/local-preview?sourceDir=${encodeURIComponent(scannedRoot)}&relativePath=${encodeURIComponent(img.relativePath)}`,
              sizeBytes: img.sizeBytes || 0,
            }));
            setItems(diskItems);
            setDiskScannedRoot(scannedRoot);
            setDiskOutputDir(`${scannedRoot}/classified_humans`);
            setSourceLabel(scannedRoot);
            setProgressCounts({ done: 0, total: diskItems.length });
            setProgressStage('Analyzing facial structure & body proportions...');
          } else if (evt.type === 'progress') {
            setProgressCounts({ done: evt.processed || 0, total: evt.total || 0 });
            if (evt.stage === 'clustering') {
              setProgressStage('Clustering unique individuals into separate folders...');
            } else {
              setProgressStage('Analyzing facial structure & body proportions...');
            }
          } else if (evt.type === 'done') {
            const nextClusters = evt.clusters as IdentityCluster[];
            const nextProfiles = evt.profiles as HumanImageBiometricProfile[];
            setProfiles(nextProfiles);
            setClusters(nextClusters);
            setActiveClusterId(nextClusters[0]?.clusterId || null);

            const humanFolders = nextClusters.filter((c) => !c.isNonHuman).length;
            const summaryText = `Classified ${evt.images?.length || 0} disk images into ${humanFolders} unique human folder${humanFolders === 1 ? '' : 's'}.`;
            if (onNotify) {
              onNotify(summaryText);
            } else {
              setStatusMsg(summaryText);
            }
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setStatusMsg('Disk classification cancelled.');
      } else {
        setErrorMsg(err?.message || 'Disk directory classification failed.');
      }
    } finally {
      setIsClassifying(false);
      setProgressStage('');
      abortControllerRef.current = null;
    }
  };

  const handleNamingModeSwitch = (nextMode: FolderNamingMode) => {
    setFolderNamingMode(nextMode);
    if (clusters.length === 0 || profiles.length === 0) return;

    const reindexed = normalizeClusterAssignments(
      profiles,
      clusters.map((c) => ({
        displayName: c.displayName,
        summary: c.summary,
        dominantFaceShape: c.dominantFaceShape,
        dominantSomatotype: c.dominantSomatotype,
        matchRationale: c.matchRationale,
        confidence: c.confidence,
        imageIds: c.imageIds,
      })),
      nextMode
    );
    setClusters(reindexed);
    setActiveClusterId(reindexed[0]?.clusterId || null);
  };

  const handleCommitRename = (clusterId: string) => {
    if (!renameDraft.trim()) {
      setEditingClusterId(null);
      return;
    }
    setClusters((prev) => renameClusterFolder(prev, clusterId, renameDraft));
    setEditingClusterId(null);
  };

  const handleMergeActiveInto = (targetClusterId: string) => {
    if (!activeCluster || !targetClusterId || targetClusterId === activeCluster.clusterId) return;
    setClusters((prev) => mergeClusters(prev, activeCluster.clusterId, targetClusterId));
    setActiveClusterId(targetClusterId);
    setStatusMsg(`Merged "${activeCluster.folderName}" into target folder.`);
  };

  const handleMoveImage = (imageId: string, targetClusterId: string) => {
    const prof = profileById.get(imageId);
    setClusters((prev) => {
      const updated = moveImageBetweenClusters(prev, imageId, targetClusterId, prof);
      if (activeClusterId && !updated.some((c) => c.clusterId === activeClusterId)) {
        setActiveClusterId(updated[0]?.clusterId || null);
      }
      return updated;
    });
  };

  const fetchItemBlob = async (item: ClassifierImageItem): Promise<Blob> => {
    if (item.file) return item.file;
    const resp = await fetch(item.previewUrl);
    if (!resp.ok) throw new Error(`Failed to load ${item.filename}`);
    return resp.blob();
  };

  const handleExportAllZip = async (onlyCluster?: IdentityCluster) => {
    if (clusters.length === 0 || isExporting) return;
    setIsExporting(true);
    setErrorMsg(null);

    const targetClusters = onlyCluster ? [onlyCluster] : clusters;

    try {
      if (intakeMode === 'disk' && diskScannedRoot) {
        const imageRelativePaths: Record<string, string> = {};
        items.forEach((it) => {
          imageRelativePaths[it.id] = it.relativePath;
        });

        const resp = await fetch('/api/ai/classify-humans/download-zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceDir: diskScannedRoot,
            clusters: targetClusters,
            profiles,
            imageRelativePaths,
          }),
        });
        if (!resp.ok) {
          const errJson = await resp.json().catch(() => ({}));
          throw new Error(errJson.error || 'Failed to stream organized ZIP archive.');
        }
        const zipBlob = await resp.blob();
        const zipFilename = onlyCluster
          ? `${sanitizeFolderName(onlyCluster.folderName)}_${Date.now()}.zip`
          : `classified_humans_${Date.now()}.zip`;
        triggerBlobDownload(zipBlob, zipFilename);
        setStatusMsg(`Downloaded organized ZIP archive (${targetClusters.length} folder${targetClusters.length === 1 ? '' : 's'}).`);
        return;
      }

      const zip = new JSZip();
      const manifest = buildClassificationManifest(targetClusters, profileById);

      for (const folder of manifest.folders) {
        const deduped = resolveUniqueFilenames(
          folder.files.map((f) => ({
            imageId: f.imageId,
            filename: f.originalFilename,
          }))
        );

        for (const entry of deduped) {
          const item = itemById.get(entry.imageId);
          if (!item) continue;
          const blob = await fetchItemBlob(item);
          zip.file(`${folder.folderName}/${entry.safeFilename}`, blob);
        }
      }

      zip.file('classification_manifest.json', JSON.stringify(manifest, null, 2));
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipFilename = onlyCluster
        ? `${sanitizeFolderName(onlyCluster.folderName)}_${Date.now()}.zip`
        : `classified_humans_${Date.now()}.zip`;
      triggerBlobDownload(zipBlob, zipFilename);

      const toast = `Downloaded ZIP with ${targetClusters.length} unique human folder${targetClusters.length === 1 ? '' : 's'}.`;
      if (onNotify) {
        onNotify(toast);
      } else {
        setStatusMsg(toast);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'ZIP export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveToLocalFolders = async () => {
    if (clusters.length === 0 || isExporting) return;

    if (intakeMode === 'disk' && diskScannedRoot) {
      setIsExporting(true);
      setErrorMsg(null);
      try {
        const imageRelativePaths: Record<string, string> = {};
        items.forEach((it) => {
          imageRelativePaths[it.id] = it.relativePath;
        });

        const { ok, data, error } = await fetchApiJson('/api/ai/classify-humans/export-disk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceDir: diskScannedRoot,
            outputDir: diskOutputDir.trim() || undefined,
            clusters,
            profiles,
            imageRelativePaths,
          }),
        });

        if (!ok || !data) {
          throw new Error(data?.error || error || 'Failed to write folders to disk.');
        }

        setDiskWriteSummary({
          outputDir: data.resolvedOutputDir,
          foldersCount: data.manifest?.folders?.length || clusters.length,
          writtenFilesCount: data.writtenFilesCount || items.length,
        });
        const msg = `Organized ${data.writtenFilesCount} files into ${data.manifest?.folders?.length || clusters.length} folders at ${data.resolvedOutputDir}.`;
        setStatusMsg(msg);
        onNotify?.(msg);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Disk folder export failed.');
      } finally {
        setIsExporting(false);
      }
      return;
    }

    if (typeof (window as any).showDirectoryPicker !== 'function') {
      setErrorMsg('Direct folder picker is unavailable here — use "Download All Folders (.ZIP)" instead.');
      return;
    }

    setIsExporting(true);
    setErrorMsg(null);
    try {
      const rootHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      const manifest = buildClassificationManifest(clusters, profileById);

      for (const folder of manifest.folders) {
        const folderHandle = await rootHandle.getDirectoryHandle(folder.folderName, {
          create: true,
        });
        const deduped = resolveUniqueFilenames(
          folder.files.map((f) => ({
            imageId: f.imageId,
            filename: f.originalFilename,
          }))
        );

        for (const entry of deduped) {
          const item = itemById.get(entry.imageId);
          if (!item) continue;
          const blob = await fetchItemBlob(item);
          const fileHandle = await folderHandle.getFileHandle(entry.safeFilename, {
            create: true,
          });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        }
      }

      const manifestHandle = await rootHandle.getFileHandle('classification_manifest.json', {
        create: true,
      });
      const manifestWritable = await manifestHandle.createWritable();
      await manifestWritable.write(JSON.stringify(manifest, null, 2));
      await manifestWritable.close();

      const msg = `Saved ${manifest.uniqueHumansCount} unique human folders directly to disk!`;
      setStatusMsg(msg);
      onNotify?.(msg);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorMsg(err?.message || 'Failed writing folders to selected directory.');
      }
    } finally {
      setIsExporting(false);
    }
  };

  const progressPct =
    progressCounts.total > 0
      ? Math.min(100, Math.round((progressCounts.done / progressCounts.total) * 100))
      : 0;

  return (
    <div className="space-y-6">
      {/* Hidden Folder & Multi-File Pickers */}
      <input
        ref={(el) => {
          folderInputRef.current = el;
          if (el) {
            el.setAttribute('webkitdirectory', '');
            el.setAttribute('directory', '');
          }
        }}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            ingestFiles(e.target.files, 'Uploaded Folder', false);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            ingestFiles(e.target.files, 'Selected Images', items.length > 0);
          }
          e.target.value = '';
        }}
      />

      {/* Top Intake & Classification Workbench */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          if (!isDraggingFiles) setIsDraggingFiles(true);
        }}
        onDragLeave={() => setIsDraggingFiles(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingFiles(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            setIntakeMode('browser');
            ingestFiles(e.dataTransfer.files, 'Dropped Batch', false);
          }
        }}
        className={`bg-white dark:bg-[#111318] border rounded-2xl p-6 sm:p-8 transition-colors ${
          isDraggingFiles
            ? 'border-blue-600 ring-2 ring-blue-600/20'
            : 'border-zinc-200 dark:border-zinc-800'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-6">
          <div className="max-w-2xl">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-zinc-950 dark:text-zinc-50 tracking-tight leading-[1.15] [text-wrap:balance]">
              Classify humans by facial structure &amp; body proportions.
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mt-2">
              Drop up to 200+ random photos or point to a disk directory. AI Vision analyzes cranial geometry, jawline, cheekbones, and somatic proportions, then outputs each unique individual into a dedicated folder.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Classifier Input Mode"
            className="grid grid-cols-2 sm:inline-flex items-center p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl shrink-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={intakeMode === 'browser'}
              onClick={() => setIntakeMode('browser')}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setIntakeMode('disk');
                }
              }}
              className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                intakeMode === 'browser'
                  ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
              }`}
            >
              <ImagePlus className="w-3.5 h-3.5 shrink-0" />
              <span>Upload / Drop Batch</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={intakeMode === 'disk'}
              onClick={() => setIntakeMode('disk')}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setIntakeMode('browser');
                }
              }}
              className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                intakeMode === 'disk'
                  ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
              }`}
            >
              <FolderInput className="w-3.5 h-3.5 shrink-0" />
              <span>Disk Directory Path</span>
            </button>
          </div>
        </div>

        {/* Mode A: Upload / Drop 100+ Random Images */}
        {intakeMode === 'browser' && (
          <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => filesInputRef.current?.click()}
                  disabled={isClassifying}
                  className="flex items-center gap-2 px-4 py-2.5 bg-zinc-950 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-950 disabled:opacity-45 rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ImagePlus className="w-4 h-4 shrink-0" />
                  <span>{items.length > 0 ? 'Add More Images' : 'Select Images (100+)'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isClassifying}
                  className="flex items-center gap-2 px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 shrink-0 text-zinc-500" />
                  <span>Open Folder</span>
                </button>

                <button
                  type="button"
                  onClick={handleLoadSampleBatch}
                  disabled={isClassifying}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500/60 text-zinc-700 dark:text-zinc-300 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span>Load Sample Portraits (6)</span>
                </button>
              </div>

              {/* Folder naming preference + Primary AI Trigger */}
              <div className="flex flex-wrap items-center gap-2.5">
                <div
                  role="group"
                  aria-label="Output Folder Naming"
                  className="inline-flex items-center p-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs"
                >
                  <button
                    type="button"
                    onClick={() => handleNamingModeSwitch('indexed')}
                    className={`px-2.5 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors cursor-pointer ${
                      folderNamingMode === 'indexed'
                        ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    person_01
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNamingModeSwitch('descriptive')}
                    className={`px-2.5 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors cursor-pointer ${
                      folderNamingMode === 'descriptive'
                        ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    person_01_structure
                  </button>
                </div>

                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={handleRunBrowserClassification}
                    disabled={isClassifying}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isClassifying ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Classifying...</span>
                      </>
                    ) : (
                      <>
                        <Users className="w-4 h-4 shrink-0" />
                        <span className="tabular-nums">
                          Classify {items.length} Image{items.length === 1 ? '' : 's'} with AI
                        </span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {items.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                <span>
                  Batch: <strong className="text-zinc-900 dark:text-zinc-100">{sourceLabel}</strong> ·{' '}
                  {items.length} image{items.length === 1 ? '' : 's'} queued
                </span>
                <button
                  type="button"
                  onClick={() => {
                    clearRevokableUrls();
                    setItems([]);
                    resetClassificationState();
                    setStatusMsg(null);
                  }}
                  disabled={isClassifying}
                  className="inline-flex items-center gap-1 text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 font-sans font-medium cursor-pointer disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Batch</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Mode B: Disk Directory Path Scanner + Auto-Classifier */}
        {intakeMode === 'disk' && (
          <form
            onSubmit={handleRunDiskClassification}
            className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80 space-y-3"
          >
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-400">
                  <FolderInput className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={diskPathInput}
                  onChange={(e) => setDiskPathInput(e.target.value)}
                  placeholder="/path/to/100-random-images or ./public/samples/humans"
                  className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl font-mono text-xs sm:text-sm text-zinc-950 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <button
                type="submit"
                disabled={isClassifying || !diskPathInput.trim()}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isClassifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Classifying Directory...</span>
                  </>
                ) : (
                  <>
                    <Users className="w-4 h-4" />
                    <span>Scan &amp; Classify Directory</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-600 dark:text-zinc-400">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={diskRecursive}
                  onChange={(e) => setDiskRecursive(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-600"
                />
                <span>Include subdirectories recursively (up to 250 images)</span>
              </label>

              <button
                type="button"
                onClick={() => setDiskPathInput('./public/samples/humans')}
                className="text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
              >
                Fill sample folder path (./public/samples/humans)
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Live Progress Bar */}
      {isClassifying && (
        <section className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-zinc-950 dark:text-white">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400 shrink-0" />
              <span>{progressStage || 'Processing images...'}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                {progressCounts.done} / {progressCounts.total} ({progressPct}%)
              </span>
              <button
                type="button"
                onClick={() => abortControllerRef.current?.abort()}
                className="px-2.5 py-1 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
          <div className="h-2 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${Math.max(4, progressPct)}%` }}
            />
          </div>
        </section>
      )}

      {/* Error & Status Feedback */}
      {errorMsg && (
        <div className="px-4 py-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/80 text-rose-900 dark:text-rose-200 text-xs sm:text-sm font-medium rounded-xl flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          <span className="flex-1">{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-xs underline hover:no-underline shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {statusMsg && (
        <div className="px-4 py-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-200 text-xs sm:text-sm font-medium rounded-xl flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="flex-1">{statusMsg}</span>
        </div>
      )}

      {diskWriteSummary && (
        <div className="px-4 py-3 bg-zinc-50 dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-mono text-zinc-700 dark:text-zinc-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            Wrote {diskWriteSummary.writtenFilesCount} files across{' '}
            {diskWriteSummary.foldersCount} folders into{' '}
            <strong className="text-zinc-950 dark:text-white">{diskWriteSummary.outputDir}</strong>
          </span>
        </div>
      )}

      {/* Empty State Overview before any images are loaded */}
      {items.length === 0 && !isClassifying && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col justify-between gap-3">
            <div>
              <div className="text-xs font-mono text-zinc-400 dark:text-zinc-500">01.</div>
              <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white mt-1.5">
                Facial &amp; Cranial Structure
              </h3>
              <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                Extracts face shape, jawline contour, cheekbone prominence, forehead height, brow-eye geometry, and nasal bridge independent of lighting or outfits.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLoadSampleBatch}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
            >
              Load 6 Sample Portraits &rarr;
            </button>
          </div>

          <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col justify-between gap-3">
            <div>
              <div className="text-xs font-mono text-zinc-400 dark:text-zinc-500">02.</div>
              <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white mt-1.5">
                Somatic Body Proportions
              </h3>
              <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                Evaluates somatotype, shoulder-to-hip taper, limb-to-torso ratios, and overall frame so even angled or three-quarter shots stay linked accurately.
              </p>
            </div>
            <button
              type="button"
              onClick={() => filesInputRef.current?.click()}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
            >
              Select Random Image Batch &rarr;
            </button>
          </div>

          <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col justify-between gap-3">
            <div>
              <div className="text-xs font-mono text-zinc-400 dark:text-zinc-500">03.</div>
              <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white mt-1.5">
                One Unique Folder per Human
              </h3>
              <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                Rename, merge, or split folders in the explorer, then download a structured ZIP archive or write person_01/, person_02/ directories straight to disk.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIntakeMode('disk')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
            >
              Use Disk Directory Path &rarr;
            </button>
          </div>
        </section>
      )}

      {/* Unclassified Contact Sheet (when images loaded, before running AI) */}
      {items.length > 0 && clusters.length === 0 && (
        <section className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-zinc-950 dark:text-white">
                Queued Input Images ({items.length})
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Click &ldquo;Classify {items.length} Image{items.length === 1 ? '' : 's'} with AI&rdquo; above to group each unique individual into separate folders.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 max-h-[420px] overflow-y-auto pr-1">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-50 dark:bg-[#0B0C10]"
              >
                <div className="aspect-[3/4] bg-zinc-100 dark:bg-zinc-950 overflow-hidden">
                  <img
                    src={item.previewUrl}
                    alt={item.filename}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="px-2.5 py-2 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 truncate">
                  {item.filename}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Classified Output Workbench: Left Folder Tree + Right Person Inspector */}
      {clusters.length > 0 && activeCluster && (
        <div className="space-y-5">
          {/* Global Export Toolbar */}
          <section className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h2 className="font-display text-lg font-bold text-zinc-950 dark:text-white">
                Classified Output Folders
              </h2>
              <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums flex-wrap">
                <span>
                  <strong className="text-zinc-900 dark:text-zinc-100">{uniqueHumanCount}</strong> unique human{uniqueHumanCount === 1 ? '' : 's'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <strong className="text-zinc-900 dark:text-zinc-100">{items.length}</strong> total images sorted
                </span>
                <span aria-hidden="true">·</span>
                <span>{clusters.length} folder{clusters.length === 1 ? '' : 's'} ready</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {intakeMode === 'disk' && diskScannedRoot && (
                <input
                  type="text"
                  value={diskOutputDir}
                  onChange={(e) => setDiskOutputDir(e.target.value)}
                  placeholder="Output directory path..."
                  aria-label="Disk output directory path"
                  className="px-3 py-2 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl font-mono text-xs text-zinc-900 dark:text-zinc-100 w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              )}

              {(canDirectSaveToFolder || (intakeMode === 'disk' && diskScannedRoot)) && (
                <button
                  type="button"
                  onClick={handleSaveToLocalFolders}
                  disabled={isExporting}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45"
                >
                  <FolderDown className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
                  <span>
                    {intakeMode === 'disk' ? 'Write Folders to Disk' : 'Save Folders to Disk'}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleExportAllZip()}
                disabled={isExporting}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Packaging ZIP...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Download All Folders (.ZIP)</span>
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Split-Pane Folder Tree & Image Inspector */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT SIDEBAR: Identity Folders */}
            <aside className="lg:col-span-4 bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3.5 border-b border-zinc-200/80 dark:border-zinc-800/80 flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Identity Folders
                </span>
                <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                  {clusters.length} total
                </span>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70 max-h-[600px] overflow-y-auto">
                {clusters.map((cluster) => {
                  const isActive = cluster.clusterId === activeCluster.clusterId;
                  const coverItem = itemById.get(cluster.imageIds[0]);

                  return (
                    <button
                      key={cluster.clusterId}
                      type="button"
                      onClick={() => {
                        setActiveClusterId(cluster.clusterId);
                        setEditingClusterId(null);
                      }}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-blue-50/70 dark:bg-blue-950/25'
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60'
                      }`}
                    >
                      <div className="w-11 h-11 rounded-lg bg-zinc-100 dark:bg-zinc-900 overflow-hidden shrink-0 border border-zinc-200/70 dark:border-zinc-800 flex items-center justify-center">
                        {coverItem ? (
                          <img
                            src={coverItem.previewUrl}
                            alt={cluster.folderName}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : cluster.isNonHuman ? (
                          <UserX className="w-4 h-4 text-zinc-400" />
                        ) : (
                          <UserCheck className="w-4 h-4 text-zinc-400" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-xs font-mono font-semibold truncate ${
                              isActive
                                ? 'text-blue-700 dark:text-blue-400'
                                : 'text-zinc-950 dark:text-zinc-100'
                            }`}
                          >
                            {cluster.folderName}/
                          </span>
                          <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
                            {cluster.imageIds.length}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                          {cluster.isNonHuman
                            ? 'Filtered non-human frames'
                            : `${cluster.dominantFaceShape} face · ${cluster.dominantSomatotype}`}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* RIGHT STAGE: Active Folder Details & Images */}
            <div className="lg:col-span-8 bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 sm:p-6 space-y-5">
              {/* Folder Header + Rename / Merge / Single ZIP */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-200/80 dark:border-zinc-800/80">
                <div className="min-w-0">
                  {editingClusterId === activeCluster.clusterId ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCommitRename(activeCluster.clusterId);
                          if (e.key === 'Escape') setEditingClusterId(null);
                        }}
                        aria-label="New folder name"
                        autoFocus
                        className="px-2.5 py-1 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-300 dark:border-zinc-700 rounded-lg font-mono text-sm text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      <button
                        type="button"
                        onClick={() => handleCommitRename(activeCluster.clusterId)}
                        aria-label="Save folder name"
                        className="p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingClusterId(null)}
                        aria-label="Cancel rename"
                        className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-lg font-bold text-zinc-950 dark:text-white font-mono truncate">
                        {activeCluster.folderName}/
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingClusterId(activeCluster.clusterId);
                          setRenameDraft(activeCluster.folderName);
                        }}
                        title="Rename output folder"
                        aria-label="Rename output folder"
                        className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 tabular-nums">
                    {activeCluster.imageIds.length} image{activeCluster.imageIds.length === 1 ? '' : 's'}
                    <span aria-hidden="true"> · </span>
                    Confidence {Math.round(activeCluster.confidence * 100)}%
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {clusters.length > 1 && (
                    <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                      <Merge className="w-3.5 h-3.5 text-zinc-400" />
                      <select
                        aria-label="Merge this folder into another folder"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) handleMergeActiveInto(e.target.value);
                        }}
                        className="px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer"
                      >
                        <option value="">Merge into...</option>
                        {clusters
                          .filter((c) => c.clusterId !== activeCluster.clusterId)
                          .map((target) => (
                            <option key={target.clusterId} value={target.clusterId}>
                              {target.folderName}/ ({target.imageIds.length})
                            </option>
                          ))}
                      </select>
                    </label>
                  )}

                  <button
                    type="button"
                    onClick={() => handleExportAllZip(activeCluster)}
                    disabled={isExporting}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Folder ZIP</span>
                  </button>
                </div>
              </div>

              {/* Facial Structure & Body Proportions Summary */}
              {!activeCluster.isNonHuman && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-zinc-50/70 dark:bg-[#0B0C10] border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-4">
                  <div>
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                      Facial Structure Profile
                    </div>
                    <div className="text-zinc-600 dark:text-zinc-400 mt-1 space-y-0.5">
                      <div>
                        Shape: <strong className="text-zinc-800 dark:text-zinc-200">{activeCluster.dominantFaceShape}</strong>
                        {' · '}
                        Jawline: {profileById.get(activeCluster.imageIds[0])?.facialStructure.jawline || 'balanced'}
                      </div>
                      <div>
                        Cheekbones: {profileById.get(activeCluster.imageIds[0])?.facialStructure.cheekbones || 'balanced'}
                        {' · '}
                        Nose: {profileById.get(activeCluster.imageIds[0])?.facialStructure.noseStructure || 'balanced'}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                      Body Proportions Profile
                    </div>
                    <div className="text-zinc-600 dark:text-zinc-400 mt-1 space-y-0.5">
                      <div>
                        Somatotype: <strong className="text-zinc-800 dark:text-zinc-200">{activeCluster.dominantSomatotype}</strong>
                        {' · '}
                        Shoulders/Hip: {profileById.get(activeCluster.imageIds[0])?.bodyProportions.shoulderToHipRatio || 'balanced'}
                      </div>
                      <div className="truncate" title={activeCluster.matchRationale}>
                        {activeCluster.matchRationale}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Images inside this Identity Folder */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {activeCluster.imageIds.map((imgId) => {
                  const item = itemById.get(imgId);
                  const prof = profileById.get(imgId);
                  if (!item) return null;

                  return (
                    <article
                      key={imgId}
                      className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0C10] overflow-hidden flex flex-col"
                    >
                      <div className="aspect-[3/4] bg-zinc-100 dark:bg-zinc-950 overflow-hidden">
                        <img
                          src={item.previewUrl}
                          alt={item.filename}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="p-3 space-y-2 flex-1 flex flex-col justify-between">
                        <div>
                          <div
                            className="text-xs font-mono font-semibold text-zinc-900 dark:text-zinc-100 truncate"
                            title={item.relativePath}
                          >
                            {item.filename}
                          </div>
                          {prof && (
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">
                              {prof.hasHuman
                                ? `${prof.facialStructure.faceShape} face · ${prof.bodyProportions.somatotype} (${Math.round(prof.confidence * 100)}%)`
                                : 'No clear human subject'}
                            </div>
                          )}
                        </div>

                        <label className="flex items-center gap-1.5 pt-1 border-t border-zinc-200/60 dark:border-zinc-800/70 text-[11px] text-zinc-500 dark:text-zinc-400">
                          <ArrowRightLeft className="w-3 h-3 shrink-0" />
                          <select
                            aria-label={`Move ${item.filename} to another folder`}
                            value={activeCluster.clusterId}
                            onChange={(e) => handleMoveImage(imgId, e.target.value)}
                            className="flex-1 min-w-0 bg-transparent text-zinc-700 dark:text-zinc-300 font-medium focus:outline-none cursor-pointer truncate"
                          >
                            {clusters.map((c) => (
                              <option key={c.clusterId} value={c.clusterId}>
                                {c.folderName}/
                              </option>
                            ))}
                            <option value="__new__">+ New Person Folder</option>
                          </select>
                        </label>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
