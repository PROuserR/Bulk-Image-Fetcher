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
  group: 'Capture' | 'Post-Production' | 'System';
  shortcut: string;
  icon: React.FC<{ className?: string }>;
}

export const STUDIO_NAV_ITEMS: StudioNavEntry[] = [
  {
    id: 'scraper',
    label: 'Scraper Studio',
    compactLabel: 'Scraper',
    subtitle: 'Un-shrink & crawl pages',
    group: 'Capture',
    shortcut: '1',
    icon: Globe,
  },
  {
    id: 'crop',
    label: 'Crop & Resize',
    compactLabel: 'Crop',
    subtitle: 'Aspect ratios & batch trim',
    group: 'Post-Production',
    shortcut: '2',
    icon: Crop,
  },
  {
    id: 'filters',
    label: 'Filter Studio',
    compactLabel: 'Filters',
    subtitle: 'Color grading & lenses',
    group: 'Post-Production',
    shortcut: '3',
    icon: Wand2,
  },
  {
    id: 'gif',
    label: 'GIF Maker',
    compactLabel: 'GIF',
    subtitle: 'Frames, loops & captions',
    group: 'Post-Production',
    shortcut: '4',
    icon: Film,
  },
  {
    id: 'classifier',
    label: 'Human Classifier',
    compactLabel: 'Classifier',
    subtitle: 'Offline identity sort',
    group: 'Post-Production',
    shortcut: '5',
    icon: Users,
  },
  {
    id: 'gemma',
    label: 'Gemma 4 AI',
    compactLabel: 'Gemma 4',
    subtitle: 'Local vision & captions',
    group: 'Post-Production',
    shortcut: '6',
    icon: Sparkles,
  },
  {
    id: 'docs',
    label: 'Setup & Deployment',
    compactLabel: 'Setup',
    subtitle: 'Docker & Python guide',
    group: 'System',
    shortcut: '7',
    icon: BookOpen,
  },
];

interface StudioSidebarProps {
  activeTab: WorkspaceTabId;
  onSelectTab: (tab: WorkspaceTabId) => void;
  onOpenCommandPalette: () => void;
  extractedCount: number;
}

const GROUPS: StudioNavEntry['group'][] = ['Capture', 'Post-Production', 'System'];

export const StudioSidebar: React.FC<StudioSidebarProps> = ({
  activeTab,
  onSelectTab,
  onOpenCommandPalette,
  extractedCount,
}) => {
  return (
    <aside
      aria-label="Workspace Studios"
      className="hidden md:flex md:w-[232px] lg:w-[252px] shrink-0 flex-col bg-[#FBFBF9] dark:bg-[#0D0F14] border-r border-[#E4E0D6] dark:border-white/[0.08] sticky top-0 h-screen select-none transition-colors"
    >
      {/* Top Brand Wordmark */}
      <div className="h-14 px-5 flex items-center justify-between border-b border-[#E4E0D6] dark:border-white/[0.08]">
        <button
          type="button"
          onClick={() => onSelectTab('scraper')}
          className="flex items-center gap-2.5 text-[#141413] dark:text-[#F5F4F0] font-display font-bold text-lg tracking-tight hover:opacity-80 transition-opacity whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-md"
          aria-label="FullRes Scraper Home"
        >
          <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Aperture className="w-4 h-4" />
          </span>
          <span>FullRes</span>
        </button>

        {extractedCount > 0 && (
          <span className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            {extractedCount} img
          </span>
        )}
      </div>

      {/* Quick Command Palette Trigger */}
      <div className="px-3.5 pt-4 pb-2">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#EFECE4]/70 dark:bg-white/[0.04] border border-[#E4E0D6] dark:border-white/[0.08] text-xs text-zinc-600 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-white/20 transition-colors cursor-pointer"
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
        className="flex-1 overflow-y-auto px-3 py-3 space-y-6"
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
                    className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      isActive
                        ? 'bg-white dark:bg-[#171A23] text-[#141413] dark:text-white border border-[#E4E0D6] dark:border-white/[0.1] shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 border border-transparent hover:bg-[#EFECE4]/60 dark:hover:bg-white/[0.04] hover:text-[#141413] dark:hover:text-zinc-100'
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
      <div className="px-4 py-3.5 border-t border-[#E4E0D6] dark:border-white/[0.08] text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
        <span>Local-first suite</span>
        <span className="font-mono tabular-nums">7 tools</span>
      </div>
    </aside>
  );
};
