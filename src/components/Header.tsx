'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Download, Sun, Moon, Aperture, Command, ChevronRight } from 'lucide-react';

export type WorkspaceTabId =
  | 'scraper'
  | 'crop'
  | 'filters'
  | 'gif'
  | 'classifier'
  | 'gemma'
  | 'docs';

interface HeaderProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  activeTab: WorkspaceTabId;
  onSelectTab: (tab: WorkspaceTabId) => void;
  onOpenCommandPalette: () => void;
  onExportProjectZip: () => void;
  isExportingZip: boolean;
}

const TAB_LABELS: Record<WorkspaceTabId, string> = {
  scraper: 'Scraper Studio',
  crop: 'Crop & Resize',
  filters: 'Filter Studio',
  gif: 'GIF Maker',
  classifier: 'Human Classifier',
  gemma: 'Gemma 4 AI',
  docs: 'Setup & Deployment',
};

const MOBILE_TABS: { id: WorkspaceTabId; label: string }[] = [
  { id: 'scraper', label: 'Scraper' },
  { id: 'crop', label: 'Crop' },
  { id: 'filters', label: 'Filters' },
  { id: 'gif', label: 'GIF Maker' },
  { id: 'classifier', label: 'Classifier' },
  { id: 'gemma', label: 'Gemma 4' },
  { id: 'docs', label: 'Setup' },
];

export const Header: React.FC<HeaderProps> = ({
  theme,
  onToggleTheme,
  activeTab,
  onSelectTab,
  onOpenCommandPalette,
  onExportProjectZip,
  isExportingZip,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-[#FBFBF9]/90 dark:bg-[#0D0F14]/90 backdrop-blur-md border-b border-[#E4E0D6] dark:border-white/[0.08] transition-colors">
      <div className="px-4 sm:px-6 lg:px-8 h-13 md:h-14 flex items-center justify-between gap-4">
        {/* Left: Mobile Brand OR Desktop Contextual Studio Breadcrumb */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onSelectTab('scraper')}
            className="md:hidden flex items-center gap-2 text-[#141413] dark:text-[#F5F4F0] font-display font-bold text-base tracking-tight whitespace-nowrap shrink-0 cursor-pointer"
            aria-label="FullRes Scraper Home"
          >
            <span className="w-6 h-6 rounded-md bg-blue-600 text-white flex items-center justify-center shrink-0">
              <Aperture className="w-3.5 h-3.5" />
            </span>
            <span>FullRes</span>
          </button>

          <nav
            aria-label="Breadcrumb"
            className="hidden md:flex items-center gap-1.5 text-xs sm:text-[13px] min-w-0"
          >
            <button
              type="button"
              onClick={() => onSelectTab('scraper')}
              className="text-zinc-500 dark:text-zinc-400 hover:text-[#141413] dark:hover:text-white font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              Workstation
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span className="font-display font-semibold text-[#141413] dark:text-white truncate">
              {TAB_LABELS[activeTab]}
            </span>
          </nav>
        </div>

        {/* Right Controls: Quick Command + Theme Switch + Single Primary Export */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label="Open quick studio switcher"
            className="md:hidden flex items-center gap-1 px-2.5 h-9 rounded-lg border border-[#E4E0D6] dark:border-white/[0.1] bg-white dark:bg-[#151821] text-xs font-medium text-zinc-700 dark:text-zinc-200 cursor-pointer"
          >
            <Command className="w-3.5 h-3.5" />
            <span>Menu</span>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            className="w-9 h-9 flex items-center justify-center text-zinc-600 hover:text-[#141413] dark:text-zinc-400 dark:hover:text-white rounded-lg border border-[#E4E0D6] dark:border-white/[0.1] bg-white dark:bg-[#151821] hover:bg-[#EFECE4] dark:hover:bg-white/[0.08] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onExportProjectZip}
            disabled={isExportingZip}
            className="flex items-center gap-2 px-3 sm:px-3.5 py-2 text-xs font-semibold text-white bg-[#141413] hover:bg-zinc-800 dark:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>
              {isExportingZip ? (
                'Packaging...'
              ) : (
                <>
                  <span className="hidden sm:inline">Export Project (.ZIP)</span>
                  <span className="sm:hidden">Export ZIP</span>
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
        className="md:hidden border-t border-[#E4E0D6]/80 dark:border-white/[0.06] px-4 flex items-center gap-4 overflow-x-auto text-xs font-medium h-10"
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
              className={`relative h-full flex items-center whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'text-[#141413] dark:text-white font-semibold'
                  : 'text-zinc-500 dark:text-zinc-400'
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
