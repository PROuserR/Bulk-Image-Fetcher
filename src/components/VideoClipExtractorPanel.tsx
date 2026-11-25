'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Video,
  Upload,
  Link2,
  Sparkles,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Scissors,
  Film,
  Layers,
  Trash2,
  Loader2,
  AlertCircle,
  X,
} from 'lucide-react';
import {
  ClipExtractionPlan,
  VIDEO_EXTRACT_FPS_OPTIONS,
  VIDEO_SPEED_OPTIONS,
  estimateClipExtractionPlan,
  formatVideoTimestamp,
  isSupportedVideoFile,
  isValidVideoUrl,
  parseVideoTimestamp,
  sanitizeVideoTimeRange,
} from '../utils/videoClipLogic';
import {
  ExtractedVideoFrame,
  extractFramesFromVideo,
  loadVideoMetadata,
} from '../utils/videoFrameExtractor';

export interface ActiveVideoSource {
  url: string;
  name: string;
  durationSec: number;
  width: number;
  height: number;
  isObjectUrl: boolean;
}

interface VideoClipExtractorPanelProps {
  externalVideoFile?: File | null;
  onExternalVideoFileConsumed?: () => void;
  onFramesExtracted: (
    frames: ExtractedVideoFrame[],
    plan: ClipExtractionPlan,
    autoConvertToGif: boolean,
    sourceName: string
  ) => void;
  isBusyExternal?: boolean;
  onNotify?: (message: string) => void;
}

const SAMPLE_VIDEO_URL = '/samples/sample_motion_clip.webm';
const SAMPLE_VIDEO_NAME = 'sample_motion_clip.webm';

