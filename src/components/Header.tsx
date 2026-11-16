'use client';

import React from 'react';
import { Download, Sun, Moon, Aperture } from 'lucide-react';

interface HeaderProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  activeTab: 'scraper' | 'crop' | 'classifier' | 'docs';
  onSelectTab: (tab: 'scraper' | 'crop' | 'classifier' | 'docs') => void;
  onExportProjectZip: () => void;
  isExportingZip: boolean;
}

const NAV_TABS: { id: 'scraper' | 'crop' | 'classifier' | 'docs'; label: string }[] = [
  { id: 'scraper', label: 'Scraper Studio' },
  { id: 'crop', label: 'Crop & Resize' },
  { id: 'classifier', label: 'Human Classifier' },
  { id: 'docs', label: 'Setup & Deployment' },
];

export const Header: React.FC<HeaderProps> = ({
  theme,
  onToggleTheme,
  activeTab,
  onSelectTab,
  onExportProjectZip,
  isExportingZip,
}) => {
  const handleTabKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = NAV_TABS[(currentIndex + 1) % NAV_TABS.length];
      onSelectTab(next.id);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = NAV_TABS[(currentIndex - 1 + NAV_TABS.length) % NAV_TABS.length];
      onSelectTab(prev.id);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white/90 dark:bg-[#0D0F16]/90 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800/80 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-2.5 lg:gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('scraper')}
          className="flex items-center gap-2 text-zinc-950 dark:text-zinc-50 font-display font-bold text-base lg:text-lg tracking-tight hover:opacity-85 transition-opacity whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-md cursor-pointer"
          aria-label="FullRes Scraper Home"
        >
          <Aperture className="w-5 h-5 text-blue-600 dark:text-blue-500 shrink-0" />
          <span>FullRes</span>
        </button>

        {/* Zone 2: Clean typographic navigation tabs */}
        <nav
          role="tablist"
          aria-label="Primary Workspace Tabs"
          className="hidden md:flex items-center gap-3.5 lg:gap-7 text-[13px] lg:text-sm font-medium"
        >
          {NAV_TABS.map((tab, idx) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-desktop-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`tabpanel-${tab.id}`}
                onClick={() => onSelectTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={`relative whitespace-nowrap shrink-0 py-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-xs cursor-pointer ${
                  isActive
                    ? 'text-zinc-950 dark:text-white font-semibold'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <span>{tab.label}</span>
                {isActive && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 dark:bg-blue-500" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Theme Toggle + 1 Primary Action */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onToggleTheme}
            className="w-9 h-9 flex items-center justify-center text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onExportProjectZip}
            disabled={isExportingZip}
            className="flex items-center gap-2 px-3 lg:px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>
              {isExportingZip ? (
                'Packaging...'
              ) : (
                <>
                  <span className="hidden lg:inline">Export Project (.ZIP)</span>
                  <span className="lg:hidden">Export ZIP</span>
                </>
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Tab Strip (compact horizontal scroll on small viewports) */}
      <div
        role="tablist"
        aria-label="Mobile Workspace Tabs"
        className="md:hidden border-t border-zinc-200/70 dark:border-zinc-800/70 px-4 flex items-center gap-5 overflow-x-auto text-xs font-medium"
      >
        {NAV_TABS.map((tab, idx) => {
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
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
              className={`relative py-2.5 whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'text-zinc-950 dark:text-white font-semibold'
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
