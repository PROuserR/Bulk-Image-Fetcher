'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { MotionConfig } from 'motion/react';
import { Header, WorkspaceTabId } from './components/Header';
import { StudioSidebar } from './components/StudioSidebar';
import { BentoShowcase } from './components/BentoShowcase';
import {
  ScraperControls,
  ExtractorMode,
  NestedDiscoverOptions,
} from './components/ScraperControls';
import {
  NestedGalleryQueue,
  NestedCrawlProgressState,
} from './components/NestedGalleryQueue';
import { GalleryView } from './components/GalleryView';
import { FolderGalleryStudio } from './components/FolderGalleryStudio';
import { CropResizeStudio } from './components/CropResizeStudio';
import { FilterStudio } from './components/FilterStudio';
import { GifMakerStudio } from './components/GifMakerStudio';
import { HumanClassifierStudio } from './components/HumanClassifierStudio';
import { GemmaStudio } from './components/GemmaStudio';
import { DeploymentDocs } from './components/DeploymentDocs';
import { LightboxModal } from './components/LightboxModal';
import { CommandPalette } from './components/CommandPalette';
import { ChecksumVerifierModal } from './components/ChecksumVerifierModal';
import {
  ScrapedImage,
  FaceScanResult,
  isBlankOrPlaceholderUrl,
} from './utils/scraperLogic';
import {
  DiscoveredGallery,
  NestedGallerySummary,
  NestedGalleryRunInput,
  mergeNestedGalleryResults,
} from './utils/nestedGalleryLogic';
import { SAMPLE_PRESETS } from './utils/samplePages';
import {
  ArchiveFormat,
  DEFAULT_ARCHIVE_FORMAT,
  triggerBlobDownload,
  triggerTextDownload,
} from './utils/downloader';
import {
  downloadCompressedArchiveWithProgress,
  formatArchiveStatusLine,
  cleanupStagedArchiveToken,
  ArchiveDownloadProgress,
  ResumableArchiveState,
} from './utils/archiveDownloader';
import {
  runProgressiveDownloads,
  ProgressiveDownloadProgress,
  DownloadItemInput,
} from './utils/progressiveDownloader';
import {
  buildChecksumManifestFilename,
  formatArchiveSidecarSha256Text,
  formatSha256SumsText,
  type ChecksumEntry,
} from './utils/checksumUtils';
import type { ArchiveChecksumMeta } from './components/ChecksumVerifierModal';
import { ProgressiveDownloadBar } from './components/ProgressiveDownloadBar';
import { ArchiveDownloadBar } from './components/ArchiveDownloadBar';
import { fetchApiJson } from './utils/safeFetchJson';
import { tryCaptureBrowserPreviewDataUrl } from './utils/clientImageCache';
import { loadCustomLlmSettings } from './utils/customLlmConfig';
import {
  ensureImageDataUrlInBrowser,
  scanHumanFaceWithCustomLlm,
} from './utils/customLlmClient';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

const PAUSED_DIRECT_STORAGE_KEY = 'fullres_paused_direct_v1';
const PAUSED_ARCHIVE_STORAGE_KEY = 'fullres_paused_archive_v1';