export const VideoClipExtractorPanel: React.FC<VideoClipExtractorPanelProps> = ({
  externalVideoFile = null,
  onExternalVideoFileConsumed,
  onFramesExtracted,
  isBusyExternal = false,
  onNotify,
}) => {
  const [videoSource, setVideoSource] = useState<ActiveVideoSource | null>(null);
  const [urlInput, setUrlInput] = useState<string>('');
  const [isLoadingVideo, setIsLoadingVideo] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Clip trim range & playback state
  const [startSec, setStartSec] = useState<number>(0);
  const [endSec, setEndSec] = useState<number>(4);
  const [startDraft, setStartDraft] = useState<string>('0:00.0');
  const [endDraft, setEndDraft] = useState<string>('0:04.0');
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [isPlayingClip, setIsPlayingClip] = useState<boolean>(true);

  // Extraction configuration
  const [extractFps, setExtractFps] = useState<number>(10);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractProgress, setExtractProgress] = useState<{
    done: number;
    total: number;
    currentSec: number;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timelineBarRef = useRef<HTMLDivElement | null>(null);

  const revokeCurrentObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      try {
        URL.revokeObjectURL(objectUrlRef.current);
      } catch {
        // ignore
      }
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      revokeCurrentObjectUrl();
    };
  }, [revokeCurrentObjectUrl]);

  const applyRange = useCallback(
    (rawStart: number, rawEnd: number, anchor: 'start' | 'end' = 'start', totalDur?: number) => {
      const dur = totalDur ?? videoSource?.durationSec ?? 0;
      if (dur <= 0) return;
      const sanitized = sanitizeVideoTimeRange(rawStart, rawEnd, dur, { anchor });
      setStartSec(sanitized.startSec);
      setEndSec(sanitized.endSec);
      setStartDraft(formatVideoTimestamp(sanitized.startSec));
      setEndDraft(formatVideoTimestamp(sanitized.endSec));
      return sanitized;
    },
    [videoSource?.durationSec]
  );

  const loadVideoFromSource = useCallback(
    async (srcUrl: string, label: string, isObjectUrl: boolean) => {
      setIsLoadingVideo(true);
      setErrorMsg(null);
      try {
        const meta = await loadVideoMetadata(srcUrl);
        revokeCurrentObjectUrl();
        if (isObjectUrl) {
          objectUrlRef.current = srcUrl;
        }
        const initialRange = sanitizeVideoTimeRange(0, Math.min(meta.durationSec, 6), meta.durationSec);
        setVideoSource({
          url: srcUrl,
          name: label,
          durationSec: meta.durationSec,
          width: meta.videoWidth,
          height: meta.videoHeight,
          isObjectUrl,
        });
        setStartSec(initialRange.startSec);
        setEndSec(initialRange.endSec);
        setStartDraft(formatVideoTimestamp(initialRange.startSec));
        setEndDraft(formatVideoTimestamp(initialRange.endSec));
        setCurrentTimeSec(initialRange.startSec);
        setIsPlayingClip(true);
        onNotify?.(`Loaded video "${label}" (${formatVideoTimestamp(meta.durationSec)})`);
      } catch (err: unknown) {
        if (isObjectUrl) {
          try {
            URL.revokeObjectURL(srcUrl);
          } catch {
            // ignore
          }
        }
        setErrorMsg(err instanceof Error ? err.message : 'Unable to load video.');
      } finally {
        setIsLoadingVideo(false);
      }
    },
    [onNotify, revokeCurrentObjectUrl]
  );

  const handleFileSelection = useCallback(
    async (files: FileList | File[]) => {
      const file = Array.from(files).find((f) => isSupportedVideoFile(f));
      if (!file) {
        setErrorMsg('Please choose a supported video file (.mp4, .webm, .mov, .m4v, .ogv).');
        return;
      }
      const objUrl = URL.createObjectURL(file);
      await loadVideoFromSource(objUrl, file.name, true);
    },
    [loadVideoFromSource]
  );

  const onExternalConsumedRef = useRef(onExternalVideoFileConsumed);
  useEffect(() => {
    onExternalConsumedRef.current = onExternalVideoFileConsumed;
  }, [onExternalVideoFileConsumed]);

  useEffect(() => {
    if (!externalVideoFile) return;
    handleFileSelection([externalVideoFile]);
    onExternalConsumedRef.current?.();
  }, [externalVideoFile, handleFileSelection]);

  const handleLoadUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!isValidVideoUrl(trimmed)) {
      setErrorMsg('Enter a valid http(s) or local video URL.');
      return;
    }
    const name = trimmed.split('?')[0].split('/').pop() || 'remote_video.mp4';
    await loadVideoFromSource(trimmed, name, false);
  };

  const handleLoadSampleVideo = async () => {
    await loadVideoFromSource(SAMPLE_VIDEO_URL, SAMPLE_VIDEO_NAME, false);
  };

  const handleClearVideo = () => {
    abortControllerRef.current?.abort();
    revokeCurrentObjectUrl();
    setVideoSource(null);
    setErrorMsg(null);
    setExtractProgress(null);
    setIsExtracting(false);
  };

  // Keep <video> looping seamlessly within [startSec, endSec]
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoSource) return;

    const handleTimeUpdate = () => {
      const t = el.currentTime;
      setCurrentTimeSec(t);
      if (isPlayingClip && t >= endSec - 0.03) {
        el.currentTime = startSec;
      }
    };

    const handleLoadedData = () => {
      el.currentTime = startSec;
      if (isPlayingClip) {
        el.play().catch(() => {
          setIsPlayingClip(false);
        });
      }
    };

    el.addEventListener('timeupdate', handleTimeUpdate);
    el.addEventListener('loadeddata', handleLoadedData);
    return () => {
      el.removeEventListener('timeupdate', handleTimeUpdate);
      el.removeEventListener('loadeddata', handleLoadedData);
    };
  }, [videoSource, startSec, endSec, isPlayingClip]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoSource) return;
    el.playbackRate = speedMultiplier;
  }, [speedMultiplier, videoSource]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoSource) return;
    if (isPlayingClip) {
      if (el.currentTime < startSec || el.currentTime > endSec) {
        el.currentTime = startSec;
      }
      el.play().catch(() => setIsPlayingClip(false));
    } else {
      el.pause();
    }
  }, [isPlayingClip, videoSource, startSec, endSec]);

  const seekPreviewTo = (sec: number) => {
    const clamped = Math.max(0, Math.min(videoSource?.durationSec ?? 0, sec));
    setCurrentTimeSec(clamped);
    if (videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
  };

  const extractionPlan = useMemo(() => {
    if (!videoSource) return null;
    return estimateClipExtractionPlan(
      startSec,
      endSec,
      videoSource.durationSec,
      extractFps,
      speedMultiplier
    );
  }, [videoSource, startSec, endSec, extractFps, speedMultiplier]);

  const handleTimelineTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineBarRef.current || !videoSource) return;
    const rect = timelineBarRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekPreviewTo(ratio * videoSource.durationSec);
  };

  const commitStartDraft = () => {
    const parsed = parseVideoTimestamp(startDraft);
    if (parsed === null) {
      setStartDraft(formatVideoTimestamp(startSec));
      return;
    }
    const next = applyRange(parsed, endSec, 'start');
    if (next) seekPreviewTo(next.startSec);
  };

  const commitEndDraft = () => {
    const parsed = parseVideoTimestamp(endDraft);
    if (parsed === null) {
      setEndDraft(formatVideoTimestamp(endSec));
      return;
    }
    const next = applyRange(startSec, parsed, 'end');
    if (next) seekPreviewTo(next.startSec);
  };

  const runExtraction = async (autoConvertToGif: boolean) => {
    if (!videoSource || isExtracting || isBusyExternal) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsExtracting(true);
    setErrorMsg(null);
    setExtractProgress({
      done: 0,
      total: extractionPlan?.frameCount ?? 1,
      currentSec: startSec,
    });

    // Pause live video preview during sequential seek capture
    setIsPlayingClip(false);

    try {
      const result = await extractFramesFromVideo({
        sourceUrl: videoSource.url,
        sourceName: videoSource.name,
        startSec,
        endSec,
        extractFps,
        speedMultiplier,
        maxWorkingEdge: 800,
        signal: controller.signal,
        onProgress: (done, total, currentSec) => {
          setExtractProgress({ done, total, currentSec });
        },
      });

      onFramesExtracted(result.frames, result.plan, autoConvertToGif, videoSource.name);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setErrorMsg('Clip extraction cancelled.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to extract frames from video.');
      }
    } finally {
      setIsExtracting(false);
      setExtractProgress(null);
      abortControllerRef.current = null;
    }
  };

  const totalDur = videoSource?.durationSec ?? 1;
  const startPct = Math.max(0, Math.min(100, (startSec / totalDur) * 100));
  const endPct = Math.max(startPct, Math.min(100, (endSec / totalDur) * 100));
  const playheadPct = Math.max(0, Math.min(100, (currentTimeSec / totalDur) * 100));

  return (
    <div className="space-y-5">
      <input
        ref={videoFileInputRef}
        type="file"
        accept="video/*,.mp4,.webm,.mov,.m4v,.ogv"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFileSelection(e.target.files);
          }
          e.target.value = '';
        }}
      />

      {errorMsg && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300 font-medium"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            aria-label="Dismiss video error"
            className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-900/40 shrink-0 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {!videoSource ? (
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              handleFileSelection(e.dataTransfer.files);
            }
          }}
          className={`bg-white dark:bg-[#0E121B] border-2 border-dashed rounded-2xl p-8 sm:p-12 transition-colors ${
            isDraggingOver
              ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/20'
              : 'border-[#DCE1EB] dark:border-white/[0.1]'
          }`}
        >
          <div className="max-w-xl mx-auto text-center flex flex-col items-center">
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/60 flex items-center justify-center mb-4">
              <Video className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h2 className="font-display text-base sm:text-lg font-bold text-[#0F141F] dark:text-[#F3F6FA]">
              Drop a video clip to extract &amp; convert to GIF
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
              Trim exact start and end timestamps, preview the loop live, tune frame rate and
              speed, and encode crisp 256-color GIF89a files right in your browser.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                disabled={isLoadingVideo}
                onClick={() => videoFileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                {isLoadingVideo ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                <span>Select Video File</span>
              </button>

              <button
                type="button"
                disabled={isLoadingVideo}
                onClick={handleLoadSampleVideo}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-blue-500 text-[#0F141F] dark:text-slate-100 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Try Sample Video Clip</span>
              </button>
            </div>

            <form
              onSubmit={handleLoadUrlSubmit}
              className="mt-6 w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
            >
              <label htmlFor="video-url-input" className="sr-only">
                Direct video URL
              </label>
              <div className="relative flex-1">
                <Link2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="video-url-input"
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="Or paste a direct MP4 / WebM video URL..."
                  className="w-full pl-9 pr-3 py-2 bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.08] rounded-xl text-xs text-[#0F141F] dark:text-[#F3F6FA] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <button
                type="submit"
                disabled={isLoadingVideo || !urlInput.trim()}
                className="px-4 py-2 bg-[#0F141F] dark:bg-white text-white dark:text-[#0F141F] hover:opacity-90 disabled:opacity-40 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                Load URL
              </button>
            </form>

            <div className="mt-4 text-[11px] font-mono text-slate-400 dark:text-slate-500">
              MP4 · WebM · MOV · OGV · Up to 30s clips &amp; 120 frames
            </div>
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left: Interactive Video Clip Preview & Precision Trim Timeline */}
          <section className="lg:col-span-8 bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl p-4 sm:p-5 space-y-4">
            {/* Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                  Source Video · {videoSource.width}×{videoSource.height} px ·{' '}
                  {formatVideoTimestamp(videoSource.durationSec)} total
                </div>
                <h2 className="font-display text-sm sm:text-base font-bold text-[#0F141F] dark:text-[#F3F6FA] truncate">
                  {videoSource.name}
                </h2>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isExtracting}
                  onClick={() => videoFileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/20 text-[#0F141F] dark:text-slate-200 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer disabled:opacity-40"
                >
                  <Upload className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Replace Video</span>
                </button>
                <button
                  type="button"
                  disabled={isExtracting}
                  onClick={handleClearVideo}
                  aria-label="Remove loaded video"
                  className="flex items-center gap-1 px-2.5 py-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              </div>
            </div>

            {/* Video Stage */}
            <div className="bg-[#EEF1F6] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.08] rounded-xl p-3 sm:p-4 flex items-center justify-center min-h-[260px] sm:min-h-[340px]">
              <video
                ref={videoRef}
                src={videoSource.url}
                muted
                playsInline
                crossOrigin={
                  videoSource.url.startsWith('blob:') || videoSource.url.startsWith('data:')
                    ? undefined
                    : 'anonymous'
                }
                aria-label="Video clip trim preview player"
                className="max-w-full max-h-[340px] rounded-lg bg-black shadow-sm"
              />
            </div>

            {/* Playback & Mark In/Out Transport Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => seekPreviewTo(startSec)}
                  title="Jump to clip start"
                  aria-label="Jump to clip start"
                  className="p-2 rounded-lg bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-slate-300 text-[#0F141F] dark:text-slate-200 cursor-pointer"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsPlayingClip((p) => !p)}
                  aria-label={isPlayingClip ? 'Pause clip preview' : 'Play clip preview'}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F141F] dark:bg-white text-white dark:text-[#0F141F] text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  {isPlayingClip ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pause Clip</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      <span>Loop Clip</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => seekPreviewTo(endSec)}
                  title="Jump to clip end"
                  aria-label="Jump to clip end"
                  className="p-2 rounded-lg bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-slate-300 text-[#0F141F] dark:text-slate-200 cursor-pointer"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => applyRange(currentTimeSec, endSec, 'start')}
                  className="px-2.5 py-1.5 rounded-lg bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-blue-500 text-xs font-semibold text-[#0F141F] dark:text-slate-200 whitespace-nowrap cursor-pointer"
                >
                  Set Start Here
                </button>
                <button
                  type="button"
                  onClick={() => applyRange(startSec, currentTimeSec, 'end')}
                  className="px-2.5 py-1.5 rounded-lg bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-blue-500 text-xs font-semibold text-[#0F141F] dark:text-slate-200 whitespace-nowrap cursor-pointer"
                >
                  Set End Here
                </button>
              </div>

              <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                Playhead {formatVideoTimestamp(currentTimeSec)} /{' '}
                {formatVideoTimestamp(videoSource.durationSec)}
              </div>
            </div>

            {/* Visual Clip Window Bar */}
            <div className="space-y-3 pt-2 border-t border-[#DCE1EB] dark:border-white/[0.08]">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#0F141F] dark:text-[#F3F6FA] flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Clip Trim Range</span>
                </span>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {formatVideoTimestamp(startSec)} – {formatVideoTimestamp(endSec)} (
                  {(endSec - startSec).toFixed(1)}s)
                </span>
              </div>

              <div
                ref={timelineBarRef}
                onClick={handleTimelineTrackClick}
                role="presentation"
                title="Click anywhere on timeline to scrub playhead"
                className="relative h-8 rounded-lg bg-[#EEF1F6] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.08] overflow-hidden cursor-pointer select-none"
              >
                {/* Active Selected Clip Region */}
                <div
                  style={{
                    left: `${startPct}%`,
                    width: `${Math.max(1, endPct - startPct)}%`,
                  }}
                  className="absolute inset-y-0 bg-blue-600/20 dark:bg-blue-500/25 border-x-2 border-blue-600 dark:border-blue-400"
                />

                {/* Playhead Needle */}
                <div
                  style={{ left: `${playheadPct}%` }}
                  className="absolute inset-y-0 w-0.5 bg-[#0F141F] dark:bg-white shadow-xs pointer-events-none"
                />
              </div>

              {/* Dedicated Start & End Range Sliders + Timestamp Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="clip-start-time-input"
                      className="text-xs font-medium text-slate-600 dark:text-slate-300"
                    >
                      Start Time
                    </label>
                    <input
                      id="clip-start-time-input"
                      type="text"
                      value={startDraft}
                      onChange={(e) => setStartDraft(e.target.value)}
                      onBlur={commitStartDraft}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitStartDraft();
                      }}
                      className="w-20 px-2 py-1 text-right bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.08] rounded-md text-xs font-mono tabular-nums text-[#0F141F] dark:text-[#F3F6FA]"
                    />
                  </div>
                  <input
                    type="range"
                    aria-label="Clip start slider"
                    min={0}
                    max={Math.max(0.2, videoSource.durationSec - 0.2)}
                    step={0.1}
                    value={startSec}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      const next = applyRange(val, endSec, 'start');
                      if (next) seekPreviewTo(next.startSec);
                    }}
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="clip-end-time-input"
                      className="text-xs font-medium text-slate-600 dark:text-slate-300"
                    >
                      End Time
                    </label>
                    <input
                      id="clip-end-time-input"
                      type="text"
                      value={endDraft}
                      onChange={(e) => setEndDraft(e.target.value)}
                      onBlur={commitEndDraft}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEndDraft();
                      }}
                      className="w-20 px-2 py-1 text-right bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.08] rounded-md text-xs font-mono tabular-nums text-[#0F141F] dark:text-[#F3F6FA]"
                    />
                  </div>
                  <input
                    type="range"
                    aria-label="Clip end slider"
                    min={0.2}
                    max={videoSource.durationSec}
                    step={0.1}
                    value={endSec}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      const next = applyRange(startSec, val, 'end');
                      if (next) seekPreviewTo(next.endSec);
                    }}
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>
              </div>

              {/* Quick Clip Duration Presets */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1">
                  Quick Length:
                </span>
                {[1, 2, 3, 5, 10].map((sec) => {
                  if (sec > videoSource.durationSec + 0.05) return null;
                  const targetEnd = Math.min(videoSource.durationSec, startSec + sec);
                  const active = Math.abs(endSec - startSec - sec) < 0.15;
                  return (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => applyRange(startSec, targetEnd, 'start')}
                      className={`px-2.5 py-1 rounded-md text-xs font-mono tabular-nums font-semibold border transition-colors cursor-pointer ${
                        active
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-[#F4F6F9] dark:bg-white/[0.05] border-[#DCE1EB] dark:border-white/[0.08] text-slate-700 dark:text-slate-300 hover:border-slate-300'
                      }`}
                    >
                      {sec}s
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => applyRange(0, Math.min(30, videoSource.durationSec), 'start')}
                  className="px-2.5 py-1 rounded-md text-xs font-semibold border bg-[#F4F6F9] dark:bg-white/[0.05] border-[#DCE1EB] dark:border-white/[0.08] text-slate-700 dark:text-slate-300 hover:border-slate-300 transition-colors cursor-pointer"
                >
                  {videoSource.durationSec <= 30 ? 'Full Video' : 'First 30s'}
                </button>
              </div>
            </div>
          </section>

          {/* Right: Clip Extraction & Instant Conversion Controls */}
          <aside className="lg:col-span-4 bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl p-5 space-y-5 lg:sticky lg:top-20">
            <div className="pb-3 border-b border-[#DCE1EB] dark:border-white/[0.08]">
              <h3 className="font-display text-sm font-bold text-[#0F141F] dark:text-[#F3F6FA]">
                Clip Extraction &amp; Output
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Choose capture rate and speed, then edit frames or convert directly.
              </p>
            </div>

            {/* Capture Frame Rate */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#0F141F] dark:text-slate-200">
                  Capture Frame Rate
                </span>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {extractFps} fps
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {VIDEO_EXTRACT_FPS_OPTIONS.map((fpsVal) => (
                  <button
                    key={fpsVal}
                    type="button"
                    disabled={isExtracting}
                    onClick={() => setExtractFps(fpsVal)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-mono tabular-nums font-semibold border transition-colors cursor-pointer disabled:opacity-50 ${
                      extractFps === fpsVal
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-[#F4F6F9] dark:bg-white/[0.05] border-[#DCE1EB] dark:border-white/[0.08] text-slate-700 dark:text-slate-300 hover:border-slate-300'
                    }`}
                  >
                    {fpsVal} fps
                  </button>
                ))}
              </div>
            </div>

            {/* Playback Speed Multiplier */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#0F141F] dark:text-slate-200">
                  GIF Playback Speed
                </span>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {speedMultiplier}×
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {VIDEO_SPEED_OPTIONS.map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    disabled={isExtracting}
                    onClick={() => setSpeedMultiplier(spd)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-mono tabular-nums font-semibold border transition-colors cursor-pointer disabled:opacity-50 ${
                      speedMultiplier === spd
                        ? 'bg-[#0F141F] dark:bg-white text-white dark:text-[#0F141F] border-[#0F141F] dark:border-white'
                        : 'bg-[#F4F6F9] dark:bg-white/[0.05] border-[#DCE1EB] dark:border-white/[0.08] text-slate-700 dark:text-slate-300 hover:border-slate-300'
                    }`}
                  >
                    {spd}×
                  </button>
                ))}
              </div>
            </div>

            {/* Clean Typographic Extraction Plan Summary */}
            {extractionPlan && (
              <div className="p-3.5 rounded-xl bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.08] space-y-1">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Extraction Estimate
                </div>
                <div className="text-xs font-mono tabular-nums text-[#0F141F] dark:text-[#F3F6FA] flex items-center justify-between gap-2">
                  <span>Clip {extractionPlan.clipDurationSec.toFixed(1)}s</span>
                  <span>{extractionPlan.frameCount} frames</span>
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  Output {(extractionPlan.estimatedOutputDurationMs / 1000).toFixed(1)}s @{' '}
                  {extractionPlan.outputGifFps} fps
                </div>
                {extractionPlan.wasCapped && (
                  <div className="text-[11px] text-amber-600 dark:text-amber-400 font-medium pt-0.5">
                    Auto-spaced to 120 frames max ({extractionPlan.effectiveExtractFps} fps) for
                    smooth browser encoding.
                  </div>
                )}
              </div>
            )}

            {/* Extraction Progress Indicator */}
            {isExtracting && extractProgress && (
              <div className="space-y-2 p-3 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60">
                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-blue-700 dark:text-blue-300">
                  <span>
                    Capturing frame {extractProgress.done}/{extractProgress.total}
                  </span>
                  <span>{formatVideoTimestamp(extractProgress.currentSec)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-blue-100 dark:bg-blue-950 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-150"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round((extractProgress.done / Math.max(1, extractProgress.total)) * 100)
                      )}%`,
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => abortControllerRef.current?.abort()}
                  className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                >
                  Cancel Extraction
                </button>
              </div>
            )}

            {/* Primary Actions */}
            <div className="pt-2 border-t border-[#DCE1EB] dark:border-white/[0.08] space-y-2.5">
              <button
                type="button"
                disabled={isExtracting || isBusyExternal}
                onClick={() => runExtraction(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                {isExtracting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Film className="w-4 h-4" />
                )}
                <span>Extract &amp; Convert to .GIF</span>
              </button>

              <button
                type="button"
                disabled={isExtracting || isBusyExternal}
                onClick={() => runExtraction(false)}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/20 disabled:opacity-50 text-[#0F141F] dark:text-slate-100 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Extract Frames to Timeline</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};
