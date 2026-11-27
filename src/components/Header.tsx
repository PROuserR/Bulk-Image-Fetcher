'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { Download, Sun, Moon, Command, ChevronRight, Image } from 'lucide-react';
import { LocalEnginesPopover } from './LocalEnginesPopover';
import { ExportPresetsPopover } from './ExportPresetsPopover';

export type WorkspaceTabId =
  | 'scraper'
  | 'gallery'
  | 'crop'
  | 'filters'
  | 'gif'
  | 'classifier'
  | 'gemma'
  | 'generate'
  | 'docs';

interface HeaderProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  activeTab: WorkspaceTabId;
  onSelectTab: (tab: WorkspaceTabId) => void;
  onPrefetchTab?: (tab: WorkspaceTabId) => void;
  onOpenCommandPalette: () => void;
  onExportProjectZip: () => void;
  isExportingZip: boolean;
  onNotify?: (message: string) => void;
}

const TAB_LABELS: Record<WorkspaceTabId, string> = {
  scraper: 'Capture Studio',
  gallery: 'Folder Gallery',
  crop: 'Crop & Resize',
  filters: 'Filter & Lenses',
  gif: 'GIF89a Motion',
  classifier: 'Face & ID Sort',
  gemma: 'Gemma 4 Vision',
  generate: 'AI Image Gen',
  docs: 'Setup & Runtime',
};

const MOBILE_TABS: { id: WorkspaceTabId; label: string }[] = [
  { id: 'scraper', label: 'Capture' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'crop', label: 'Crop' },
  { id: 'filters', label: 'Filters' },
  { id: 'gif', label: 'GIF89a' },
  { id: 'classifier', label: 'Face Sort' },
  { id: 'gemma', label: 'Gemma 4' },
  { id: 'generate', label: 'Image Gen' },
  { id: 'docs', label: 'Setup' },
];

export const Header: React.FC<HeaderProps> = ({
  theme,
  onToggleTheme,
  activeTab,
  onSelectTab,
  onPrefetchTab,
  onOpenCommandPalette,
  onExportProjectZip,
  isExportingZip,
  onNotify,
}) => {
  useEffect(() => {
    const el = document.getElementById(`tab-mobile-${activeTab}`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeTab]);

  return (
    <header className="sticky top-0 z-40 bg-white/90 dark:bg-[#0B0D12]/90 backdrop-blur-md border-b border-[#DCE1EB] dark:border-white/[0.08] transition-colors">
      <div className="px-3 sm:px-6 lg:px-8 h-13 md:h-14 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Mobile Brand OR Desktop Contextual Studio Breadcrumb */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onSelectTab('scraper')}
            className="md:hidden flex items-center gap-2 text-[#0F141F] dark:text-[#F3F6FA] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-md"
            aria-label="FrameVault Home"
          >
            <span className="w-7 h-7 rounded-lg overflow-hidden shrink-0 border border-black/15 dark:border-white/15 bg-[#0B0D12]">
              <Image
                className="w-full h-full object-cover"
              />
            </span>
            <span className="flex flex-col text-left leading-none">
              <span className="font-display font-bold text-[13px] tracking-tight">
                FrameVault
              </span>
              <span className="hidden sm:inline font-mono text-[9px] text-slate-500 dark:text-slate-400 tracking-tight mt-0.5">
                Calibrated Studio
              </span>
            </span>
          </button>

          <nav
            aria-label="Breadcrumb"
            className="hidden md:flex items-center gap-1.5 text-xs sm:text-[13px] min-w-0"
          >
            <button
              type="button"
              onClick={() => onSelectTab('scraper')}
              className="font-display font-semibold text-[#0F141F] dark:text-[#F3F6FA] hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap cursor-pointer"
            >
              FrameVault
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="font-medium text-slate-500 dark:text-slate-400 truncate">
              {TAB_LABELS[activeTab]}
            </span>
          </nav>
        </div>

        {/* Right Controls: Export Presets + Local Engines + Quick Command + Theme Switch + Primary Export */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <ExportPresetsPopover onNotify={onNotify} />

          <LocalEnginesPopover
            onNotify={onNotify}
            onOpenImageStudio={() => onSelectTab('generate')}
            onOpenVisionStudio={() => onSelectTab('gemma')}
          />

          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label="Open quick studio switcher"
            className="md:hidden w-8 sm:w-auto h-8 sm:h-9 sm:px-2.5 flex items-center justify-center gap-1 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-[#131823] text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer shrink-0"
          >
            <Command className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Menu</span>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center text-slate-600 hover:text-[#0F141F] dark:text-slate-400 dark:hover:text-white rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-[#131823] hover:bg-[#E7EBF2] dark:hover:bg-white/[0.08] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer shrink-0"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onExportProjectZip}
            disabled={isExportingZip}
            className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 h-8 sm:h-9 text-xs font-semibold text-white bg-[#0F141F] hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>
              {isExportingZip ? (
                'Packaging...'
              ) : (
                <>
                  <span className="hidden sm:inline">Export Project (.ZIP)</span>
                  <span className="sm:hidden">ZIP</span>
                </>
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Compact Studio Strip (keeps aggregate sticky header well under 15% mobile height) */}
      <div
        role="tablist"
        aria-label="Mobile Workspace Tabs"
        className="md:hidden border-t border-[#DCE1EB]/80 dark:border-white/[0.06] px-4 flex items-center gap-4 overflow-x-auto text-xs font-medium h-10"
      >
        {MOBILE_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-mobile-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              onClick={() => onSelectTab(tab.id)}
              onMouseEnter={() => onPrefetchTab?.(tab.id)}
              onFocus={() => onPrefetchTab?.(tab.id)}
              className={`relative h-full flex items-center whitespace-nowrap shrink-0 cursor-pointer ${isActive
                ? 'text-[#0F141F] dark:text-white font-semibold'
                : 'text-slate-500 dark:text-slate-400'
                }`}
            >
              {tab.label}
              {isActive && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 dark:bg-blue-500" />
              )}
            </button>
          );
        })}
      </div>
    </header>
  );
};