function compactImageForStorage(img: ScrapedImage): ScrapedImage {
  return {
    id: img.id,
    thumbnailUrl: img.thumbnailUrl,
    fullUrl: img.fullUrl,
    fallbackUrl: img.fallbackUrl,
    linkedPageUrl: img.linkedPageUrl,
    altText: img.altText,
    filename: img.filename,
    format: img.format,
    isUnshrunk: img.isUnshrunk,
    unshrinkMethod: img.unshrinkMethod || 'Direct URL',
    resolutionTier: img.resolutionTier,
    galleryId: img.galleryId,
    galleryTitle: img.galleryTitle,
    galleryUrl: img.galleryUrl,
  };
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [themeHydrated, setThemeHydrated] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('scraper');
  const [visitedTabs, setVisitedTabs] = useState<Set<WorkspaceTabId>>(() => new Set(['scraper']));
  const [hasOpenedCommandPalette, setHasOpenedCommandPalette] = useState<boolean>(false);
  const [cropSeedImages, setCropSeedImages] = useState<ScrapedImage[]>([]);
  const [filterSeedImages, setFilterSeedImages] = useState<ScrapedImage[]>([]);
  const [gifSeedImages, setGifSeedImages] = useState<ScrapedImage[]>([]);
  const [classifierSeedImages, setClassifierSeedImages] = useState<ScrapedImage[]>([]);
  const [gemmaSeedImages, setGemmaSeedImages] = useState<ScrapedImage[]>([]);
  const [images, setImages] = useState<ScrapedImage[]>([]);
  const [pageTitle, setPageTitle] = useState<string>('');
  const [sourceUrl, setSourceUrl] = useState<string>('');
  const [unshrunkCount, setUnshrunkCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<ScrapedImage | null>(null);
  const [isDownloadingZip, setIsDownloadingZip] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);
  const [archiveProgress, setArchiveProgress] = useState<ArchiveDownloadProgress | null>(null);
  const [archiveFormat, setArchiveFormat] = useState<ArchiveFormat>(DEFAULT_ARCHIVE_FORMAT);
  const [isExportingZip, setIsExportingZip] = useState<boolean>(false);
  const [relayUrl, setRelayUrl] = useState<string>('');
  const [isGeoBlocked, setIsGeoBlocked] = useState<boolean>(false);
  const [geoNotice, setGeoNotice] = useState<string | null>(null);
  const [instagramSession, setInstagramSession] = useState<string>('');
  const [instagramMaxPosts, setInstagramMaxPosts] = useState<number>(200);
  const [isInstagramLoginRequired, setIsInstagramLoginRequired] = useState<boolean>(false);
  const [requestedMode, setRequestedMode] = useState<ExtractorMode | null>(null);
  const [nestedDiscovery, setNestedDiscovery] = useState<{
    parentUrl: string;
    parentTitle: string;
    galleries: DiscoveredGallery[];
    followLinkedPages: boolean;
  } | null>(null);
  const [selectedNestedIds, setSelectedNestedIds] = useState<Set<string>>(new Set());
  const [isDiscoveringNested, setIsDiscoveringNested] = useState<boolean>(false);
  const [nestedCrawlProgress, setNestedCrawlProgress] = useState<NestedCrawlProgressState>({
    isCrawling: false,
    completedCount: 0,
    totalCount: 0,
    extractedImagesCount: 0,
    statusById: {},
  });
  const [nestedSummaries, setNestedSummaries] = useState<NestedGallerySummary[]>([]);
  const [instagramContinuation, setInstagramContinuation] = useState<{
    profileUrl: string;
    userId?: string;
    nextCursor?: string;
    nextMaxId?: string;
    hasMore: boolean;
    totalProfilePosts?: number;
  } | null>(null);
  const [isLoadingMorePosts, setIsLoadingMorePosts] = useState<boolean>(false);
  const [progressiveState, setProgressiveState] = useState<ProgressiveDownloadProgress | null>(null);
  const [progressiveModeLabel, setProgressiveModeLabel] = useState<string>('Progressive Direct Save');
  const [faceScanMap, setFaceScanMap] = useState<Record<string, FaceScanResult>>({});
  const [faceScanStatus, setFaceScanStatus] = useState<{
    isScanning: boolean;
    scanned: number;
    total: number;
    error: string | null;
  }>({ isScanning: false, scanned: 0, total: 0, error: null });
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [checksumModalState, setChecksumModalState] = useState<{
    isOpen: boolean;
    images: ScrapedImage[];
    initialEntries?: ChecksumEntry[];
    archiveMeta?: ArchiveChecksumMeta | null;
    initialTab: 'manifest' | 'verify';
  } | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const directSaveAbortRef = useRef<AbortController | null>(null);
  const archiveAbortRef = useRef<AbortController | null>(null);
  const faceScanAbortRef = useRef<AbortController | null>(null);
  const faceScanMapRef = useRef<Record<string, FaceScanResult>>({});
  const lastDirectSaveImagesRef = useRef<ScrapedImage[]>([]);
  const lastArchiveImagesRef = useRef<ScrapedImage[]>([]);
  const pausedDirectContextRef = useRef<{
    images: ScrapedImage[];
    sourceUrl: string;
    relayUrl: string;
    directoryHandle?: any;
    modeLabel: string;
  } | null>(null);
  const pausedArchiveResumeRef = useRef<ResumableArchiveState | null>(null);
  const pausedArchiveContextRef = useRef<{
    images: ScrapedImage[];
    pageTitle: string;
    sourceUrl: string;
    relayUrl: string;
    format: ArchiveFormat;
  } | null>(null);
  const nestedAbortRef = useRef<AbortController | null>(null);
  const discoverNestedRef = useRef<
    ((url: string, options: NestedDiscoverOptions) => Promise<void>) | null
  >(null);

  useEffect(() => {
    faceScanMapRef.current = faceScanMap;
  }, [faceScanMap]);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setSuccessToast(message);
    toastTimerRef.current = setTimeout(() => {
      setSuccessToast(null);
      toastTimerRef.current = null;
    }, 4000);
  }, []);

  const clearPersistedDirectPause = useCallback(() => {
    try {
      localStorage.removeItem(PAUSED_DIRECT_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  }, []);

  const persistDirectPause = useCallback(
    (
      progress: ProgressiveDownloadProgress,
      targetImages: ScrapedImage[],
      srcUrl: string,
      rUrl: string,
      modeLabel: string
    ) => {
      try {
        localStorage.setItem(
          PAUSED_DIRECT_STORAGE_KEY,
          JSON.stringify({
            progress,
            images: targetImages.slice(0, 600).map(compactImageForStorage),
            sourceUrl: srcUrl,
            relayUrl: rUrl,
            modeLabel,
          })
        );
      } catch {
        // ignore quota errors
      }
    },
    []
  );

  const clearPersistedArchivePause = useCallback(() => {
    try {
      localStorage.removeItem(PAUSED_ARCHIVE_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  }, []);

  const persistArchivePause = useCallback(
    (
      snapshot: ResumableArchiveState,
      ctx: {
        images: ScrapedImage[];
        pageTitle: string;
        sourceUrl: string;
        relayUrl: string;
        format: ArchiveFormat;
      }
    ) => {
      try {
        localStorage.setItem(
          PAUSED_ARCHIVE_STORAGE_KEY,
          JSON.stringify({
            snapshot: {
              token: snapshot.token,
              filename: snapshot.filename,
              format: snapshot.format,
              contentType: snapshot.contentType,
              totalBytes: snapshot.totalBytes,
              bytesLoaded: snapshot.bytesLoaded,
              fileCount: snapshot.fileCount,
              percent: snapshot.percent,
              fetchedImages: snapshot.fetchedImages,
              validImages: snapshot.validImages,
              totalImages: snapshot.totalImages,
            },
            context: {
              images: ctx.images.slice(0, 600).map(compactImageForStorage),
              pageTitle: ctx.pageTitle,
              sourceUrl: ctx.sourceUrl,
              relayUrl: ctx.relayUrl,
              format: ctx.format,
            },
          })
        );
      } catch {
        // ignore quota errors
      }
    },
    []
  );

  const handleClearCropSeed = useCallback(() => {
    setCropSeedImages([]);
  }, []);

  const handleClearFilterSeed = useCallback(() => {
    setFilterSeedImages([]);
  }, []);

  const handleClearGifSeed = useCallback(() => {
    setGifSeedImages([]);
  }, []);

  const handleClearClassifierSeed = useCallback(() => {
    setClassifierSeedImages([]);
  }, []);

  const handleClearGemmaSeed = useCallback(() => {
    setGemmaSeedImages([]);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      nestedAbortRef.current?.abort();
      archiveAbortRef.current?.abort();
      directSaveAbortRef.current?.abort();
      faceScanAbortRef.current?.abort();
    };
  }, []);

  const markTabVisited = useCallback((tab: WorkspaceTabId) => {
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, []);

  const handleSelectTab = useCallback(
    (nextTab: WorkspaceTabId) => {
      markTabVisited(nextTab);
      setActiveTab(nextTab);
      try {
        const nextUrl = new URL(window.location.href);
        if (nextTab === 'scraper') {
          nextUrl.searchParams.delete('tab');
        } else {
          nextUrl.searchParams.set('tab', nextTab);
        }
        if (nextUrl.toString() !== window.location.href) {
          window.history.pushState({ tab: nextTab }, '', nextUrl.toString());
        }
      } catch {
        // ignore history errors inside sandboxed iframes
      }
    },
    [markTabVisited]
  );

  // Resolve persisted/system theme and initial URL ?tab= on client mount
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTab = params.get('tab');
      if (
        urlTab === 'scraper' ||
        urlTab === 'gallery' ||
        urlTab === 'crop' ||
        urlTab === 'filters' ||
        urlTab === 'gif' ||
        urlTab === 'classifier' ||
        urlTab === 'gemma' ||
        urlTab === 'docs'
      ) {
        markTabVisited(urlTab);
        setActiveTab(urlTab);
      }
    } catch {
      // ignore URL parsing errors
    }

    const onPopState = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const urlTab = params.get('tab');
        if (
          urlTab === 'gallery' ||
          urlTab === 'crop' ||
          urlTab === 'filters' ||
          urlTab === 'gif' ||
          urlTab === 'classifier' ||
          urlTab === 'gemma' ||
          urlTab === 'docs'
        ) {
          markTabVisited(urlTab);
          setActiveTab(urlTab);
        } else {
          setActiveTab('scraper');
        }
      } catch {
        setActiveTab('scraper');
      }
    };
    window.addEventListener('popstate', onPopState);

    try {
      const stored = localStorage.getItem('theme');
      if (stored === 'light' || stored === 'dark') {
        setTheme(stored);
      } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        setTheme('dark');
      }
    } catch {
      // ignore storage restrictions
    }

    // Restore any paused downloads saved from earlier session
    try {
      const savedDirectRaw = localStorage.getItem(PAUSED_DIRECT_STORAGE_KEY);
      if (savedDirectRaw) {
        const parsed = JSON.parse(savedDirectRaw);
        if (
          parsed?.progress?.isPaused &&
          Array.isArray(parsed?.images) &&
          parsed.images.length > 0 &&
          parsed.progress.saved < parsed.progress.total
        ) {
          lastDirectSaveImagesRef.current = parsed.images;
          pausedDirectContextRef.current = {
            images: parsed.images,
            sourceUrl: parsed.sourceUrl || '',
            relayUrl: parsed.relayUrl || '',
            modeLabel: parsed.modeLabel || 'Progressive Direct Save',
          };
          setProgressiveModeLabel(parsed.modeLabel || 'Progressive Direct Save');
          setProgressiveState({
            ...parsed.progress,
            isRunning: false,
            isPaused: true,
            isCancelled: false,
            currentItems: [],
            activeCount: 0,
          });
        } else {
          localStorage.removeItem(PAUSED_DIRECT_STORAGE_KEY);
        }
      }
    } catch {
      // ignore storage errors
    }

    try {
      const savedArchiveRaw = localStorage.getItem(PAUSED_ARCHIVE_STORAGE_KEY);
      if (savedArchiveRaw) {
        const parsed = JSON.parse(savedArchiveRaw);
        if (
          parsed?.snapshot &&
          parsed?.context?.images &&
          Array.isArray(parsed.context.images) &&
          parsed.context.images.length > 0
        ) {
          const snap = parsed.snapshot;
          const ctx = parsed.context;
          pausedArchiveResumeRef.current = {
            token: snap.token,
            filename: snap.filename,
            format: snap.format || '7z',
            contentType: snap.contentType || 'application/x-7z-compressed',
            totalBytes: snap.totalBytes,
            bytesLoaded: 0,
            fileCount: snap.fileCount || ctx.images.length,
            receivedChunks: [],
            percent: snap.percent || 0,
            fetchedImages: snap.fetchedImages || 0,
            validImages: snap.validImages || 0,
            totalImages: snap.totalImages || ctx.images.length,
          };
          pausedArchiveContextRef.current = ctx;
          setArchiveProgress({
            format: snap.format || '7z',
            filename: snap.filename,
            stage: 'paused',
            percent: snap.percent || 0,
            fetchedImages: snap.fetchedImages || 0,
            validImages: snap.validImages || 0,
            totalImages: snap.totalImages || ctx.images.length,
            bytesLoaded: 0,
            bytesTotal: snap.totalBytes,
            isRunning: false,
            isPaused: true,
            message: `Paused .${String(snap.format || '7z').toUpperCase()} download (${snap.percent || 0}%) · Ready to resume`,
          });
        } else {
          localStorage.removeItem(PAUSED_ARCHIVE_STORAGE_KEY);
        }
      }
    } catch {
      // ignore storage errors
    }

    setThemeHydrated(true);

    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // Sync theme with document element after initial client hydration
  useEffect(() => {
    if (!themeHydrated) return;
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // ignore storage restrictions
    }
  }, [theme, themeHydrated]);

  // Global Cmd/Ctrl+K command palette + 1-7 studio switcher shortcuts
  useEffect(() => {
    const tabByKey: Record<string, WorkspaceTabId> = {
      '1': 'scraper',
      '2': 'gallery',
      '3': 'crop',
      '4': 'filters',
      '5': 'gif',
      '6': 'classifier',
      '7': 'gemma',
      '8': 'docs',
    };
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setHasOpenedCommandPalette(true);
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }
      const target = e.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      const mapped = tabByKey[e.key];
      if (mapped) {
        handleSelectTab(mapped);
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [handleSelectTab]);

  const applyScrapeResponse = useCallback(
    (data: any, fallbackUrl: string, successLabel?: string) => {
      const nextImages: ScrapedImage[] = data.images || [];
      setImages(nextImages);
      setPageTitle(data.pageTitle || fallbackUrl);
      setSourceUrl(data.url || fallbackUrl);
      setUnshrunkCount(data.stats?.unshrunkCount || 0);
      setIsGeoBlocked(Boolean(data.geoBlocked));
      setGeoNotice(data.notice || null);
      if (data.sessionExpired || data.loginRequired) {
        setIsInstagramLoginRequired(true);
      }

      if (data.hasMore && (data.nextCursor || data.nextMaxId)) {
        setInstagramContinuation({
          profileUrl: data.url || fallbackUrl,
          userId: data.userId,
          nextCursor: data.nextCursor,
          nextMaxId: data.nextMaxId,
          hasMore: true,
          totalProfilePosts: data.totalProfilePosts,
        });
      } else {
        setInstagramContinuation(null);
      }

      if (nextImages.length > 0 && !data.sessionExpired) {
        showToast(
          successLabel ||
            `Successfully extracted ${nextImages.length} images (${data.stats?.unshrunkCount || 0} upgraded to master full-res)!`
        );
      }
    },
    [showToast]
  );

  const handleScrape = useCallback(
    async (
      url: string,
      customHtml?: string,
      followLinkedPages?: boolean,
      relayOverride?: string,
      igOptions?: { sessionCookie?: string; maxPosts?: number }
    ) => {
      nestedAbortRef.current?.abort();
      faceScanAbortRef.current?.abort();
      faceScanMapRef.current = {};
      setFaceScanMap({});
      setFaceScanStatus({ isScanning: false, scanned: 0, total: 0, error: null });
      setNestedDiscovery(null);
      setSelectedNestedIds(new Set());
      setNestedSummaries([]);
      setNestedCrawlProgress({
        isCrawling: false,
        completedCount: 0,
        totalCount: 0,
        extractedImagesCount: 0,
        statusById: {},
      });
      setIsLoading(true);
      setErrorMessage(null);
      setGeoNotice(null);
      setIsInstagramLoginRequired(false);

      const effectiveRelay = relayOverride !== undefined ? relayOverride : relayUrl;
      const effectiveSession =
        igOptions?.sessionCookie !== undefined ? igOptions.sessionCookie : instagramSession;
      const effectiveMaxPosts =
        igOptions?.maxPosts !== undefined ? igOptions.maxPosts : instagramMaxPosts;

      try {
        const { ok, data, error } = await fetchApiJson('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            customHtml,
            followLinkedPages: followLinkedPages ?? true,
            relayUrl: effectiveRelay?.trim() || undefined,
            instagramSession: effectiveSession?.trim() || undefined,
            maxPosts: effectiveMaxPosts,
          }),
        });

        if (!ok || !data) {
          if (data?.geoBlocked) setIsGeoBlocked(true);
          if (data?.loginRequired || data?.instagramProfile || /instagram\.com|^@/i.test(url)) {
            setIsInstagramLoginRequired(true);
          }
          throw new Error(data?.error || error || 'Failed to extract images from target webpage.');
        }

        if (
          data.suggestedNestedHub &&
          (data.suggestedNestedCount ?? 0) >= 2 &&
          !customHtml &&
          (followLinkedPages ?? true) &&
          discoverNestedRef.current
        ) {
          setRequestedMode('nested');
          void discoverNestedRef.current(url, {
            sameOriginOnly: true,
            maxGalleries: 30,
            followLinkedPages: true,
            autoScrape: true,
          });
          return;
        }

        applyScrapeResponse(data, url);
      } catch (err: any) {
        setErrorMessage(err.message || 'An unexpected error occurred while scraping.');
      } finally {
        setIsLoading(false);
      }
    },
    [applyScrapeResponse, instagramMaxPosts, instagramSession, relayUrl]
  );

  const crawlNestedGalleries = useCallback(
    async (
      galleriesToCrawl: DiscoveredGallery[],
      parentUrl: string,
      parentTitle: string,
      followLinkedPages: boolean
    ) => {
      if (galleriesToCrawl.length === 0) return;

      nestedAbortRef.current?.abort();
      faceScanAbortRef.current?.abort();
      faceScanMapRef.current = {};
      setFaceScanMap({});
      setFaceScanStatus({ isScanning: false, scanned: 0, total: 0, error: null });
      const abortController = new AbortController();
      nestedAbortRef.current = abortController;

      setErrorMessage(null);
      setGeoNotice(null);
      setIsInstagramLoginRequired(false);
      setInstagramContinuation(null);
      setImages([]);
      setNestedSummaries([]);
      setPageTitle(parentTitle || parentUrl);
      setSourceUrl(parentUrl);
      setUnshrunkCount(0);

      const initialStatuses: NestedCrawlProgressState['statusById'] = {};
      for (const g of galleriesToCrawl) {
        initialStatuses[g.id] = { status: 'queued' };
      }

      setNestedCrawlProgress({
        isCrawling: true,
        completedCount: 0,
        totalCount: galleriesToCrawl.length,
        activeTitle: galleriesToCrawl[0]?.title,
        extractedImagesCount: 0,
        statusById: initialStatuses,
      });

      const runByIndex: (NestedGalleryRunInput | null)[] = new Array(galleriesToCrawl.length).fill(null);
      let completedCount = 0;
      let anyGeoBlocked = false;
      let cursor = 0;

      const worker = async () => {
        while (!abortController.signal.aborted) {
          const idx = cursor++;
          if (idx >= galleriesToCrawl.length) break;

          const gal = galleriesToCrawl[idx];
          setNestedCrawlProgress((prev) => ({
            ...prev,
            activeTitle: gal.title,
            statusById: {
              ...prev.statusById,
              [gal.id]: { status: 'crawling' },
            },
          }));

          try {
            const resp = await fetch('/api/scrape', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: gal.url,
                followLinkedPages,
                relayUrl: relayUrl.trim() || undefined,
              }),
              signal: abortController.signal,
            });

            const data = await resp.json().catch(() => null);

            if (resp.ok && data && Array.isArray(data.images)) {
              if (data.geoBlocked) anyGeoBlocked = true;
              runByIndex[idx] = {
                gallery: gal,
                result: {
                  url: data.url || gal.url,
                  pageTitle: data.pageTitle || gal.title,
                  images: data.images,
                  stats: data.stats || {
                    totalFound: data.images.length,
                    unshrunkCount: 0,
                    formats: {},
                  },
                },
                geoBlocked: Boolean(data.geoBlocked),
              };
            } else {
              if (data?.geoBlocked) anyGeoBlocked = true;
              runByIndex[idx] = {
                gallery: gal,
                result: null,
                error: data?.error || `HTTP ${resp.status}`,
                geoBlocked: Boolean(data?.geoBlocked),
              };
            }
          } catch (err: any) {
            if (abortController.signal.aborted || err?.name === 'AbortError') {
              break;
            }
            runByIndex[idx] = {
              gallery: gal,
              result: null,
              error: err?.message || 'Network failure',
            };
          }

          if (abortController.signal.aborted) break;

          completedCount++;
          const completedRuns = runByIndex.filter(
            (r): r is NestedGalleryRunInput => r !== null
          );
          const merged = mergeNestedGalleryResults(parentUrl, parentTitle, completedRuns);

          setImages(merged.images);
          setPageTitle(merged.pageTitle);
          setSourceUrl(merged.url);
          setUnshrunkCount(merged.stats.unshrunkCount);
          setNestedSummaries(merged.galleries);

          const finishedRun = runByIndex[idx];
          const finishedCount = finishedRun?.result?.images?.length ?? 0;
          setNestedCrawlProgress((prev) => ({
            ...prev,
            completedCount,
            extractedImagesCount: merged.images.length,
            statusById: {
              ...prev.statusById,
              [gal.id]:
                finishedRun && finishedRun.result && !finishedRun.error
                  ? { status: 'completed', count: finishedCount }
                  : {
                      status: 'failed',
                      error: finishedRun?.error || 'Extraction failed',
                    },
            },
          }));
        }
      };

      const concurrency = Math.min(4, galleriesToCrawl.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      if (nestedAbortRef.current === abortController) {
        nestedAbortRef.current = null;
      }

      const finalRuns = runByIndex.filter((r): r is NestedGalleryRunInput => r !== null);
      const finalMerged = mergeNestedGalleryResults(parentUrl, parentTitle, finalRuns);

      setImages(finalMerged.images);
      setPageTitle(finalMerged.pageTitle);
      setSourceUrl(finalMerged.url);
      setUnshrunkCount(finalMerged.stats.unshrunkCount);
      setNestedSummaries(finalMerged.galleries);
      if (anyGeoBlocked) {
        setIsGeoBlocked(true);
      }

      setNestedCrawlProgress((prev) => ({
        ...prev,
        isCrawling: false,
        activeTitle: undefined,
        completedCount,
        extractedImagesCount: finalMerged.images.length,
      }));

      if (abortController.signal.aborted) {
        showToast(
          `Stopped nested crawl (${finalMerged.images.length} images kept from ${finalMerged.stats.completedGalleries} galleries).`
        );
      } else if (finalMerged.images.length > 0) {
        showToast(
          `Extracted ${finalMerged.images.length} full-res images across ${finalMerged.stats.completedGalleries} nested galleries (${finalMerged.stats.unshrunkCount} upgraded to master full-res)!`
        );
      } else {
        setErrorMessage(
          'Could not extract images from the selected child galleries. Try toggling "Follow Linked Detail Webpages" or configuring a Relay URL.'
        );
      }
    },
    [relayUrl, showToast]
  );

  const handleDiscoverNestedGalleries = useCallback(
    async (url: string, options: NestedDiscoverOptions) => {
      nestedAbortRef.current?.abort();
      setIsDiscoveringNested(true);
      setErrorMessage(null);
      setGeoNotice(null);
      setIsInstagramLoginRequired(false);
      setInstagramContinuation(null);

      try {
        const { ok, data, error } = await fetchApiJson('/api/scrape/discover-galleries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            relayUrl: relayUrl.trim() || undefined,
            urlPatternFilter: options.urlPatternFilter || '',
            sameOriginOnly: options.sameOriginOnly,
            maxGalleries: options.maxGalleries,
          }),
        });

        if (!ok || !data) {
          if (data?.geoBlocked) setIsGeoBlocked(true);
          throw new Error(data?.error || error || 'Failed to discover child galleries from webpage.');
        }

        const discovered: DiscoveredGallery[] = data.galleries || [];
        const resolvedParentUrl = data.parentUrl || url;
        const resolvedParentTitle = data.parentTitle || url;

        setNestedDiscovery({
          parentUrl: resolvedParentUrl,
          parentTitle: resolvedParentTitle,
          galleries: discovered,
          followLinkedPages: options.followLinkedPages,
        });
        setSelectedNestedIds(new Set(discovered.map((g) => g.id)));
        setNestedSummaries([]);
        setNestedCrawlProgress({
          isCrawling: false,
          completedCount: 0,
          totalCount: discovered.length,
          extractedImagesCount: 0,
          statusById: {},
        });

        if (discovered.length === 0) {
          setGeoNotice(
            data.notice ||
              'No child gallery URLs were detected on this webpage. Try unchecking "Same domain only" or adding a custom URL filter.'
          );
          return;
        }

        if (options.autoScrape) {
          setIsDiscoveringNested(false);
          await crawlNestedGalleries(
            discovered,
            resolvedParentUrl,
            resolvedParentTitle,
            options.followLinkedPages
          );
          return;
        }

        showToast(
          `Discovered ${discovered.length} child galleries on ${resolvedParentTitle}. Select galleries to scrape.`
        );
      } catch (err: any) {
        setErrorMessage(err?.message || 'Failed to discover nested galleries.');
      } finally {
        setIsDiscoveringNested(false);
      }
    },
    [crawlNestedGalleries, relayUrl, showToast]
  );

  useEffect(() => {
    discoverNestedRef.current = handleDiscoverNestedGalleries;
  }, [handleDiscoverNestedGalleries]);

  const handleToggleNestedSelect = useCallback((id: string) => {
    setSelectedNestedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAllNested = useCallback(() => {
    if (!nestedDiscovery) return;
    setSelectedNestedIds((prev) =>
      prev.size === nestedDiscovery.galleries.length
        ? new Set()
        : new Set(nestedDiscovery.galleries.map((g) => g.id))
    );
  }, [nestedDiscovery]);

  const handleScrapeSelectedNested = useCallback(() => {
    if (!nestedDiscovery) return;
    const targets = nestedDiscovery.galleries.filter((g) => selectedNestedIds.has(g.id));
    if (targets.length === 0) return;
    crawlNestedGalleries(
      targets,
      nestedDiscovery.parentUrl,
      nestedDiscovery.parentTitle,
      nestedDiscovery.followLinkedPages
    );
  }, [crawlNestedGalleries, nestedDiscovery, selectedNestedIds]);

  const handleCancelNestedCrawl = useCallback(() => {
    nestedAbortRef.current?.abort();
  }, []);

  const handleClearNestedQueue = useCallback(() => {
    nestedAbortRef.current?.abort();
    setNestedDiscovery(null);
    setSelectedNestedIds(new Set());
    setNestedCrawlProgress({
      isCrawling: false,
      completedCount: 0,
      totalCount: 0,
      extractedImagesCount: 0,
      statusById: {},
    });
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleFetchInstagramProfile = async (
    profileUrl: string,
    sessionCookie?: string,
    maxPosts?: number
  ) => {
    nestedAbortRef.current?.abort();
    faceScanAbortRef.current?.abort();
    faceScanMapRef.current = {};
    setFaceScanMap({});
    setFaceScanStatus({ isScanning: false, scanned: 0, total: 0, error: null });
    setNestedDiscovery(null);
    setSelectedNestedIds(new Set());
    setNestedSummaries([]);
    setNestedCrawlProgress({
      isCrawling: false,
      completedCount: 0,
      totalCount: 0,
      extractedImagesCount: 0,
      statusById: {},
    });
    setIsLoading(true);
    setErrorMessage(null);
    setGeoNotice(null);
    setIsInstagramLoginRequired(false);
    setInstagramContinuation(null);

    try {
      const { ok, data, error } = await fetchApiJson('/api/instagram/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileUrl,
          sessionCookie: (sessionCookie ?? instagramSession).trim() || undefined,
          maxPosts: maxPosts ?? instagramMaxPosts,
          relayUrl: relayUrl.trim() || undefined,
        }),
      });

      if (!ok || !data) {
        setIsInstagramLoginRequired(true);
        throw new Error(data?.error || error || 'Failed to fetch Instagram profile photos.');
      }

      const count = (data.images || []).length;
      applyScrapeResponse(data, profileUrl, `Fetched ${count} full-resolution Instagram photos!`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Instagram profile fetch failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadMoreInstagramPosts = async () => {
    if (!instagramContinuation || isLoadingMorePosts || isLoading) return;
    setIsLoadingMorePosts(true);
    setErrorMessage(null);

    try {
      const { ok, data, error } = await fetchApiJson('/api/instagram/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileUrl: instagramContinuation.profileUrl,
          sessionCookie: instagramSession.trim() || undefined,
          maxPosts: instagramMaxPosts,
          relayUrl: relayUrl.trim() || undefined,
          resumeUserId: instagramContinuation.userId,
          resumeCursor: instagramContinuation.nextCursor,
          resumeMaxId: instagramContinuation.nextMaxId,
        }),
      });

      if (!ok || !data) {
        throw new Error(data?.error || error || 'Could not load next batch of Instagram posts.');
      }

      const incoming: ScrapedImage[] = data.images || [];
      let addedCount = 0;

      setImages((prev) => {
        const seen = new Set(prev.map((img) => img.fullUrl));
        const merged = [...prev];
        for (const item of incoming) {
          if (!seen.has(item.fullUrl)) {
            seen.add(item.fullUrl);
            merged.push({ ...item, id: `ig_${merged.length + 1}` });
            addedCount++;
          }
        }
        setUnshrunkCount(merged.filter((i) => i.isUnshrunk).length);
        return merged;
      });

      if (data.notice) setGeoNotice(data.notice);
      if (data.sessionExpired || data.loginRequired) {
        setIsInstagramLoginRequired(true);
      }

      if (data.hasMore && (data.nextCursor || data.nextMaxId) && addedCount > 0) {
        setInstagramContinuation({
          profileUrl: instagramContinuation.profileUrl,
          userId: data.userId || instagramContinuation.userId,
          nextCursor: data.nextCursor,
          nextMaxId: data.nextMaxId,
          hasMore: true,
          totalProfilePosts: data.totalProfilePosts || instagramContinuation.totalProfilePosts,
        });
      } else {
        setInstagramContinuation(null);
      }

      if (addedCount > 0) {
        showToast(`Loaded ${addedCount} more full-res Instagram photos!`);
      } else {
        showToast('No additional new photos returned for this cursor.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load next Instagram posts.');
    } finally {
      setIsLoadingMorePosts(false);
    }
  };

  const handleDeepResolve = async (image: ScrapedImage) => {
    if (!image.linkedPageUrl) return;
    try {
      const { ok, data, error } = await fetchApiJson('/api/deep-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkedPageUrl: image.linkedPageUrl,
          relayUrl: relayUrl.trim() || undefined,
        }),
      });
      if (ok && data?.url) {
        setImages((prev) =>
          prev.map((img) =>
            img.id === image.id
              ? {
                  ...img,
                  fullUrl: data.url,
                  isUnshrunk: true,
                  unshrinkMethod: data.method,
                  deepScraped: true,
                  width: data.width || img.width,
                  height: data.height || img.height,
                }
              : img
          )
        );
        setSelectedImage((current) =>
          current && current.id === image.id
            ? {
                ...current,
                fullUrl: data.url,
                isUnshrunk: true,
                unshrinkMethod: data.method,
                deepScraped: true,
                width: data.width || current.width,
                height: data.height || current.height,
              }
            : current
        );
        showToast('Successfully resolved master image from linked webpage!');
      } else {
        throw new Error(data?.error || error || 'Failed to extract full resolution');
      }
    } catch (err: any) {
      setErrorMessage(`Deep resolve error: ${err.message}`);
    }
  };

  const handleScanHumanFaces = useCallback(
    async (targetImages: ScrapedImage[]): Promise<boolean> => {
      const currentMap = faceScanMapRef.current;
      const toScan = targetImages.filter(
        (img) =>
          !isBlankOrPlaceholderUrl(img.thumbnailUrl || img.fullUrl) &&
          (!currentMap[img.id] || Boolean(currentMap[img.id]?.error))
      );

      if (toScan.length === 0) {
        const usableCount = targetImages.filter((img) => {
          const entry = currentMap[img.id];
          return entry && !entry.error;
        }).length;
        if (targetImages.length > 0 && usableCount === 0) {
          const msg =
            'No scraped images could be inspected (blank placeholders or unavailable URLs).';
          setFaceScanStatus({ isScanning: false, scanned: 0, total: 0, error: msg });
          return false;
        }
        return true;
      }

      faceScanAbortRef.current?.abort();
      const abortController = new AbortController();
      faceScanAbortRef.current = abortController;

      setErrorMessage(null);
      setFaceScanStatus({
        isScanning: true,
        scanned: 0,
        total: toScan.length,
        error: null,
      });

      const BATCH_SIZE = 10;
      let scannedSoFar = 0;
      const accumulatedResults: Record<string, FaceScanResult> = { ...currentMap };

      const activeCustomLlm = loadCustomLlmSettings();

      const sendFaceScanChunk = async (
        chunkItems: Array<{ img: ScrapedImage; previewDataUrl?: string }>
      ) => {
        if (activeCustomLlm.provider !== 'builtin') {
          for (const { img, previewDataUrl } of chunkItems) {
            if (abortController.signal.aborted) return false;
            try {
              const targetUrl =
                previewDataUrl ||
                img.thumbnailUrl ||
                img.fullUrl ||
                img.fallbackUrl ||
                '';
              const dataUrl = await ensureImageDataUrlInBrowser(targetUrl, 512);
              const verdict = await scanHumanFaceWithCustomLlm(activeCustomLlm, {
                id: img.id,
                imageDataUrl: dataUrl,
                signal: abortController.signal,
              });
              accumulatedResults[img.id] = {
                hasHumanFace: verdict.hasHumanFace,
                faceCount: verdict.faceCount,
                confidence: verdict.confidence,
                subjectSummary: verdict.subjectSummary,
                error: verdict.error,
              };
            } catch (scanErr: any) {
              accumulatedResults[img.id] = {
                hasHumanFace: false,
                faceCount: 0,
                confidence: 0,
                subjectSummary: '',
                error: scanErr?.message || 'Failed to inspect image with custom LLM',
              };
            }
          }
          const snapshot = { ...accumulatedResults };
          faceScanMapRef.current = snapshot;
          setFaceScanMap(snapshot);
          return true;
        }

        const { ok, data, error } = await fetchApiJson('/api/ai/human-face-filter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images: chunkItems.map(({ img, previewDataUrl }) => ({
              id: img.id,
              url: img.fullUrl || img.thumbnailUrl || img.fallbackUrl || '',
              thumbnailUrl: img.thumbnailUrl,
              fallbackUrl: img.fallbackUrl,
              linkedPageUrl: img.linkedPageUrl,
              filename: img.filename,
              referer: img.galleryUrl || sourceUrl || undefined,
              previewDataUrl,
            })),
            referer: sourceUrl || undefined,
            relayUrl: relayUrl.trim() || undefined,
          }),
          signal: abortController.signal,
        });

        if (abortController.signal.aborted) return false;

        if (!ok || !data || !Array.isArray(data.results)) {
          throw new Error(data?.error || error || 'AI face detection failed.');
        }

        for (const row of data.results as Array<FaceScanResult & { id: string }>) {
          if (row && typeof row.id === 'string') {
            accumulatedResults[row.id] = {
              hasHumanFace: Boolean(row.hasHumanFace),
              faceCount: Number(row.faceCount || 0),
              confidence: Number(row.confidence || 0),
              subjectSummary: String(row.subjectSummary || ''),
              error: row.error,
            };
          }
        }
        const snapshot = { ...accumulatedResults };
        faceScanMapRef.current = snapshot;
        setFaceScanMap(snapshot);

        return true;
      };

      try {
        for (let i = 0; i < toScan.length; i += BATCH_SIZE) {
          if (abortController.signal.aborted) return false;
          const chunk = toScan.slice(i, i + BATCH_SIZE);
          const preloadedChunk = await Promise.all(
            chunk.map(async (img) => ({
              img,
              previewDataUrl: await tryCaptureBrowserPreviewDataUrl(img),
            }))
          );
          const continued = await sendFaceScanChunk(preloadedChunk);
          if (!continued || abortController.signal.aborted) return false;

          scannedSoFar += chunk.length;
          setFaceScanStatus({
            isScanning: true,
            scanned: Math.min(scannedSoFar, toScan.length),
            total: toScan.length,
            error: null,
          });
        }

        // Fallback: if any scraped images failed server-side download (hotlink/cookie/IP lock),
        // extract compact previews from already-loaded browser cache/DOM and retry just those items.
        const failedFetchItems = toScan.filter((img) => Boolean(accumulatedResults[img.id]?.error));
        if (failedFetchItems.length > 0 && !abortController.signal.aborted) {
          const browserFallbackEntries = await Promise.all(
            failedFetchItems.map(async (img) => ({
              img,
              previewDataUrl: await tryCaptureBrowserPreviewDataUrl(img),
            }))
          );
          const recoverable = browserFallbackEntries.filter(
            (entry): entry is { img: ScrapedImage; previewDataUrl: string } =>
              Boolean(entry.previewDataUrl)
          );
          for (let i = 0; i < recoverable.length; i += BATCH_SIZE) {
            if (abortController.signal.aborted) return false;
            const retryChunk = recoverable.slice(i, i + BATCH_SIZE);
            await sendFaceScanChunk(retryChunk);
          }
        }

        if (faceScanAbortRef.current === abortController) {
          faceScanAbortRef.current = null;
        }

        const inspectedOkCount = targetImages.filter(
          (img) => accumulatedResults[img.id] && !accumulatedResults[img.id].error
        ).length;
        const fetchErrorCount = targetImages.filter((img) =>
          Boolean(accumulatedResults[img.id]?.error)
        ).length;

        if (inspectedOkCount === 0 && fetchErrorCount > 0) {
          const blockMsg =
            'Could not download the scraped images on the server to run AI face filtering (remote host blocked access or images failed to decode). Try using a Relay URL or Open-Tab Harvester.';
          setFaceScanStatus({
            isScanning: false,
            scanned: toScan.length,
            total: toScan.length,
            error: blockMsg,
          });
          setErrorMessage(blockMsg);
          return false;
        }

        const partialWarning =
          fetchErrorCount > 0
            ? `${fetchErrorCount} scraped image${fetchErrorCount === 1 ? '' : 's'} could not be fetched for AI inspection and ${fetchErrorCount === 1 ? 'was' : 'were'} excluded.`
            : null;

        setFaceScanStatus({
          isScanning: false,
          scanned: toScan.length,
          total: toScan.length,
          error: partialWarning,
        });

        const matchedFaces = targetImages.filter(
          (img) =>
            accumulatedResults[img.id] &&
            !accumulatedResults[img.id].error &&
            accumulatedResults[img.id].hasHumanFace
        ).length;
        const excludedCount = targetImages.filter(
          (img) =>
            accumulatedResults[img.id] &&
            (!accumulatedResults[img.id].hasHumanFace || Boolean(accumulatedResults[img.id].error))
        ).length;
        showToast(
          `AI face filter complete: kept ${matchedFaces} with human faces, excluded ${excludedCount} without faces.`
        );
        return true;
      } catch (err: any) {
        if (abortController.signal.aborted || err?.name === 'AbortError') {
          return false;
        }
        const msg = err?.message || 'AI human-face scan failed.';
        setFaceScanStatus({
          isScanning: false,
          scanned: scannedSoFar,
          total: toScan.length,
          error: msg,
        });
        setErrorMessage(msg);
        return false;
      }
    },
    [relayUrl, showToast, sourceUrl]
  );

  const handleBatchDownloadZip = async (
    selectedImages: ScrapedImage[],
    requestedFormat?: ArchiveFormat,
    resumeOptions?: {
      resumeState?: ResumableArchiveState | null;
      overrideContext?: {
        pageTitle: string;
        sourceUrl: string;
        relayUrl: string;
        format: ArchiveFormat;
      };
    }
  ) => {
    if (selectedImages.length === 0 || isDownloadingZip) return;
    const ctxPageTitle = resumeOptions?.overrideContext?.pageTitle ?? pageTitle;
    const ctxSourceUrl = resumeOptions?.overrideContext?.sourceUrl ?? sourceUrl;
    const ctxRelayUrl = resumeOptions?.overrideContext?.relayUrl ?? relayUrl;
    const format: ArchiveFormat =
      resumeOptions?.overrideContext?.format || requestedFormat || archiveFormat || '7z';
    const formatUpper = format.toUpperCase();

    if (!resumeOptions?.resumeState && pausedArchiveResumeRef.current?.token) {
      cleanupStagedArchiveToken(pausedArchiveResumeRef.current.token);
      pausedArchiveResumeRef.current = null;
      clearPersistedArchivePause();
    }

    archiveAbortRef.current?.abort('CANCELLED');
    const abortController = new AbortController();
    archiveAbortRef.current = abortController;

    const activeContext = {
      images: selectedImages,
      pageTitle: ctxPageTitle,
      sourceUrl: ctxSourceUrl,
      relayUrl: ctxRelayUrl,
      format,
    };
    lastArchiveImagesRef.current = selectedImages;
    pausedArchiveContextRef.current = activeContext;

    setIsDownloadingZip(true);
    setDownloadProgress(
      resumeOptions?.resumeState
        ? `${resumeOptions.resumeState.percent}% · Resuming .${formatUpper}...`
        : `0% · Connecting to server .${formatUpper}...`
    );
    setErrorMessage(null);

    const result = await downloadCompressedArchiveWithProgress({
      images: selectedImages,
      pageTitle: ctxPageTitle,
      sourceUrl: ctxSourceUrl,
      relayUrl: ctxRelayUrl,
      format,
      onlyFullRes: true,
      signal: abortController.signal,
      resumeState: resumeOptions?.resumeState || null,
      onPauseSnapshot: (snapshot) => {
        pausedArchiveResumeRef.current = snapshot;
        persistArchivePause(snapshot, activeContext);
      },
      onProgress: (snapshot) => {
        setArchiveProgress(snapshot);
        setDownloadProgress(snapshot.isRunning ? formatArchiveStatusLine(snapshot) : null);
      },
    });

    if (archiveAbortRef.current === abortController) {
      archiveAbortRef.current = null;
    }

    setIsDownloadingZip(false);
    setDownloadProgress(null);

    if (result.paused) {
      showToast(
        `${formatUpper} download paused at ${pausedArchiveResumeRef.current?.percent ?? 0}%. Click Resume anytime.`
      );
    } else if (result.cancelled) {
      pausedArchiveResumeRef.current = null;
      pausedArchiveContextRef.current = null;
      clearPersistedArchivePause();
      showToast(`${formatUpper} archive download cancelled.`);
    } else if (result.success) {
      pausedArchiveResumeRef.current = null;
      pausedArchiveContextRef.current = null;
      clearPersistedArchivePause();
      const label = result.usedBrowserCache
        ? `ZIP "${result.filename}" packaged from webpage data (${result.reusedFromCacheCount ?? result.fileCount}/${result.fileCount} reused without re-downloading)!`
        : result.usedFallback
          ? `Browser ZIP fallback "${result.filename}" downloaded with ${result.fileCount} full-size images!`
          : `${result.format.toUpperCase()} package "${result.filename}" downloaded with ${result.fileCount} full-size images!`;
      showToast(label);
    } else if (result.error) {
      pausedArchiveResumeRef.current = null;
      clearPersistedArchivePause();
      setErrorMessage(`Batch download failed: ${result.error}`);
    }
  };

  const handlePauseArchiveDownload = useCallback(() => {
    archiveAbortRef.current?.abort('PAUSED');
  }, []);

  const handleResumeArchiveDownload = useCallback(() => {
    const resumeState = pausedArchiveResumeRef.current;
    const ctx = pausedArchiveContextRef.current;
    if (!ctx || ctx.images.length === 0) return;
    void handleBatchDownloadZip(ctx.images, ctx.format, {
      resumeState,
      overrideContext: {
        pageTitle: ctx.pageTitle,
        sourceUrl: ctx.sourceUrl,
        relayUrl: ctx.relayUrl,
        format: ctx.format,
      },
    });
  }, []);

  const handleCancelArchiveDownload = useCallback(() => {
    if (archiveAbortRef.current) {
      archiveAbortRef.current.abort('CANCELLED');
    } else if (archiveProgress?.stage === 'paused') {
      cleanupStagedArchiveToken(pausedArchiveResumeRef.current?.token);
      pausedArchiveResumeRef.current = null;
      pausedArchiveContextRef.current = null;
      clearPersistedArchivePause();
      setArchiveProgress(null);
    }
  }, [archiveProgress?.stage, clearPersistedArchivePause]);

  const handleDismissArchiveDownload = useCallback(() => {
    if (!archiveProgress?.isRunning) {
      if (pausedArchiveResumeRef.current?.token) {
        cleanupStagedArchiveToken(pausedArchiveResumeRef.current.token);
      }
      pausedArchiveResumeRef.current = null;
      pausedArchiveContextRef.current = null;
      clearPersistedArchivePause();
      setArchiveProgress(null);
    }
  }, [archiveProgress?.isRunning, clearPersistedArchivePause]);

  const handleDownloadIndividually = async (
    targetImages: ScrapedImage[],
    options?: {
      saveToFolder?: boolean;
      resumeFrom?: ProgressiveDownloadProgress;
      overrideContext?: {
        sourceUrl?: string;
        relayUrl?: string;
        directoryHandle?: any;
        modeLabel?: string;
      };
    }
  ) => {
    if (targetImages.length === 0 || progressiveState?.isRunning) return;

    let directoryHandle: any = options?.overrideContext?.directoryHandle ?? null;
    if (
      !directoryHandle &&
      !options?.resumeFrom &&
      options?.saveToFolder &&
      typeof (window as any).showDirectoryPicker === 'function'
    ) {
      try {
        directoryHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setErrorMessage(`Could not open folder picker: ${err?.message || 'Permission denied'}. Falling back to browser downloads.`);
      }
    }

    const effectiveSourceUrl = options?.overrideContext?.sourceUrl ?? sourceUrl;
    const effectiveRelayUrl = options?.overrideContext?.relayUrl ?? relayUrl;
    const effectiveModeLabel =
      options?.overrideContext?.modeLabel ??
      (directoryHandle ? 'Saving to Folder' : 'Progressive Direct Save');

    if (!options?.resumeFrom) {
      clearPersistedDirectPause();
    }

    const abortController = new AbortController();
    directSaveAbortRef.current = abortController;
    lastDirectSaveImagesRef.current = targetImages;
    pausedDirectContextRef.current = {
      images: targetImages,
      sourceUrl: effectiveSourceUrl,
      relayUrl: effectiveRelayUrl,
      directoryHandle,
      modeLabel: effectiveModeLabel,
    };
    setErrorMessage(null);
    setProgressiveModeLabel(effectiveModeLabel);

    const downloadItems: DownloadItemInput[] = targetImages.map((img, idx) => ({
      id: img.id || `img-${idx}`,
      url: img.fullUrl,
      filename: img.filename || `image_${idx + 1}.jpg`,
      fallbackUrl: img.fallbackUrl,
      linkedPageUrl: img.linkedPageUrl,
      referer: effectiveSourceUrl,
      relayUrl: effectiveRelayUrl.trim() || undefined,
    }));

    const saveBlobFn = directoryHandle
      ? async (blob: Blob, filename: string) => {
          const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        }
      : undefined;

    const finalResult = await runProgressiveDownloads(downloadItems, {
      concurrency: 6,
      staggerMs: directoryHandle ? 0 : 60,
      timeoutMs: 12000,
      signal: abortController.signal,
      initialProgress: options?.resumeFrom
        ? {
            savedItemIds: options.resumeFrom.savedItemIds,
            bytesSaved: options.resumeFrom.bytesSaved,
            itemStatuses: options.resumeFrom.itemStatuses,
          }
        : undefined,
      saveBlobFn,
      onProgress: (snapshot) => {
        setProgressiveState(snapshot);
      },
    });

    if (directSaveAbortRef.current === abortController) {
      directSaveAbortRef.current = null;
    }

    if (
      directoryHandle &&
      !finalResult.isPaused &&
      !finalResult.isCancelled &&
      finalResult.checksumEntries.length > 0
    ) {
      try {
        const sumsText = formatSha256SumsText(finalResult.checksumEntries, [
          `Ultimate Image Processor Folder Download Checksums`,
          `Title: ${pageTitle || sourceUrl || 'Gallery'}`,
          `Saved: ${finalResult.saved} of ${finalResult.total} images`,
          `Verify locally with: sha256sum -c SHA256SUMS.txt`,
        ]);
        const sumsHandle = await directoryHandle.getFileHandle('SHA256SUMS.txt', { create: true });
        const writable = await sumsHandle.createWritable();
        await writable.write(new Blob([sumsText], { type: 'text/plain;charset=utf-8' }));
        await writable.close();
      } catch {
        // ignore manifest write failure if folder permission was revoked
      }
    }

    if (finalResult.isPaused) {
      persistDirectPause(
        finalResult,
        targetImages,
        effectiveSourceUrl,
        effectiveRelayUrl,
        effectiveModeLabel
      );
      showToast(
        `Direct save paused (${finalResult.saved} of ${finalResult.total} saved). Click Resume anytime.`
      );
    } else if (finalResult.isCancelled) {
      pausedDirectContextRef.current = null;
      clearPersistedDirectPause();
      showToast(`Direct save cancelled (${finalResult.saved} of ${finalResult.total} saved).`);
    } else if (finalResult.saved > 0 && finalResult.failed === 0) {
      pausedDirectContextRef.current = null;
      clearPersistedDirectPause();
      const cacheNote =
        finalResult.cacheReusedCount > 0
          ? ` (${finalResult.cacheReusedCount} reused from webpage cache)`
          : '';
      showToast(
        directoryHandle
          ? `Saved all ${finalResult.saved} full-size images + SHA256SUMS.txt directly to folder${cacheNote}!`
          : `Progressive direct save completed for ${finalResult.saved} image(s)${cacheNote}!`
      );
    } else if (finalResult.saved > 0) {
      clearPersistedDirectPause();
      showToast(
        `Saved ${finalResult.saved} of ${finalResult.total} images (${finalResult.failed} failed — use Retry Failed to re-attempt).`
      );
    } else {
      clearPersistedDirectPause();
      setErrorMessage(
        'Direct download could not fetch image files. Try opening failed links or enabling a relay URL.'
      );
    }
  };

  const handlePauseDirectSave = () => {
    directSaveAbortRef.current?.abort('PAUSED');
  };

  const handleResumeDirectSave = () => {
    if (!progressiveState?.isPaused) return;
    const ctx = pausedDirectContextRef.current;
    const targetImages = ctx?.images?.length ? ctx.images : lastDirectSaveImagesRef.current;
    if (targetImages.length === 0) return;
    void handleDownloadIndividually(targetImages, {
      resumeFrom: progressiveState,
      overrideContext: ctx
        ? {
            sourceUrl: ctx.sourceUrl,
            relayUrl: ctx.relayUrl,
            directoryHandle: ctx.directoryHandle,
            modeLabel: ctx.directoryHandle ? ctx.modeLabel : 'Progressive Direct Save',
          }
        : undefined,
    });
  };

  const handleCancelDirectSave = () => {
    if (directSaveAbortRef.current) {
      directSaveAbortRef.current.abort('CANCELLED');
    } else {
      pausedDirectContextRef.current = null;
      clearPersistedDirectPause();
      setProgressiveState(null);
    }
  };

  const handleRetryFailedDirectSave = () => {
    if (!progressiveState || progressiveState.failedItems.length === 0) return;
    const failedIds = new Set(progressiveState.failedItems.map((f) => f.id));
    const retryTargets = lastDirectSaveImagesRef.current.filter((img, idx) =>
      failedIds.has(img.id || `img-${idx}`)
    );
    if (retryTargets.length > 0) {
      void handleDownloadIndividually(retryTargets);
    }
  };

  const handleDismissDirectSave = () => {
    if (!progressiveState?.isRunning) {
      pausedDirectContextRef.current = null;
      clearPersistedDirectPause();
      setProgressiveState(null);
    }
  };

  const handleDownloadArchiveChecksum = useCallback(() => {
    if (!archiveProgress) return;
    const entries = archiveProgress.checksumEntries || [];
    if (archiveProgress.archiveSha256) {
      const sidecarText = formatArchiveSidecarSha256Text({
        archiveFilename: archiveProgress.filename,
        archiveSha256: archiveProgress.archiveSha256,
        totalBytes: archiveProgress.bytesTotal ?? archiveProgress.bytesLoaded,
        expectedImageCount: archiveProgress.totalImages,
        entries,
      });
      const sidecarName = `${archiveProgress.filename}.sha256`;
      triggerTextDownload(sidecarText, sidecarName, 'text/plain');
      showToast(`Downloaded checksum file ${sidecarName}`);
      return;
    }
    if (entries.length > 0) {
      const manifestName = buildChecksumManifestFilename(pageTitle, sourceUrl, '_SHA256SUMS.sha256');
      triggerTextDownload(formatSha256SumsText(entries), manifestName, 'text/plain');
      showToast(`Downloaded checksum manifest ${manifestName}`);
    }
  }, [archiveProgress, pageTitle, showToast, sourceUrl]);

  const handleDownloadDirectChecksum = useCallback(() => {
    if (!progressiveState || progressiveState.checksumEntries.length === 0) return;
    const manifestName = buildChecksumManifestFilename(pageTitle, sourceUrl, '_SHA256SUMS.sha256');
    const text = formatSha256SumsText(progressiveState.checksumEntries, [
      `Ultimate Image Processor Direct Save Checksums`,
      `Title: ${pageTitle || sourceUrl || 'Gallery'}`,
      `Saved: ${progressiveState.saved} of ${progressiveState.total} images`,
      `Verify locally with: sha256sum -c ${manifestName}`,
    ]);
    triggerTextDownload(text, manifestName, 'text/plain');
    showToast(`Downloaded checksum manifest ${manifestName}`);
  }, [pageTitle, progressiveState, showToast, sourceUrl]);

  const handleOpenArchiveChecksumVerifier = useCallback(() => {
    if (!archiveProgress) return;
    const targetImages =
      lastArchiveImagesRef.current.length > 0 ? lastArchiveImagesRef.current : images;
    setChecksumModalState({
      isOpen: true,
      images: targetImages,
      initialEntries: archiveProgress.checksumEntries,
      archiveMeta: {
        filename: archiveProgress.filename,
        format: archiveProgress.format,
        archiveSha256: archiveProgress.archiveSha256,
        totalBytes: archiveProgress.bytesTotal ?? archiveProgress.bytesLoaded,
        validImages: archiveProgress.validImages,
        totalImages: archiveProgress.totalImages,
      },
      initialTab: 'verify',
    });
  }, [archiveProgress, images]);

  const handleOpenDirectChecksumVerifier = useCallback(() => {
    if (!progressiveState) return;
    const targetImages =
      lastDirectSaveImagesRef.current.length > 0 ? lastDirectSaveImagesRef.current : images;
    setChecksumModalState({
      isOpen: true,
      images: targetImages,
      initialEntries: progressiveState.checksumEntries,
      archiveMeta: null,
      initialTab: 'verify',
    });
  }, [images, progressiveState]);

  const handleOpenGalleryChecksumVerifier = useCallback((targetImages: ScrapedImage[]) => {
    setChecksumModalState({
      isOpen: true,
      images: targetImages,
      archiveMeta: null,
      initialTab: 'manifest',
    });
  }, []);

  const handleExportProjectZip = async () => {
    setIsExportingZip(true);
    try {
      const response = await fetch('/api/export-full-project');
      if (!response.ok) throw new Error('Failed to create project archive.');

      const blob = await response.blob();
      triggerBlobDownload(blob, 'ultimate_image_processor_codebase.zip');
      showToast('Full codebase exported successfully as ready-to-run ZIP!');
    } catch (err: any) {
      setErrorMessage(`Export failed: ${err.message}`);
    } finally {
      setIsExportingZip(false);
    }
  };

  const handleNavigateLightbox = (direction: number) => {
    if (!selectedImage) return;
    const currentIndex = images.findIndex((img) => img.id === selectedImage.id);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = images.length - 1;
    if (nextIndex >= images.length) nextIndex = 0;

    setSelectedImage(images[nextIndex]);
  };

  const firstSamplePreset = SAMPLE_PRESETS[0];

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen flex text-[#0F141F] dark:text-[#F3F6FA] font-sans transition-colors duration-200">
        {/* Left Studio Navigation Rail (Desktop/Tablet) */}
        <StudioSidebar
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          onOpenCommandPalette={() => {
            setHasOpenedCommandPalette(true);
            setIsCommandPaletteOpen(true);
          }}
          extractedCount={images.length}
        />

        {/* Right Fluid Workspace Column */}
        <div className="flex-1 min-w-0 flex flex-col min-h-screen">
          <Header
            theme={theme}
            onToggleTheme={toggleTheme}
            activeTab={activeTab}
            onSelectTab={handleSelectTab}
            onOpenCommandPalette={() => {
              setHasOpenedCommandPalette(true);
              setIsCommandPaletteOpen(true);
            }}
            onExportProjectZip={handleExportProjectZip}
            isExportingZip={isExportingZip}
          />

          <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
            {successToast && (
              <div className="px-4 py-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/80 text-emerald-900 dark:text-emerald-200 text-xs sm:text-sm font-medium rounded-xl flex items-center gap-2.5 animate-fadeIn">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{successToast}</span>
              </div>
            )}

            {errorMessage && (
              <div className="px-4 py-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/80 text-rose-900 dark:text-rose-200 text-xs sm:text-sm font-medium rounded-xl flex items-center gap-2.5 animate-fadeIn">
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <span className="flex-1">{errorMessage}</span>
                <button
                  type="button"
                  onClick={() => setErrorMessage(null)}
                  className="text-xs underline hover:no-underline shrink-0 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}

            {geoNotice && (
              <div className="px-4 py-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 text-amber-950 dark:text-amber-200 text-xs sm:text-sm font-medium rounded-xl flex items-center gap-2.5 animate-fadeIn">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="flex-1">{geoNotice}</span>
                <button
                  type="button"
                  onClick={() => setGeoNotice(null)}
                  className="text-xs underline hover:no-underline shrink-0 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Studio Tab Panels — preserve visited state in memory while lazy-loading secondary studio chunks */}
            <div className="space-y-6">
              <div
                id="tabpanel-scraper"
                role="tabpanel"
                hidden={activeTab !== 'scraper'}
                className={activeTab === 'scraper' ? 'space-y-6' : 'hidden'}
              >
                <ScraperControls
                  onScrape={handleScrape}
                  onDiscoverNestedGalleries={handleDiscoverNestedGalleries}
                  onFetchInstagramProfile={handleFetchInstagramProfile}
                  isLoading={isLoading}
                  isDiscoveringNested={isDiscoveringNested}
                  isCrawlingNested={nestedCrawlProgress.isCrawling}
                  currentUrl={sourceUrl}
                  relayUrl={relayUrl}
                  onRelayUrlChange={setRelayUrl}
                  geoBlocked={isGeoBlocked}
                  instagramSession={instagramSession}
                  onInstagramSessionChange={setInstagramSession}
                  instagramMaxPosts={instagramMaxPosts}
                  onInstagramMaxPostsChange={setInstagramMaxPosts}
                  instagramLoginRequired={isInstagramLoginRequired}
                  requestedMode={requestedMode}
                  onModeHandled={() => setRequestedMode(null)}
                  compactHeader={images.length > 0 || Boolean(nestedDiscovery)}
                  onSelectTab={handleSelectTab}
                />

                {nestedDiscovery && nestedDiscovery.galleries.length > 0 && (
                  <NestedGalleryQueue
                    parentUrl={nestedDiscovery.parentUrl}
                    parentTitle={nestedDiscovery.parentTitle}
                    galleries={nestedDiscovery.galleries}
                    selectedIds={selectedNestedIds}
                    onToggleSelect={handleToggleNestedSelect}
                    onSelectAll={handleSelectAllNested}
                    onScrapeSelected={handleScrapeSelectedNested}
                    onCancelCrawl={handleCancelNestedCrawl}
                    onClear={handleClearNestedQueue}
                    crawlProgress={nestedCrawlProgress}
                  />
                )}

                {archiveProgress && (
                  <ArchiveDownloadBar
                    progress={archiveProgress}
                    onPause={handlePauseArchiveDownload}
                    onResume={handleResumeArchiveDownload}
                    onCancel={handleCancelArchiveDownload}
                    onDismiss={handleDismissArchiveDownload}
                    onDownloadChecksum={handleDownloadArchiveChecksum}
                    onOpenChecksumVerifier={handleOpenArchiveChecksumVerifier}
                  />
                )}

                {progressiveState && (
                  <ProgressiveDownloadBar
                    progress={progressiveState}
                    modeLabel={progressiveModeLabel}
                    onPause={handlePauseDirectSave}
                    onResume={handleResumeDirectSave}
                    onCancel={handleCancelDirectSave}
                    onRetryFailed={handleRetryFailedDirectSave}
                    onDownloadChecksum={handleDownloadDirectChecksum}
                    onOpenChecksumVerifier={handleOpenDirectChecksumVerifier}
                    onDismiss={handleDismissDirectSave}
                  />
                )}

                {/* Loading Skeleton Grid matching contact-sheet cards */}
                {(isLoading || isDiscoveringNested) &&
                  !nestedCrawlProgress.isCrawling &&
                  images.length === 0 && (
                    <div
                      aria-label="Extracting images"
                      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5"
                    >
                      {Array.from({ length: 8 }).map((_, idx) => (
                        <div
                          key={idx}
                          className="bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-xl overflow-hidden animate-pulse"
                        >
                          <div className="aspect-[4/3] bg-[#EEF1F6] dark:bg-slate-800/60" />
                          <div className="p-3.5 space-y-2.5">
                            <div className="h-3.5 w-3/4 bg-[#EEF1F6] dark:bg-slate-800 rounded" />
                            <div className="h-3 w-1/2 bg-[#F4F6F9] dark:bg-slate-800/70 rounded" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                {/* Asymmetric Bento Studio Hub — visible before first extraction or discovery */}
                {!isLoading &&
                  !isDiscoveringNested &&
                  !nestedCrawlProgress.isCrawling &&
                  !nestedDiscovery &&
                  images.length === 0 && (
                    <BentoShowcase
                      onSelectTab={handleSelectTab}
                      onRunNatureSample={
                        firstSamplePreset
                          ? () =>
                              handleScrape(
                                firstSamplePreset.url,
                                firstSamplePreset.html,
                                true,
                                relayUrl
                              )
                          : undefined
                      }
                      onOpenInstagramMode={() => setRequestedMode('instagram')}
                      onOpenHarvesterMode={() => setRequestedMode('harvester')}
                    />
                  )}

                {images.length > 0 && (
                  <GalleryView
                    images={images}
                    pageTitle={pageTitle}
                    sourceUrl={sourceUrl}
                    unshrunkCount={unshrunkCount}
                    nestedGalleries={nestedSummaries}
                    onSelectImage={setSelectedImage}
                    onBatchDownloadZip={handleBatchDownloadZip}
                    onDownloadIndividually={handleDownloadIndividually}
                    isDownloadingZip={isDownloadingZip}
                    isDirectSaving={Boolean(progressiveState?.isRunning)}
                    downloadProgress={downloadProgress}
                    archiveProgress={archiveProgress}
                    onPauseArchiveDownload={handlePauseArchiveDownload}
                    onResumeArchiveDownload={handleResumeArchiveDownload}
                    onCancelArchiveDownload={handleCancelArchiveDownload}
                    onDismissArchiveDownload={handleDismissArchiveDownload}
                    archiveFormat={archiveFormat}
                    onArchiveFormatChange={setArchiveFormat}
                    faceScanMap={faceScanMap}
                    faceScanStatus={faceScanStatus}
                    onScanHumanFaces={handleScanHumanFaces}
                    hasMorePosts={Boolean(instagramContinuation?.hasMore)}
                    isLoadingMorePosts={isLoadingMorePosts}
                    onLoadMorePosts={handleLoadMoreInstagramPosts}
                    totalProfilePosts={instagramContinuation?.totalProfilePosts}
                    onSendToCropResize={(targets) => {
                      setCropSeedImages(targets);
                      handleSelectTab('crop');
                    }}
                    onSendToFilterStudio={(targets) => {
                      setFilterSeedImages(targets);
                      handleSelectTab('filters');
                    }}
                    onSendToGifMaker={(targets) => {
                      setGifSeedImages(targets);
                      handleSelectTab('gif');
                    }}
                    onSendToHumanClassifier={(targets) => {
                      setClassifierSeedImages(targets);
                      handleSelectTab('classifier');
                    }}
                    onSendToGemmaCaptioner={(targets) => {
                      setGemmaSeedImages(targets);
                      handleSelectTab('gemma');
                    }}
                    onOpenChecksumVerifier={handleOpenGalleryChecksumVerifier}
                  />
                )}
              </div>

              {/* Tab 2: Local Folder Gallery Viewer */}
              <div
                id="tabpanel-gallery"
                role="tabpanel"
                hidden={activeTab !== 'gallery'}
                className={activeTab === 'gallery' ? 'block' : 'hidden'}
              >
                {visitedTabs.has('gallery') && (
                  <FolderGalleryStudio
                    onNotify={showToast}
                    onSendToCropResize={(targets) => {
                      setCropSeedImages(targets);
                      handleSelectTab('crop');
                    }}
                    onSendToFilterStudio={(targets) => {
                      setFilterSeedImages(targets);
                      handleSelectTab('filters');
                    }}
                    onSendToGifMaker={(targets) => {
                      setGifSeedImages(targets);
                      handleSelectTab('gif');
                    }}
                  />
                )}
              </div>

              {/* Tab 3: Batch Directory Crop & Resize Studio */}
              <div
                id="tabpanel-crop"
                role="tabpanel"
                hidden={activeTab !== 'crop'}
                className={activeTab === 'crop' ? 'block' : 'hidden'}
              >
                {visitedTabs.has('crop') && (
                  <CropResizeStudio
                    seededScrapedImages={cropSeedImages}
                    seededSourceUrl={sourceUrl}
                    onClearSeeded={handleClearCropSeed}
                    onNotify={showToast}
                  />
                )}
              </div>

              {/* Tab 3: Image Filter & Snapchat Lens Studio */}
              <div
                id="tabpanel-filters"
                role="tabpanel"
                hidden={activeTab !== 'filters'}
                className={activeTab === 'filters' ? 'block' : 'hidden'}
              >
                {visitedTabs.has('filters') && (
                  <FilterStudio
                    seededScrapedImages={filterSeedImages}
                    seededSourceUrl={sourceUrl}
                    onClearSeeded={handleClearFilterSeed}
                    onNotify={showToast}
                  />
                )}
              </div>

              {/* Tab 4: Animated GIF Maker Studio */}
              <div
                id="tabpanel-gif"
                role="tabpanel"
                hidden={activeTab !== 'gif'}
                className={activeTab === 'gif' ? 'block' : 'hidden'}
              >
                {visitedTabs.has('gif') && (
                  <GifMakerStudio
                    seededScrapedImages={gifSeedImages}
                    seededSourceUrl={sourceUrl}
                    onClearSeeded={handleClearGifSeed}
                    onNotify={showToast}
                  />
                )}
              </div>

              {/* Tab 5: AI Human Identity Classifier */}
              <div
                id="tabpanel-classifier"
                role="tabpanel"
                hidden={activeTab !== 'classifier'}
                className={activeTab === 'classifier' ? 'block' : 'hidden'}
              >
                {visitedTabs.has('classifier') && (
                  <HumanClassifierStudio
                    seededScrapedImages={classifierSeedImages}
                    seededSourceUrl={sourceUrl}
                    onClearSeeded={handleClearClassifierSeed}
                    onNotify={showToast}
                  />
                )}
              </div>

              {/* Tab 6: Gemma 4 Multimodal Chat & Auto-Captioner */}
              <div
                id="tabpanel-gemma"
                role="tabpanel"
                hidden={activeTab !== 'gemma'}
                className={activeTab === 'gemma' ? 'block' : 'hidden'}
              >
                {visitedTabs.has('gemma') && (
                  <GemmaStudio
                    seededScrapedImages={gemmaSeedImages}
                    seededSourceUrl={sourceUrl}
                    onClearSeeded={handleClearGemmaSeed}
                    onNotify={showToast}
                  />
                )}
              </div>

              {/* Tab 7: Setup & Deployment Instructions */}
              <div
                id="tabpanel-docs"
                role="tabpanel"
                hidden={activeTab !== 'docs'}
                className={activeTab === 'docs' ? 'block' : 'hidden'}
              >
                {visitedTabs.has('docs') && <DeploymentDocs />}
              </div>
            </div>
          </main>

          {selectedImage && (
            <LightboxModal
              image={selectedImage}
              images={images}
              sourcePageUrl={sourceUrl}
              onClose={() => setSelectedImage(null)}
              onNavigate={handleNavigateLightbox}
              onDeepResolve={handleDeepResolve}
            />
          )}

          {checksumModalState?.isOpen && (
            <ChecksumVerifierModal
              isOpen={checksumModalState.isOpen}
              onClose={() => setChecksumModalState(null)}
              images={checksumModalState.images}
              pageTitle={pageTitle}
              sourceUrl={sourceUrl}
              relayUrl={relayUrl}
              initialEntries={checksumModalState.initialEntries}
              archiveMeta={checksumModalState.archiveMeta}
              initialTab={checksumModalState.initialTab}
              onDownloadMissing={(missingTargets) => {
                if (missingTargets.length > 0) {
                  void handleDownloadIndividually(missingTargets);
                }
              }}
              onNotify={showToast}
            />
          )}

          {(hasOpenedCommandPalette || isCommandPaletteOpen) && (
            <CommandPalette
              isOpen={isCommandPaletteOpen}
              onClose={() => setIsCommandPaletteOpen(false)}
              theme={theme}
              onToggleTheme={toggleTheme}
              onSelectTab={handleSelectTab}
              onRunNatureSample={() => {
                if (firstSamplePreset) {
                  handleScrape(firstSamplePreset.url, firstSamplePreset.html, true, relayUrl);
                }
              }}
              onOpenNestedMode={() => setRequestedMode('nested')}
              onOpenInstagramMode={() => setRequestedMode('instagram')}
              onExportProjectZip={handleExportProjectZip}
            />
          )}

          <footer className="mt-auto border-t border-[#DCE1EB] dark:border-white/[0.08] py-4 px-4 sm:px-6 lg:px-8 bg-white/95 dark:bg-[#0A0D14]/95 transition-colors">
            <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <span className="font-display font-semibold text-[#0F141F] dark:text-[#F3F6FA]">
                  Ultimate Image Processor
                </span>
                <span aria-hidden="true">·</span>
                <span>Capture, AI Vision, Color Grading &amp; Post-Production Suite</span>
              </div>
              <div className="font-mono text-[11px]">
                Press ⌘K to switch studios or launch actions
              </div>
            </div>
          </footer>
        </div>
      </div>
    </MotionConfig>
  );
}
