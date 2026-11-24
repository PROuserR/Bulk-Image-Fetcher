'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Aperture,
  Globe,
  Crop,
  Wand2,
  Film,
  Users,
  Sparkles,
  BookOpen,
  Command,
} from 'lucide-react';
import { WorkspaceTabId } from './Header';

export interface StudioNavEntry {
  id: WorkspaceTabId;
  label: string;
  compactLabel: string;
  subtitle: string;
  group: 'Capture & Ingestion' | 'Processing & Vision' | 'Environment';
  shortcut: string;
  icon: React.FC<{ className?: string }>;
}

export const STUDIO_NAV_ITEMS: StudioNavEntry[] = [
  {
    id: 'scraper',
    label: 'Capture Studio',
    compactLabel: 'Capture',
    subtitle: 'Extract, un-shrink & crawl',
    group: 'Capture & Ingestion',
    shortcut: '1',
    icon: Globe,
  },
  {
    id: 'crop',
    label: 'Crop & Resize',
    compactLabel: 'Crop',
    subtitle: 'Aspect ratios & batch trim',
    group: 'Processing & Vision',
    shortcut: '2',
    icon: Crop,
  },
  {
    id: 'filters',
    label: 'Filter & Lenses',
    compactLabel: 'Filters',
    subtitle: 'Color grading & AR lenses',
    group: 'Processing & Vision',
    shortcut: '3',
    icon: Wand2,
  },
  {
    id: 'gif',
    label: 'GIF89a Motion',
    compactLabel: 'GIF',
    subtitle: 'Frames, loops & captions',
    group: 'Processing & Vision',
    shortcut: '4',
    icon: Film,
  },
  {
    id: 'classifier',
    label: 'Face & ID Sort',
    compactLabel: 'Classifier',
    subtitle: 'Identity clustering & sort',
    group: 'Processing & Vision',
    shortcut: '5',
    icon: Users,
  },
  {
    id: 'gemma',
    label: 'Gemma 4 Vision',
    compactLabel: 'Gemma 4',
    subtitle: 'Multimodal caption & chat',
    group: 'Processing & Vision',
    shortcut: '6',
    icon: Sparkles,
  },
  {
    id: 'docs',
    label: 'Setup & Runtime',
    compactLabel: 'Setup',
    subtitle: 'Docker, Python & deploy',
    group: 'Environment',
    shortcut: '7',
    icon: BookOpen,
  },
];

interface StudioSidebarProps {
  activeTab: WorkspaceTabId;
  onSelectTab: (tab: WorkspaceTabId) => void;
  onPrefetchTab?: (tab: WorkspaceTabId) => void;
  onOpenCommandPalette: () => void;
  extractedCount: number;
}

const GROUPS: StudioNavEntry['group'][] = [
  'Capture & Ingestion',
  'Processing & Vision',
  'Environment',
];

export const StudioSidebar: React.FC<StudioSidebarProps> = ({
  activeTab,
  onSelectTab,
  onPrefetchTab,
  onOpenCommandPalette,
  extractedCount,
}) => {
  return (
    <aside
      aria-label="Ultimate Image Processing Studios"
      className="hidden md:flex md:w-[240px] lg:w-[260px] shrink-0 flex-col bg-[#FAF9F5]/95 dark:bg-[#0B0D12]/95 backdrop-blur-md border-r border-[#E2DED3] dark:border-white/[0.08] sticky top-0 h-screen select-none transition-colors"
    >
      {/* Top Brand Wordmark */}
      <div className="h-14 px-4.5 flex items-center justify-between border-b border-[#E2DED3] dark:border-white/[0.08]">
        <button
          type="button"
          onClick={() => onSelectTab('scraper')}
          className="flex items-center gap-2.5 text-[#141413] dark:text-[#F5F4F0] hover:opacity-85 transition-opacity whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-md min-w-0"
          aria-label="Ultimate Image Processing Home"
        >
          <span className="w-7 h-7 rounded-lg bg-[#141413] dark:bg-blue-600 text-white flex items-center justify-center shrink-0 border border-black/10 dark:border-blue-400/30">
            <Aperture className="w-4 h-4" />
          </span>
          <span className="flex flex-col text-left leading-none min-w-0">
            <span className="font-display font-bold text-[15px] tracking-tight truncate">
              Ultimate
            </span>
            <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400 tracking-tight truncate mt-0.5">
              Image Processing
            </span>
          </span>
        </button>

        {extractedCount > 0 && (
          <span className="text-[11px] font-mono tabular-nums text-blue-600 dark:text-blue-400 font-semibold shrink-0">
            {extractedCount} img
          </span>
        )}
      </div>

      {/* Quick Command Palette Trigger */}
      <div className="px-3.5 pt-3.5 pb-2">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#EFECE4]/75 dark:bg-white/[0.04] border border-[#E2DED3] dark:border-white/[0.08] text-xs text-zinc-600 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-white/20 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2 truncate">
            <Command className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span className="truncate font-medium">Quick jump...</span>
          </span>
          <kbd className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Grouped Navigation Rail */}
      <nav
        role="tablist"
        aria-label="Primary Workspace Studios"
        className="flex-1 overflow-y-auto px-3 py-3 space-y-5"
      >
        {GROUPS.map((group) => {
          const items = STUDIO_NAV_ITEMS.filter((it) => it.group === group);
          return (
            <div key={group} className="space-y-1">
              <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-zinc-400 dark:text-zinc-500">
                {group}
              </div>

              {items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`tab-rail-${item.id}`}
                    aria-selected={isActive}
                    aria-controls={`tabpanel-${item.id}`}
                    onClick={() => onSelectTab(item.id)}
                    onMouseEnter={() => onPrefetchTab?.(item.id)}
                    onFocus={() => onPrefetchTab?.(item.id)}
                    className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      isActive
                        ? 'bg-white dark:bg-[#151822] text-[#141413] dark:text-white border border-[#E2DED3] dark:border-white/[0.12] shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 border border-transparent hover:bg-[#EFECE4]/65 dark:hover:bg-white/[0.04] hover:text-[#141413] dark:hover:text-zinc-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : 'bg-[#EFECE4] dark:bg-white/[0.06] text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold leading-tight truncate whitespace-nowrap">
                          {item.label}
                        </div>
                        <div className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                          {item.subtitle}
                        </div>
                      </div>
                    </div>

                    <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 shrink-0 hidden lg:inline">
                      {item.shortcut}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Clean Studio Info Footer */}
      <div className="px-4 py-3 border-t border-[#E2DED3] dark:border-white/[0.08] text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
        <span>Ultimate Suite</span>
        <span className="font-mono tabular-nums">7 studios</span>
      </div>
    </aside>
  );
};
