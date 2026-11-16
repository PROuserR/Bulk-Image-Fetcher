'use client';

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
} from 'lucide-react';
import { SAMPLE_PRESETS } from '../utils/samplePages';
import {
  OPEN_TAB_HARVESTER_SCRIPT,
  INSTAGRAM_PROFILE_HARVESTER_SCRIPT,
} from '../utils/harvesterScripts';

type ExtractorMode = 'url' | 'instagram' | 'harvester' | 'paste';

interface ScraperControlsProps {
  onScrape: (
    url: string,
    customHtml?: string,
    followLinkedPages?: boolean,
    relayOverride?: string,
    igOptions?: { sessionCookie?: string; maxPosts?: number }
  ) => void;
  onFetchInstagramProfile?: (
    profileUrl: string,
    sessionCookie?: string,
    maxPosts?: number
  ) => void;
  isLoading: boolean;
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
}

export const ScraperControls: React.FC<ScraperControlsProps> = ({
  onScrape,
  onFetchInstagramProfile,
  isLoading,
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
}) => {
  const [mode, setMode] = useState<ExtractorMode>('url');
  const [url, setUrl] = useState(currentUrl);
  const [customHtml, setCustomHtml] = useState('');
  const [followLinkedPages, setFollowLinkedPages] = useState(true);
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
    const order: ExtractorMode[] = ['url', 'instagram', 'harvester', 'paste'];
    const idx = order.indexOf(mode);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setMode(order[(idx + 1) % order.length]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setMode(order[(idx - 1 + order.length) % order.length]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'paste' && customHtml.trim()) {
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

  return (
    <section className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden transition-colors">
      {/* Top Mode Bar + Editorial Title */}
      <div className="p-6 sm:p-8 pb-5 sm:pb-6">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-6">
          <div className="max-w-2xl">
            <h1 className="font-display text-2xl sm:text-4xl font-bold text-zinc-950 dark:text-zinc-50 tracking-tight leading-[1.12] [text-wrap:balance]">
              Extract original full-resolution masters from any page.
            </h1>
            <p className="text-sm sm:text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed mt-2.5">
              Un-shrinks CDN thumbnails, follows linked detail pages, expands Instagram carousels, and packages clean archives in parallel.
            </p>
          </div>

          {/* 4-Mode Segmented Switcher */}
          <div
            role="tablist"
            aria-label="Extraction Source Mode"
            className="grid grid-cols-2 sm:inline-flex items-center gap-1 sm:gap-0 p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl w-full sm:w-auto shrink-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'url'}
              onClick={() => setMode('url')}
              onKeyDown={handleModeTabKeyDown}
              className={`flex items-center justify-center sm:justify-start gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'url'
                  ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5 shrink-0" />
              <span>Webpage URL</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={mode === 'instagram'}
              onClick={() => setMode('instagram')}
              onKeyDown={handleModeTabKeyDown}
              className={`flex items-center justify-center sm:justify-start gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'instagram'
                  ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                  : instagramLoginRequired
                    ? 'text-amber-700 dark:text-amber-400 font-semibold'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
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
              className={`flex items-center justify-center sm:justify-start gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'harvester'
                  ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                  : geoBlocked
                    ? 'text-amber-700 dark:text-amber-400 font-semibold'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
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
              className={`flex items-center justify-center sm:justify-start gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'paste'
                  ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
              }`}
            >
              <Code className="w-3.5 h-3.5 shrink-0" />
              <span>Paste HTML / JSON</span>
            </button>
          </div>
        </div>

        {/* Unified Omnibox Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode !== 'instagram' && mode !== 'harvester' && (
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-zinc-400">
                  <Globe className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={
                    mode === 'paste'
                      ? 'Optional source webpage URL for relative link resolution...'
                      : 'https://example.com/gallery, instagram.com/username, or batch preview URLs...'
                  }
                  required={mode === 'url'}
                  className="w-full pl-11 pr-10 py-3 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm text-zinc-950 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
                />
                {url && (
                  <button
                    type="button"
                    aria-label="Clear URL input"
                    onClick={() => setUrl('')}
                    className="absolute inset-y-0 right-2.5 flex items-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={
                  isLoading ||
                  (mode === 'paste' ? !customHtml.trim() && !url.trim() : !url.trim())
                }
                className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white font-semibold text-sm rounded-xl transition-colors shrink-0 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 cursor-pointer"
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
            </div>
          )}

          {/* Mode: Webpage URL Options & Quick Test Presets */}
          {mode === 'url' && (
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-zinc-100 dark:border-zinc-800/80 text-xs">
              <label className="flex items-center gap-2 cursor-pointer select-none text-zinc-700 dark:text-zinc-300 font-medium">
                <input
                  type="checkbox"
                  checked={followLinkedPages}
                  onChange={(e) => setFollowLinkedPages(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-600"
                />
                <span>Follow Linked Detail Webpages</span>
                <span className="text-zinc-400 dark:text-zinc-500 hidden md:inline">
                  — resolves signed master links inside /photo/ subpages
                </span>
              </label>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-zinc-500 dark:text-zinc-400 mr-1">Try sample:</span>
                {SAMPLE_PRESETS.filter(
                  (preset) =>
                    preset.id !== 'imagefap_gallery' && preset.id !== 'imagefap_jessie_rogers'
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.url, preset.html)}
                    className="px-2.5 py-1 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800/80 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-md transition-colors text-xs font-medium whitespace-nowrap cursor-pointer"
                  >
                    {preset.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mode: Instagram Profile Studio */}
          {mode === 'instagram' && (
            <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80 space-y-4 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                    Instagram Profile Full-Resolution Extractor
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Extracts public grids & carousels instantly, or add your <code className="font-mono text-zinc-700 dark:text-zinc-300">sessionid</code> cookie to paginate full timelines.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCopyIgHarvester}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 self-start sm:self-center cursor-pointer"
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
                    className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
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
                    className="w-full px-3.5 py-2.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="md:col-span-4">
                  <label
                    htmlFor="ig-session-input"
                    className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-zinc-400" />
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
                      className="w-full pl-3.5 pr-9 py-2.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl font-mono text-xs text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="button"
                      aria-label={showSessionToken ? 'Hide sessionid' : 'Show sessionid'}
                      onClick={() => setShowSessionToken(!showSessionToken)}
                      className="absolute inset-y-0 right-2.5 flex items-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      {showSessionToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="md:col-span-3 flex items-end gap-2">
                  <div className="w-24">
                    <label
                      htmlFor="ig-max-posts"
                      className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
                    >
                      Max Photos
                    </label>
                    <select
                      id="ig-max-posts"
                      value={instagramMaxPosts}
                      onChange={(e) => onInstagramMaxPostsChange?.(Number(e.target.value))}
                      className="w-full px-2.5 py-2.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-mono tabular-nums text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
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

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
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
            <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80 space-y-4 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Terminal className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                      Open-Tab Console Harvester & Relay Worker
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                      Bypass server geo-blocks or private sessions by running the harvester script in your open gallery browser tab, then pasting the resulting JSON manifest.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyHarvester}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
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
                    className="px-3.5 py-2 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Paste JSON Output
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <label
                  htmlFor="relay-url-input"
                  className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 shrink-0"
                >
                  <Server className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Optional Relay / CORS Worker URL</span>
                </label>
                <input
                  id="relay-url-input"
                  type="text"
                  value={relayUrl}
                  onChange={(e) => onRelayUrlChange?.(e.target.value)}
                  placeholder="https://your-non-uk-worker.workers.dev/?url="
                  className="flex-1 px-3.5 py-2 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl font-mono text-xs text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>
          )}

          {/* Mode: Paste Previews / HTML / JSON */}
          {mode === 'paste' && (
            <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80 space-y-2 animate-fadeIn">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="custom-html-textarea"
                  className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Paste Preview Image URLs (one per line), Raw HTML Source, or Harvester JSON Manifest
                </label>
                {customHtml && (
                  <button
                    type="button"
                    onClick={() => setCustomHtml('')}
                    className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
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
                className="w-full p-3.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl font-mono text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}
        </form>
      </div>
    </section>
  );
};
