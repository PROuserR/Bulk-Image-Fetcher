'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { motion, MotionConfig } from 'motion/react';
import { Header, WorkspaceTabId } from './components/Header';
import { StudioSidebar } from './components/StudioSidebar';
import { CommandPalette } from './components/CommandPalette';
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
import { LightboxModal } from './components/LightboxModal';
import { DeploymentDocs } from './components/DeploymentDocs';
import { CropResizeStudio } from './components/CropResizeStudio';
import { FilterStudio } from './components/FilterStudio';
import { GifMakerStudio } from './components/GifMakerStudio';
import { HumanClassifierStudio } from './components/HumanClassifierStudio';
import { GemmaStudio } from './components/GemmaStudio';
import { ScrapedImage } from './utils/scraperLogic';
import {
  DiscoveredGallery,
  NestedGallerySummary,
  NestedGalleryRunInput,
  mergeNestedGalleryResults,
  sanitizeGalleryFolderName,
} from './utils/nestedGalleryLogic';
import { SAMPLE_PRESETS } from './utils/samplePages';
import { triggerBlobDownload } from './utils/downloader';
import {
  runProgressiveDownloads,
  ProgressiveDownloadProgress,
  DownloadItemInput,
} from './utils/progressiveDownloader';
import { ProgressiveDownloadBar } from './components/ProgressiveDownloadBar';
import { fetchApiJson } from './utils/safeFetchJson';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [themeHydrated, setThemeHydrated] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<WorkspaceTabId>('scraper');
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
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const directSaveAbortRef = useRef<AbortController | null>(null);
  const lastDirectSaveImagesRef = useRef<ScrapedImage[]>([]);
  const nestedAbortRef = useRef<AbortController | null>(null);
  const discoverNestedRef = useRef<
    ((url: string, options: NestedDiscoverOptions) => Promise<void>) | null
  >(null);

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
    };
  }, []);

  const handleSelectTab = useCallback((nextTab: WorkspaceTabId) => {
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
  }, []);

  // Resolve persisted/system theme and initial URL ?tab= on client mount
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTab = params.get('tab');
      if (
        urlTab === 'scraper' ||
        urlTab === 'crop' ||
        urlTab === 'filters' ||
        urlTab === 'gif' ||
        urlTab === 'classifier' ||
        urlTab === 'gemma' ||
        urlTab === 'docs'
      ) {
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
          urlTab === 'crop' ||
          urlTab === 'filters' ||
          urlTab === 'gif' ||
          urlTab === 'classifier' ||
          urlTab === 'gemma' ||
          urlTab === 'docs'
        ) {
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
      '2': 'crop',
      '3': 'filters',
      '4': 'gif',
      '5': 'classifier',
      '6': 'gemma',
      '7': 'docs',
    };
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
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

      const concurrency = Math.min(2, galleriesToCrawl.length);
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

  const handleBatchDownloadZip = async (selectedImages: ScrapedImage[]) => {
    if (selectedImages.length === 0) return;
    setIsDownloadingZip(true);
    setDownloadProgress('Connecting to server zip service...');
    setErrorMessage(null);

    let serverSuccess = false;
    try {
      setDownloadProgress('Connecting to server ZIP packager...');
      const response = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: selectedImages.map((img) => ({
            url: img.fullUrl,
            fallbackUrl: img.fallbackUrl,
            linkedPageUrl: img.linkedPageUrl,
            filename: img.filename,
            galleryTitle: img.galleryTitle,
            galleryId: img.galleryId,
          })),
          referer: sourceUrl,
          relayUrl: relayUrl.trim() || undefined,
          onlyFullRes: true,
        }),
        signal: AbortSignal.timeout(40000),
      });

      if (response.ok) {
        setDownloadProgress('Transferring ZIP package...');
        const blob = await response.blob();
        if (blob.size > 0) {
          triggerBlobDownload(blob, `scraped_images_${Date.now()}.zip`);
          showToast(`ZIP package downloaded with ${selectedImages.length} full-size images!`);
          serverSuccess = true;
          setIsDownloadingZip(false);
          setDownloadProgress(null);
          return;
        }
      }
    } catch (serverErr) {
      console.warn('Server-side ZIP packaging dropped or timed out, switching to browser-side assembler:', serverErr);
    }

    if (serverSuccess) return;

    try {
      setDownloadProgress(`Assembling ZIP in browser (0 of ${selectedImages.length})...`);
      const clientZip = new JSZip();
      const seenByFolder = new Map<string, Set<string>>();
      let addedCount = 0;

      const BATCH_SIZE = 3;
      for (let i = 0; i < selectedImages.length; i += BATCH_SIZE) {
        const batch = selectedImages.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (img, idx) => {
            const overallIdx = i + idx;
            setDownloadProgress(`Fetching master image ${overallIdx + 1} of ${selectedImages.length}...`);

            const folderKey = img.galleryTitle
              ? sanitizeGalleryFolderName(img.galleryTitle, img.galleryId || 'gallery')
              : '';
            let seenNames = seenByFolder.get(folderKey);
            if (!seenNames) {
              seenNames = new Set<string>();
              seenByFolder.set(folderKey, seenNames);
            }

            let filename = img.filename || `image_${overallIdx + 1}.jpg`;
            const lastDot = filename.lastIndexOf('.');
            const ext = lastDot !== -1 ? filename.slice(lastDot) : '.jpg';
            const base = lastDot !== -1 ? filename.slice(0, lastDot) : filename;
            let uniqueName = filename;
            let counter = 1;
            while (seenNames.has(uniqueName)) {
              uniqueName = `${base}_${counter}${ext}`;
              counter++;
            }
            seenNames.add(uniqueName);
            const zipEntryPath = folderKey ? `${folderKey}/${uniqueName}` : uniqueName;

            let imageBlob: Blob | null = null;
            try {
              const relayParam = relayUrl.trim() ? `&relayUrl=${encodeURIComponent(relayUrl.trim())}` : '';
              const downloadUrl = `/api/download-file?url=${encodeURIComponent(img.fullUrl)}&filename=${encodeURIComponent(uniqueName)}&referer=${encodeURIComponent(sourceUrl)}${relayParam}`;
              const resp = await fetch(downloadUrl, { signal: AbortSignal.timeout(12000) });
              if (resp.ok) {
                imageBlob = await resp.blob();
              }
            } catch {}

            if (!imageBlob) {
              try {
                const directResp = await fetch(img.fullUrl, { mode: 'cors', signal: AbortSignal.timeout(8000) });
                if (directResp.ok) {
                  imageBlob = await directResp.blob();
                }
              } catch {}
            }

            if (imageBlob && imageBlob.size > 0) {
              clientZip.file(zipEntryPath, imageBlob);
              addedCount++;
            }
          })
        );
      }

      if (addedCount === 0) {
        throw new Error('Remote image host blocked packaging. Use "Direct Save" to download images directly to your device.');
      }

      setDownloadProgress('Generating ZIP archive...');
      const zipBlob = await clientZip.generateAsync({ type: 'blob' });
      triggerBlobDownload(zipBlob, `scraped_images_${Date.now()}.zip`);
      showToast(`ZIP package downloaded with ${addedCount} full-size images!`);
    } catch (err: any) {
      setErrorMessage(`Batch download failed: ${err.message}`);
    } finally {
      setIsDownloadingZip(false);
      setDownloadProgress(null);
    }
  };

  const handleDownloadIndividually = async (
    targetImages: ScrapedImage[],
    options?: { saveToFolder?: boolean }
  ) => {
    if (targetImages.length === 0 || progressiveState?.isRunning) return;

    let directoryHandle: any = null;
    if (options?.saveToFolder && typeof (window as any).showDirectoryPicker === 'function') {
      try {
        directoryHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setErrorMessage(`Could not open folder picker: ${err?.message || 'Permission denied'}. Falling back to browser downloads.`);
      }
    }

    const abortController = new AbortController();
    directSaveAbortRef.current = abortController;
    lastDirectSaveImagesRef.current = targetImages;
    setErrorMessage(null);
    setProgressiveModeLabel(directoryHandle ? 'Saving to Folder' : 'Progressive Direct Save');

    const downloadItems: DownloadItemInput[] = targetImages.map((img, idx) => ({
      id: img.id || `img-${idx}`,
      url: img.fullUrl,
      filename: img.filename || `image_${idx + 1}.jpg`,
      fallbackUrl: img.fallbackUrl,
      linkedPageUrl: img.linkedPageUrl,
      referer: sourceUrl,
      relayUrl: relayUrl.trim() || undefined,
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
      concurrency: 4,
      staggerMs: directoryHandle ? 0 : 120,
      timeoutMs: 12000,
      signal: abortController.signal,
      saveBlobFn,
      onProgress: (snapshot) => {
        setProgressiveState(snapshot);
      },
    });

    if (directSaveAbortRef.current === abortController) {
      directSaveAbortRef.current = null;
    }

    if (finalResult.isCancelled) {
      showToast(`Direct save cancelled (${finalResult.saved} of ${finalResult.total} saved).`);
    } else if (finalResult.saved > 0 && finalResult.failed === 0) {
      showToast(
        directoryHandle
          ? `Saved all ${finalResult.saved} full-size images directly to folder!`
          : `Progressive direct save completed for ${finalResult.saved} image(s)!`
      );
    } else if (finalResult.saved > 0) {
      showToast(
        `Saved ${finalResult.saved} of ${finalResult.total} images (${finalResult.failed} failed — use Retry Failed to re-attempt).`
      );
    } else {
      setErrorMessage(
        'Direct download could not fetch image files. Try opening failed links or enabling a relay URL.'
      );
    }
  };

  const handleCancelDirectSave = () => {
    directSaveAbortRef.current?.abort();
  };

  const handleRetryFailedDirectSave = () => {
    if (!progressiveState || progressiveState.failedItems.length === 0) return;
    const failedIds = new Set(progressiveState.failedItems.map((f) => f.id));
    const retryTargets = lastDirectSaveImagesRef.current.filter((img, idx) =>
      failedIds.has(img.id || `img-${idx}`)
    );
    if (retryTargets.length > 0) {
      handleDownloadIndividually(retryTargets);
    }
  };

  const handleDismissDirectSave = () => {
    if (!progressiveState?.isRunning) {
      setProgressiveState(null);
    }
  };

  const handleExportProjectZip = async () => {
    setIsExportingZip(true);
    try {
      const response = await fetch('/api/export-full-project');
      if (!response.ok) throw new Error('Failed to create project archive.');

      const blob = await response.blob();
      triggerBlobDownload(blob, 'fullres_scraper_full_codebase.zip');
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
      <div className="min-h-screen flex text-[#141413] dark:text-[#F5F4F0] font-sans transition-colors duration-200">
        {/* Left Studio Navigation Rail (Desktop/Tablet) */}
        <StudioSidebar
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          extractedCount={images.length}
        />

        {/* Right Fluid Workspace Column */}
        <div className="flex-1 min-w-0 flex flex-col min-h-screen">
          <Header
            theme={theme}
            onToggleTheme={toggleTheme}
            activeTab={activeTab}
            onSelectTab={handleSelectTab}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
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

            {/* Tab 1: Scraper & Contact-Sheet Studio */}
            <motion.div
              key={`panel-${activeTab}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-6"
            >
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

                {progressiveState && (
                  <ProgressiveDownloadBar
                    progress={progressiveState}
                    modeLabel={progressiveModeLabel}
                    onCancel={handleCancelDirectSave}
                    onRetryFailed={handleRetryFailedDirectSave}
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
                          className="bg-white dark:bg-[#111319] border border-[#E4E0D6] dark:border-white/[0.08] rounded-xl overflow-hidden animate-pulse"
                        >
                          <div className="aspect-[4/3] bg-[#EFECE4] dark:bg-zinc-800/60" />
                          <div className="p-3.5 space-y-2.5">
                            <div className="h-3.5 w-3/4 bg-[#EFECE4] dark:bg-zinc-800 rounded" />
                            <div className="h-3 w-1/2 bg-[#F6F5F1] dark:bg-zinc-800/70 rounded" />
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
                  />
                )}
              </div>

              {/* Tab 2: Batch Directory Crop & Resize Studio */}
              <div
                id="tabpanel-crop"
                role="tabpanel"
                hidden={activeTab !== 'crop'}
                className={activeTab === 'crop' ? 'block' : 'hidden'}
              >
                <CropResizeStudio
                  seededScrapedImages={cropSeedImages}
                  seededSourceUrl={sourceUrl}
                  onClearSeeded={handleClearCropSeed}
                  onNotify={showToast}
                />
              </div>

              {/* Tab 3: Image Filter & Snapchat Lens Studio */}
              <div
                id="tabpanel-filters"
                role="tabpanel"
                hidden={activeTab !== 'filters'}
                className={activeTab === 'filters' ? 'block' : 'hidden'}
              >
                <FilterStudio
                  seededScrapedImages={filterSeedImages}
                  seededSourceUrl={sourceUrl}
                  onClearSeeded={handleClearFilterSeed}
                  onNotify={showToast}
                />
              </div>

              {/* Tab 4: Animated GIF Maker Studio */}
              <div
                id="tabpanel-gif"
                role="tabpanel"
                hidden={activeTab !== 'gif'}
                className={activeTab === 'gif' ? 'block' : 'hidden'}
              >
                <GifMakerStudio
                  seededScrapedImages={gifSeedImages}
                  seededSourceUrl={sourceUrl}
                  onClearSeeded={handleClearGifSeed}
                  onNotify={showToast}
                />
              </div>

              {/* Tab 5: AI Human Identity Classifier */}
              <div
                id="tabpanel-classifier"
                role="tabpanel"
                hidden={activeTab !== 'classifier'}
                className={activeTab === 'classifier' ? 'block' : 'hidden'}
              >
                <HumanClassifierStudio
                  seededScrapedImages={classifierSeedImages}
                  seededSourceUrl={sourceUrl}
                  onClearSeeded={handleClearClassifierSeed}
                  onNotify={showToast}
                />
              </div>

              {/* Tab 6: Gemma 4 Multimodal Chat & Auto-Captioner */}
              <div
                id="tabpanel-gemma"
                role="tabpanel"
                hidden={activeTab !== 'gemma'}
                className={activeTab === 'gemma' ? 'block' : 'hidden'}
              >
                <GemmaStudio
                  seededScrapedImages={gemmaSeedImages}
                  seededSourceUrl={sourceUrl}
                  onClearSeeded={handleClearGemmaSeed}
                  onNotify={showToast}
                />
              </div>

              {/* Tab 7: Setup & Deployment Instructions */}
              <div
                id="tabpanel-docs"
                role="tabpanel"
                hidden={activeTab !== 'docs'}
                className={activeTab === 'docs' ? 'block' : 'hidden'}
              >
                <DeploymentDocs />
              </div>
            </motion.div>
          </main>

          <LightboxModal
            image={selectedImage}
            images={images}
            sourcePageUrl={sourceUrl}
            onClose={() => setSelectedImage(null)}
            onNavigate={handleNavigateLightbox}
            onDeepResolve={handleDeepResolve}
          />

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

          <footer className="mt-auto border-t border-[#E4E0D6] dark:border-white/[0.08] py-4 px-4 sm:px-6 lg:px-8 bg-[#FBFBF9] dark:bg-[#0D0F14] transition-colors">
            <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <div className="flex items-center gap-2">
                <span className="font-display font-semibold text-[#141413] dark:text-zinc-200">
                  FullRes
                </span>
                <span aria-hidden="true">·</span>
                <span>High-Resolution Image Extractor &amp; Post-Production Suite</span>
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
