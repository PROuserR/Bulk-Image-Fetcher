'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Search,
  Loader2,
  Code,
  Globe,
  ShieldAlert,
  Copy,
  Check,
  Terminal,
  Server,
  Instagram,
  KeyRound,
  Eye,
  EyeOff,
  X,
  ArrowRight,
  ArrowUpRight,
  FolderTree,
  Wand2,
} from 'lucide-react';
import ultimateHeroImg from '../assets/images/hero_optical_bench_1795633734818.jpg';
import { SAMPLE_PRESETS, NESTED_HUB_PRESET } from '../utils/samplePages';
import {
  OPEN_TAB_HARVESTER_SCRIPT,
  INSTAGRAM_PROFILE_HARVESTER_SCRIPT,
} from '../utils/harvesterScripts';
import type { WorkspaceTabId } from './Header';

export type ExtractorMode = 'url' | 'nested' | 'instagram' | 'harvester' | 'paste';

export interface NestedDiscoverOptions {
  urlPatternFilter?: string;
  sameOriginOnly: boolean;
  maxGalleries: number;
  followLinkedPages: boolean;
  autoScrape?: boolean;
}

interface ScraperControlsProps {
  onScrape: (
    url: string,
    customHtml?: string,
    followLinkedPages?: boolean,
    relayOverride?: string,
    igOptions?: { sessionCookie?: string; maxPosts?: number }
  ) => void;
  onDiscoverNestedGalleries?: (url: string, options: NestedDiscoverOptions) => void;
  onFetchInstagramProfile?: (
    profileUrl: string,
    sessionCookie?: string,
    maxPosts?: number
  ) => void;
  isLoading: boolean;
  isDiscoveringNested?: boolean;
  isCrawlingNested?: boolean;
  currentUrl: string;
  relayUrl?: string;
  onRelayUrlChange?: (val: string) => void;
  geoBlocked?: boolean;
  instagramSession?: string;
  onInstagramSessionChange?: (val: string) => void;
  instagramMaxPosts?: number;
  onInstagramMaxPostsChange?: (val: number) => void;
  instagramLoginRequired?: boolean;
  requestedMode?: ExtractorMode | null;
  onModeHandled?: () => void;
  compactHeader?: boolean;
  onSelectTab?: (tab: WorkspaceTabId) => void;
}

