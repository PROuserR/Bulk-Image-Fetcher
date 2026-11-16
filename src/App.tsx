'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { Header } from './components/Header';
import { ScraperControls } from './components/ScraperControls';
import { GalleryView } from './components/GalleryView';
import { LightboxModal } from './components/LightboxModal';
import { DeploymentDocs } from './components/DeploymentDocs';
import { CropResizeStudio } from './components/CropResizeStudio';
import { HumanClassifierStudio } from './components/HumanClassifierStudio';
import { ScrapedImage } from './utils/scraperLogic';
import { SAMPLE_PRESETS } from './utils/samplePages';
import { triggerBlobDownload } from './utils/downloader';
import {
  runProgressiveDownloads,
  ProgressiveDownloadProgress,
  DownloadItemInput,
} from './utils/progressiveDownloader';
import { ProgressiveDownloadBar } from './components/ProgressiveDownloadBar';
import { fetchApiJson } from './utils/safeFetchJson';
import { AlertCircle, CheckCircle2, ArrowUpRight } from 'lucide-react';

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [themeHydrated, setThemeHydrated] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<'scraper' | 'crop' | 'classifier' | 'docs'>('scraper');
  const [cropSeedImages, setCropSeedImages] = useState<ScrapedImage[]>([]);
  const [classifierSeedImages, setClassifierSeedImages] = useState<ScrapedImage[]>([]);
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
  const [requestedMode, setRequestedMode] = useState<
    'url' | 'instagram' | 'harvester' | 'paste' | null
  >(null);
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

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const directSaveAbortRef = useRef<AbortController | null>(null);
  const lastDirectSaveImagesRef = useRef<ScrapedImage[]>([]);

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

  const handleClearClassifierSeed = useCallback(() => {
    setClassifierSeedImages([]);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleSelectTab = useCallback((nextTab: 'scraper' | 'crop' | 'classifier' | 'docs') => {
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
        urlTab === 'classifier' ||
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
        if (urlTab === 'crop' || urlTab === 'classifier' || urlTab === 'docs') {
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

        applyScrapeResponse(data, url);
      } catch (err: any) {
        setErrorMessage(err.message || 'An unexpected error occurred while scraping.');
      } finally {
        setIsLoading(false);
      }
    },
    [applyScrapeResponse, instagramMaxPosts, instagramSession, relayUrl]
  );

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleFetchInstagramProfile = async (
    profileUrl: string,
    sessionCookie?: string,
    maxPosts?: number
  ) => {
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
          })),
          referer: sourceUrl,
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
      const seenNames = new Set<string>();
      let addedCount = 0;

      const BATCH_SIZE = 3;
      for (let i = 0; i < selectedImages.length; i += BATCH_SIZE) {
        const batch = selectedImages.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (img, idx) => {
            const overallIdx = i + idx;
            setDownloadProgress(`Fetching master image ${overallIdx + 1} of ${selectedImages.length}...`);

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

            let imageBlob: Blob | null = null;
            try {
              const downloadUrl = `/api/download-file?url=${encodeURIComponent(img.fullUrl)}&filename=${encodeURIComponent(uniqueName)}&referer=${encodeURIComponent(sourceUrl)}`;
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
              clientZip.file(uniqueName, imageBlob);
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
    <div className="min-h-screen bg-[#F9F9FB] dark:bg-[#090A0F] text-zinc-900 dark:text-zinc-100 flex flex-col font-sans transition-colors duration-200">
      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onExportProjectZip={handleExportProjectZip}
        isExportingZip={isExportingZip}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-7 sm:py-9 space-y-6">
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
        <div
          id="tabpanel-scraper"
          role="tabpanel"
          hidden={activeTab !== 'scraper'}
          className={activeTab === 'scraper' ? 'space-y-6' : 'hidden'}
        >
          <ScraperControls
            onScrape={handleScrape}
            onFetchInstagramProfile={handleFetchInstagramProfile}
            isLoading={isLoading}
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
          />

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
          {isLoading && images.length === 0 && (
            <div
              aria-label="Extracting images"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5"
            >
              {Array.from({ length: 8 }).map((_, idx) => (
                <div
                  key={idx}
                  className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden animate-pulse"
                >
                  <div className="aspect-[4/3] bg-zinc-200/70 dark:bg-zinc-800/60" />
                  <div className="p-3.5 space-y-2.5">
                    <div className="h-3.5 w-3/4 bg-zinc-200 dark:bg-zinc-800 rounded" />
                    <div className="h-3 w-1/2 bg-zinc-100 dark:bg-zinc-800/70 rounded" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Studio Workflow Primer — visible only before first extraction */}
          {!isLoading && images.length === 0 && (
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
              <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col justify-between gap-4">
                <div>
                  <div className="text-xs font-mono text-zinc-400 dark:text-zinc-500">01.</div>
                  <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white mt-1.5">
                    Un-shrink & Crawl Subpages
                  </h3>
                  <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                    Parses srcset descriptors, strips CDN resize queries, and follows linked detail pages to uncover true high-resolution masters.
                  </p>
                </div>
                {firstSamplePreset && (
                  <button
                    type="button"
                    onClick={() =>
                      handleScrape(firstSamplePreset.url, firstSamplePreset.html, true, relayUrl)
                    }
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
                  >
                    <span>Run Nature Sample</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col justify-between gap-4">
                <div>
                  <div className="text-xs font-mono text-zinc-400 dark:text-zinc-500">02.</div>
                  <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white mt-1.5">
                    Instagram Profiles & Carousels
                  </h3>
                  <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                    Extracts public grids & multi-slide carousels cleanly, or pass a sessionid cookie to paginate full timelines and resume batches.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRequestedMode('instagram')}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
                >
                  <span>Open Instagram Extractor</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col justify-between gap-4">
                <div>
                  <div className="text-xs font-mono text-zinc-400 dark:text-zinc-500">03.</div>
                  <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white mt-1.5">
                    Progressive Save &amp; Open-Tab Harvester
                  </h3>
                  <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                    Save masters directly in parallel streams, export filtered link lists, or harvest geo-blocked galleries straight from your browser tab.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRequestedMode('harvester')}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
                >
                  <span>Open-Tab Harvester</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </section>
          )}

          {images.length > 0 && (
            <GalleryView
              images={images}
              pageTitle={pageTitle}
              sourceUrl={sourceUrl}
              unshrunkCount={unshrunkCount}
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
              onSendToHumanClassifier={(targets) => {
                setClassifierSeedImages(targets);
                handleSelectTab('classifier');
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

        {/* Tab 3: AI Human Identity Classifier */}
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

        {/* Tab 4: Setup & Deployment Instructions */}
        <div
          id="tabpanel-docs"
          role="tabpanel"
          hidden={activeTab !== 'docs'}
          className={activeTab === 'docs' ? 'block' : 'hidden'}
        >
          <DeploymentDocs />
        </div>
      </main>

      <LightboxModal
        image={selectedImage}
        images={images}
        sourcePageUrl={sourceUrl}
        onClose={() => setSelectedImage(null)}
        onNavigate={handleNavigateLightbox}
        onDeepResolve={handleDeepResolve}
      />

      <footer className="mt-auto border-t border-zinc-200/80 dark:border-zinc-800/80 py-5 bg-white dark:bg-[#0D0F16] transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-zinc-800 dark:text-zinc-200">
              FullRes
            </span>
            <span aria-hidden="true">·</span>
            <span>High-Resolution Image Extractor &amp; Contact-Sheet Studio</span>
          </div>
          <div>Contact-sheet previewer, link harvester, and batch ZIP packager</div>
        </div>
      </footer>
    </div>
  );
}