export const ScraperControls: React.FC<ScraperControlsProps> = ({
  onScrape,
  onDiscoverNestedGalleries,
  onFetchInstagramProfile,
  isLoading,
  isDiscoveringNested = false,
  isCrawlingNested = false,
  currentUrl,
  relayUrl = '',
  onRelayUrlChange,
  geoBlocked = false,
  instagramSession = '',
  onInstagramSessionChange,
  instagramMaxPosts = 200,
  onInstagramMaxPostsChange,
  instagramLoginRequired = false,
  requestedMode = null,
  onModeHandled,
  compactHeader = false,
  onSelectTab,
}) => {
  const [mode, setMode] = useState<ExtractorMode>('url');
  const [url, setUrl] = useState(currentUrl);
  const [customHtml, setCustomHtml] = useState('');
  const [followLinkedPages, setFollowLinkedPages] = useState(true);
  const [nestedFilterPattern, setNestedFilterPattern] = useState('');
  const [nestedSameOriginOnly, setNestedSameOriginOnly] = useState(true);
  const [nestedMaxGalleries, setNestedMaxGalleries] = useState(30);
  const [igProfileInput, setIgProfileInput] = useState('');
  const [showSessionToken, setShowSessionToken] = useState(false);
  const [copiedHarvester, setCopiedHarvester] = useState(false);
  const [copiedIgHarvester, setCopiedIgHarvester] = useState(false);

  const prevGeoBlockedRef = React.useRef(geoBlocked);
  const prevIgRequiredRef = React.useRef(instagramLoginRequired);

  useEffect(() => {
    if (geoBlocked && !prevGeoBlockedRef.current) {
      setMode('harvester');
    }
    prevGeoBlockedRef.current = geoBlocked;
  }, [geoBlocked]);

  useEffect(() => {
    if (instagramLoginRequired && !prevIgRequiredRef.current) {
      setMode('instagram');
    }
    prevIgRequiredRef.current = instagramLoginRequired;
  }, [instagramLoginRequired]);

  useEffect(() => {
    if (requestedMode) {
      setMode(requestedMode);
      onModeHandled?.();
    }
  }, [requestedMode, onModeHandled]);

  const handleModeTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const order: ExtractorMode[] = ['url', 'nested', 'instagram', 'harvester', 'paste'];
    const idx = order.indexOf(mode);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setMode(order[(idx + 1) % order.length]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setMode(order[(idx - 1 + order.length) % order.length]);
    }
  };

  const triggerNestedDiscovery = (targetUrl: string, autoScrape: boolean) => {
    const clean = targetUrl.trim();
    if (!clean || !onDiscoverNestedGalleries) return;
    onDiscoverNestedGalleries(clean, {
      urlPatternFilter: nestedFilterPattern.trim() || undefined,
      sameOriginOnly: nestedSameOriginOnly,
      maxGalleries: nestedMaxGalleries,
      followLinkedPages,
      autoScrape,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'nested') {
      triggerNestedDiscovery(url, false);
    } else if (mode === 'paste' && customHtml.trim()) {
      onScrape(
        url.trim() || 'https://custom-html-snippet.local',
        customHtml,
        followLinkedPages,
        relayUrl,
        { sessionCookie: instagramSession, maxPosts: instagramMaxPosts }
      );
    } else if (mode === 'instagram') {
      handleTriggerInstagramFetch();
    } else if (url.trim()) {
      onScrape(url.trim(), undefined, followLinkedPages, relayUrl, {
        sessionCookie: instagramSession,
        maxPosts: instagramMaxPosts,
      });
    }
  };

  const handleSelectPreset = (presetUrl: string, presetHtml?: string) => {
    setUrl(presetUrl);
    setMode('url');
    onScrape(presetUrl, presetHtml, followLinkedPages, relayUrl);
  };

  const handleCopyHarvester = async () => {
    try {
      await navigator.clipboard.writeText(OPEN_TAB_HARVESTER_SCRIPT);
      setCopiedHarvester(true);
      setTimeout(() => setCopiedHarvester(false), 2500);
    } catch {
      // Fallback ignored
    }
  };

  const handleCopyIgHarvester = async () => {
    try {
      await navigator.clipboard.writeText(INSTAGRAM_PROFILE_HARVESTER_SCRIPT);
      setCopiedIgHarvester(true);
      setTimeout(() => setCopiedIgHarvester(false), 2500);
    } catch {
      // Fallback ignored
    }
  };

  const handleTriggerInstagramFetch = () => {
    const rawCandidate = (igProfileInput || url).trim();
    if (!rawCandidate) return;
    const normalized =
      !rawCandidate.includes('/') &&
      !rawCandidate.startsWith('@') &&
      /^[a-zA-Z0-9._]{1,30}$/.test(rawCandidate)
        ? `@${rawCandidate}`
        : rawCandidate;
    setUrl(normalized);
    if (onFetchInstagramProfile) {
      onFetchInstagramProfile(normalized, instagramSession, instagramMaxPosts);
    } else {
      onScrape(normalized, undefined, followLinkedPages, relayUrl, {
        sessionCookie: instagramSession,
        maxPosts: instagramMaxPosts,
      });
    }
  };

  const resolvedIgValue = igProfileInput || (/instagram\.com|^@/i.test(url) ? url : '');
  const visibleSamples = SAMPLE_PRESETS.filter(
    (preset) => preset.id !== 'imagefap_gallery' && preset.id !== 'imagefap_jessie_rogers'
  );
  const firstSample = visibleSamples[0];

  return (
    <div className="space-y-5">
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
      {/* Main Left Deck: Editorial Copy + Omnibox Scraper Controls */}
      <div
        className={`${
          compactHeader ? 'lg:col-span-12' : 'lg:col-span-7 xl:col-span-8'
        } bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl p-6 sm:p-8 flex flex-col justify-between transition-colors shadow-[0_1px_2px_rgba(15,20,31,0.04)]`}
      >
        <div>
          {!compactHeader ? (
            <div className="mb-6">
              <div className="text-[11px] font-mono uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-2 gap-y-0.5 mb-3">
                <span className="font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                  Optical Lab
                </span>
                <span aria-hidden="true" className="hidden sm:inline">·</span>
                <span className="whitespace-nowrap">Capture, AI Vision &amp; Grading Workbench</span>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl lg:text-[42px] font-bold text-[#0F141F] dark:text-[#F3F6FA] tracking-[-0.03em] leading-[1.08] [text-wrap:balance]">
                Ultimate Image Processor for capture, AI vision &amp; precision grading.
              </h1>
              <p className="text-sm sm:text-[15px] text-slate-600 dark:text-slate-400 leading-relaxed mt-3.5 max-w-2xl">
                Recover un-shrunk web &amp; Instagram originals, isolate portraits with{' '}
                <span className="font-medium text-[#0F141F] dark:text-slate-200">
                  Only Person · Exclude Landscape (AI)
                </span>
                , and pipe straight into non-destructive grading, crop/resize, GIF89a synthesis, and Gemma 4.
              </p>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <h1 className="font-display text-xl font-bold text-[#0F141F] dark:text-[#F3F6FA] tracking-tight">
                Ultimate Image Processor — Capture &amp; Pipeline
              </h1>
            </div>
          )}

          {/* 5-Mode Clean Segmented Switcher */}
          <div
            role="tablist"
            aria-label="Extraction Source Mode"
            className="grid grid-cols-2 sm:inline-flex sm:flex-wrap lg:flex-nowrap items-center gap-0.5 p-1 bg-[#EEF1F6] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.08] rounded-xl w-full sm:w-fit max-w-full mb-4"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'url'}
              onClick={() => setMode('url')}
              onKeyDown={handleModeTabKeyDown}
              className={`flex items-center justify-center sm:justify-start gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'url'
                  ? 'bg-white dark:bg-[#171C28] text-[#0F141F] dark:text-[#F3F6FA] shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-[#0F141F] dark:hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5 shrink-0" />
              <span>Webpage URL</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={mode === 'nested'}
              onClick={() => setMode('nested')}
              onKeyDown={handleModeTabKeyDown}
              className={`flex items-center justify-center sm:justify-start gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'nested'
                  ? 'bg-white dark:bg-[#171C28] text-[#0F141F] dark:text-[#F3F6FA] shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-[#0F141F] dark:hover:text-slate-200'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5 shrink-0" />
              <span>Nested Galleries</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={mode === 'instagram'}
              onClick={() => setMode('instagram')}
              onKeyDown={handleModeTabKeyDown}
              className={`flex items-center justify-center sm:justify-start gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'instagram'
                  ? 'bg-white dark:bg-[#171C28] text-[#0F141F] dark:text-[#F3F6FA] shadow-xs'
                  : instagramLoginRequired
                    ? 'text-amber-700 dark:text-amber-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-[#0F141F] dark:hover:text-slate-200'
              }`}
            >
              <Instagram className="w-3.5 h-3.5 shrink-0" />
              <span>Instagram Profile</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={mode === 'harvester'}
              onClick={() => setMode('harvester')}
              onKeyDown={handleModeTabKeyDown}
              className={`flex items-center justify-center sm:justify-start gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'harvester'
                  ? 'bg-white dark:bg-[#171C28] text-[#0F141F] dark:text-[#F3F6FA] shadow-xs'
                  : geoBlocked
                    ? 'text-amber-700 dark:text-amber-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-[#0F141F] dark:hover:text-slate-200'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              <span>Open-Tab Harvester</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={mode === 'paste'}
              onClick={() => setMode('paste')}
              onKeyDown={handleModeTabKeyDown}
              className={`flex items-center justify-center sm:justify-start gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'paste'
                  ? 'bg-white dark:bg-[#171C28] text-[#0F141F] dark:text-[#F3F6FA] shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-[#0F141F] dark:hover:text-slate-200'
              }`}
            >
              <Code className="w-3.5 h-3.5 shrink-0" />
              <span>Paste HTML</span>
            </button>
          </div>
        </div>

        {/* Unified Omnibox Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode !== 'instagram' && mode !== 'harvester' && (
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-zinc-400">
                  {mode === 'nested' ? (
                    <FolderTree className="w-4 h-4" />
                  ) : (
                    <Globe className="w-4 h-4" />
                  )}
                </div>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={
                    mode === 'nested'
                      ? 'https://example.com/archives/ — webpage linking to multiple child gallery URLs...'
                      : mode === 'paste'
                        ? 'Optional source webpage URL for relative link resolution...'
                        : 'https://example.com/gallery, instagram.com/username, or batch preview URLs...'
                  }
                  required={mode === 'url' || mode === 'nested'}
                  className="w-full pl-11 pr-10 py-3 bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] rounded-xl text-sm text-[#0F141F] dark:text-[#F3F6FA] placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
                />
                {url && (
                  <button
                    type="button"
                    aria-label="Clear URL input"
                    onClick={() => setUrl('')}
                    className="absolute inset-y-0 right-2.5 flex items-center text-slate-400 hover:text-[#0F141F] dark:hover:text-slate-200 p-1 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {mode === 'nested' ? (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                  <button
                    type="submit"
                    disabled={isDiscoveringNested || isCrawlingNested || !url.trim()}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-[#EEF1F6] hover:bg-[#E2E7F0] dark:bg-white/[0.08] dark:hover:bg-white/[0.14] disabled:opacity-60 text-[#0F141F] dark:text-[#F3F6FA] font-semibold text-sm rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {isDiscoveringNested ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Scanning...</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4" />
                        <span>Discover Galleries</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={isDiscoveringNested || isCrawlingNested || !url.trim()}
                    onClick={() => triggerNestedDiscovery(url, true)}
                    className="flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 cursor-pointer"
                  >
                    {isCrawlingNested ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Crawling All...</span>
                      </>
                    ) : (
                      <>
                        <FolderTree className="w-4 h-4" />
                        <span>Scrape All Nested</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={
                    isLoading ||
                    (mode === 'paste' ? !customHtml.trim() && !url.trim() : !url.trim())
                  }
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-sm rounded-xl transition-colors shrink-0 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Extracting...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>Extract Full Images</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Mode: Webpage URL Options & Quick Test Presets */}
          {mode === 'url' && (
            <div className="pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-[#DCE1EB] dark:border-white/[0.06] text-xs">
              <label
                className="flex items-center gap-2 cursor-pointer select-none text-slate-700 dark:text-slate-300 font-medium whitespace-nowrap"
                title="Resolves signed master links inside linked detail / photo subpages"
              >
                <input
                  type="checkbox"
                  checked={followLinkedPages}
                  onChange={(e) => setFollowLinkedPages(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 accent-blue-600 shrink-0"
                />
                <span>Follow Linked Detail Webpages</span>
              </label>

              <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap shrink-0">
                <span className="text-slate-500 dark:text-slate-400 mr-0.5 whitespace-nowrap">Try sample:</span>
                {visibleSamples.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.url, preset.html)}
                    className="px-2.5 py-1 bg-[#EEF1F6] hover:bg-[#E2E7F0] dark:bg-white/[0.06] dark:hover:bg-white/[0.12] text-[#0F141F] dark:text-slate-200 rounded-lg transition-colors text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {preset.name.split(' ')[0]}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setMode('nested');
                    setUrl('preset:nested_galleries_hub');
                    triggerNestedDiscovery('preset:nested_galleries_hub', true);
                  }}
                  className="px-2.5 py-1 bg-[#EEF1F6] hover:bg-[#E2E7F0] dark:bg-white/[0.06] dark:hover:bg-white/[0.12] text-[#0F141F] dark:text-slate-200 rounded-lg transition-colors text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                  title={NESTED_HUB_PRESET.description}
                >
                  Nested Hub
                </button>
              </div>
            </div>
          )}

          {/* Mode: Nested Multi-Gallery Options */}
          {mode === 'nested' && (
            <div className="pt-3 flex flex-col gap-3 border-t border-[#DCE1EB] dark:border-white/[0.06] text-xs animate-fadeIn">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-4">
                  <label
                    className="flex items-center gap-2 cursor-pointer select-none text-slate-700 dark:text-slate-300 font-medium whitespace-nowrap"
                    title="Follows every photo thumbnail detail webpage inside each child gallery to get full-res masters"
                  >
                    <input
                      type="checkbox"
                      checked={followLinkedPages}
                      onChange={(e) => setFollowLinkedPages(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 accent-blue-600 shrink-0"
                    />
                    <span>Follow Linked Detail Webpages</span>
                  </label>

                  <label
                    className="flex items-center gap-2 cursor-pointer select-none text-slate-700 dark:text-slate-300 font-medium whitespace-nowrap"
                    title="Keep discovered child gallery links on the same root website domain"
                  >
                    <input
                      type="checkbox"
                      checked={nestedSameOriginOnly}
                      onChange={(e) => setNestedSameOriginOnly(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 accent-blue-600 shrink-0"
                    />
                    <span>Same domain only</span>
                  </label>
                </div>

                <button
                  type="button"
                  disabled={isDiscoveringNested || isCrawlingNested}
                  onClick={() => {
                    setUrl('preset:nested_galleries_hub');
                    triggerNestedDiscovery('preset:nested_galleries_hub', false);
                  }}
                  className="px-3 py-1 bg-[#EEF1F6] hover:bg-[#E2E7F0] dark:bg-white/[0.06] dark:hover:bg-white/[0.12] text-[#0F141F] dark:text-slate-200 rounded-lg transition-colors text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  Try Nested Hub Sample (3 Galleries)
                </button>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <div className="flex-1">
                  <label htmlFor="nested-url-filter" className="sr-only">
                    Optional gallery URL or title filter pattern
                  </label>
                  <input
                    id="nested-url-filter"
                    type="text"
                    value={nestedFilterPattern}
                    onChange={(e) => setNestedFilterPattern(e.target.value)}
                    placeholder="Optional URL or title filter (e.g. /galleries/ or /2026/i)"
                    className="w-full px-3 py-2 bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] rounded-lg font-mono text-xs text-[#0F141F] dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400 shrink-0">
                  <span className="font-medium whitespace-nowrap">Max Galleries</span>
                  <select
                    aria-label="Maximum child galleries to discover"
                    value={nestedMaxGalleries}
                    onChange={(e) => setNestedMaxGalleries(Number(e.target.value))}
                    className="px-2.5 py-2 bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] rounded-lg font-mono text-xs tabular-nums text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value={15}>15</option>
                    <option value={30}>30</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {/* Mode: Instagram Profile Studio */}
          {mode === 'instagram' && (
            <div className="pt-4 border-t border-[#DCE1EB] dark:border-white/[0.06] space-y-4 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[#0F141F] dark:text-slate-50">
                    Instagram Profile Full-Resolution Extractor
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Extracts public grids & carousels instantly, or add your <code className="font-mono text-slate-700 dark:text-slate-300">sessionid</code> cookie to paginate timelines.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCopyIgHarvester}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#EEF1F6] hover:bg-[#E2E7F0] dark:bg-white/[0.08] dark:hover:bg-white/[0.12] text-[#0F141F] dark:text-slate-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 self-start sm:self-center cursor-pointer"
                >
                  {copiedIgHarvester ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Copied IG Harvester</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy IG Profile Harvester</span>
                    </>
                  )}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-5">
                  <label
                    htmlFor="ig-profile-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Profile URL or @username
                  </label>
                  <input
                    id="ig-profile-input"
                    type="text"
                    value={resolvedIgValue}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setIgProfileInput(nextVal);
                      setUrl(nextVal);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleTriggerInstagramFetch();
                      }
                    }}
                    placeholder="https://www.instagram.com/natgeo/ or @natgeo"
                    className="w-full px-3.5 py-2.5 bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] rounded-xl text-sm text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="md:col-span-4">
                  <label
                    htmlFor="ig-session-input"
                    className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                    <span>Optional sessionid or Cookie Header</span>
                  </label>
                  <div className="relative">
                    <input
                      id="ig-session-input"
                      type={showSessionToken ? 'text' : 'password'}
                      value={instagramSession}
                      onChange={(e) => onInstagramSessionChange?.(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleTriggerInstagramFetch();
                        }
                      }}
                      placeholder="sessionid or csrftoken=...; sessionid=..."
                      className="w-full pl-3.5 pr-9 py-2.5 bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] rounded-xl font-mono text-xs text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="button"
                      aria-label={showSessionToken ? 'Hide sessionid' : 'Show sessionid'}
                      onClick={() => setShowSessionToken(!showSessionToken)}
                      className="absolute inset-y-0 right-2.5 flex items-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    >
                      {showSessionToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="md:col-span-3 flex items-end gap-2">
                  <div className="w-24">
                    <label
                      htmlFor="ig-max-posts"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      Max Photos
                    </label>
                    <select
                      id="ig-max-posts"
                      value={instagramMaxPosts}
                      onChange={(e) => onInstagramMaxPostsChange?.(Number(e.target.value))}
                      className="w-full px-2.5 py-2.5 bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] rounded-xl text-xs font-mono tabular-nums text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                      <option value={500}>500</option>
                      <option value={1000}>1000</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    disabled={isLoading || !resolvedIgValue.trim()}
                    onClick={handleTriggerInstagramFetch}
                    className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Fetching...</span>
                      </>
                    ) : (
                      <span>Fetch Profile</span>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  Tip: If your server IP hits an Instagram rate limit, run the IG Harvester script in your logged-in tab and paste its JSON.
                </span>
                <button
                  type="button"
                  onClick={() => setMode('paste')}
                  className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium whitespace-nowrap cursor-pointer"
                >
                  <span>Open Paste Box</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* Mode: Open-Tab Harvester & Relay Bypass */}
          {mode === 'harvester' && (
            <div className="pt-4 border-t border-[#DCE1EB] dark:border-white/[0.06] space-y-4 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Terminal className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <div>
                    <h2 className="text-sm font-semibold text-[#0F141F] dark:text-slate-50">
                      Open-Tab Console Harvester &amp; Relay Worker
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                      Bypass server geo-blocks or private sessions by running the harvester script in your open gallery browser tab, then pasting the resulting JSON manifest.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyHarvester}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-[#0F141F] hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {copiedHarvester ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied Harvester Script</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Console Harvester</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode('paste')}
                    className="px-3.5 py-2 border border-[#DCE1EB] dark:border-white/[0.1] hover:bg-[#EEF1F6] dark:hover:bg-white/[0.06] text-[#0F141F] dark:text-slate-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Paste JSON Output
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <label
                  htmlFor="relay-url-input"
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 shrink-0"
                >
                  <Server className="w-3.5 h-3.5 text-slate-400" />
                  <span>Optional Relay / CORS Worker URL</span>
                </label>
                <input
                  id="relay-url-input"
                  type="text"
                  value={relayUrl}
                  onChange={(e) => onRelayUrlChange?.(e.target.value)}
                  placeholder="https://your-non-uk-worker.workers.dev/?url="
                  className="flex-1 px-3.5 py-2 bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] rounded-xl font-mono text-xs text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>
          )}

          {/* Mode: Paste Previews / HTML / JSON */}
          {mode === 'paste' && (
            <div className="pt-4 border-t border-[#DCE1EB] dark:border-white/[0.06] space-y-2 animate-fadeIn">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="custom-html-textarea"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Paste Preview Image URLs (one per line), Raw HTML Source, or Harvester JSON Manifest
                </label>
                {customHtml && (
                  <button
                    type="button"
                    onClick={() => setCustomHtml('')}
                    className="text-xs text-slate-500 hover:text-[#0F141F] dark:hover:text-slate-200 cursor-pointer"
                  >
                    Clear paste box
                  </button>
                )}
              </div>
              <textarea
                id="custom-html-textarea"
                rows={5}
                value={customHtml}
                onChange={(e) => setCustomHtml(e.target.value)}
                placeholder={
                  'https://cdn.example.com/images/thumb/photo_01.jpg\nhttps://example.com/photo/123456\n— or paste View-Source HTML or Harvester JSON —'
                }
                className="w-full p-3.5 bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] rounded-xl font-mono text-xs text-[#0F141F] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}
        </form>
      </div>

      {/* Right Column: Optical Studio Hero Card (shown on empty state / landing hero) */}
      {!compactHeader && (
        <aside className="lg:col-span-5 xl:col-span-4 relative rounded-2xl overflow-hidden border border-[#DCE1EB] dark:border-white/[0.08] bg-[#090C12] min-h-[300px] flex flex-col justify-end group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ultimateHeroImg.src}
            alt="Anodized black cinema prime lens, optical loupe, and portrait contact strip on dark slate"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500 ease-out"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-[#07090E]/92 via-[#07090E]/45 to-[#07090E]/10"
          />

          <div className="relative z-10 p-5 sm:p-6 text-white space-y-3">
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.06em] text-blue-300">
              <span>Optical Pipeline</span>
              <span aria-hidden="true" className="text-white/40">·</span>
              <span className="text-slate-200">AI Vision Ready</span>
            </div>
            <h2 className="font-display text-lg sm:text-xl font-bold leading-snug text-white [text-wrap:balance]">
              Inspect, filter faces with AI, and process every pixel.
            </h2>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {firstSample && (
                <button
                  type="button"
                  onClick={() => handleSelectPreset(firstSample.url, firstSample.html)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white text-[#0F141F] hover:bg-slate-100 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <span>Run Nature Sample</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              )}
              {onSelectTab && (
                <button
                  type="button"
                  onClick={() => onSelectTab('filters')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#0F141F]/65 hover:bg-[#0F141F]/85 backdrop-blur-sm border border-white/20 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Wand2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Filter Studio</span>
                </button>
              )}
            </div>
          </div>
        </aside>
      )}
    </section>

    {/* 4-Column Architectural Capability Strip */}
    {!compactHeader && (
      <div className="bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#DCE1EB] dark:divide-white/[0.08] overflow-hidden shadow-[0_1px_2px_rgba(15,20,31,0.04)]">
        {[
          {
            idx: '01',
            title: 'Un-Shrunk Masters',
            desc: 'CDN resolution recovery & carousels',
          },
          {
            idx: '02',
            title: 'AI Portrait Isolation',
            desc: 'Only Person · Exclude Landscape (AI)',
          },
          {
            idx: '03',
            title: 'Color & AR Grading',
            desc: '8 presets, 14 controls & face lenses',
          },
          {
            idx: '04',
            title: 'Batch & Motion Export',
            desc: 'LZMA2 .7Z, .ZIP, GIF89a & REST API',
          },
        ].map((item) => (
          <div key={item.idx} className="px-5 py-4 flex flex-col gap-1">
            <div className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-wider text-blue-600 dark:text-blue-400">
              <span>{item.idx}</span>
              <span aria-hidden="true" className="text-slate-300 dark:text-white/20">·</span>
              <span className="text-[#0F141F] dark:text-[#F3F6FA] font-display text-xs tracking-normal font-bold">
                {item.title}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
              {item.desc}
            </p>
          </div>
        ))}
      </div>
    )}
    </div>
  );
};
