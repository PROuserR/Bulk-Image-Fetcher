import React from 'react';
import { Download, Sun, Moon, Aperture } from 'lucide-react';

interface HeaderProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  activeTab: 'scraper' | 'code' | 'docs';
  onSelectTab: (tab: 'scraper' | 'code' | 'docs') => void;
  onExportFlaskZip: () => void;
  isExportingZip: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  theme,
  onToggleTheme,
  activeTab,
  onSelectTab,
  onExportFlaskZip,
  isExportingZip,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/90 dark:bg-[#0D0F16]/90 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800/80 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('scraper')}
          className="flex items-center gap-2.5 text-zinc-950 dark:text-zinc-50 font-display font-bold text-lg tracking-tight hover:opacity-85 transition-opacity whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-md"
          aria-label="FullRes Scraper Home"
        >
          <Aperture className="w-5 h-5 text-blue-600 dark:text-blue-500 shrink-0" />
          <span>FullRes</span>
        </button>

        {/* Zone 2: Clean typographic navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
          <button
            type="button"
            onClick={() => onSelectTab('scraper')}
            className={`relative whitespace-nowrap shrink-0 py-4 transition-colors focus-visible:outline-none ${
              activeTab === 'scraper'
                ? 'text-zinc-950 dark:text-white font-semibold'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <span>Scraper Studio</span>
            {activeTab === 'scraper' && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 dark:bg-blue-500" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('code')}
            className={`relative whitespace-nowrap shrink-0 py-4 transition-colors focus-visible:outline-none ${
              activeTab === 'code'
                ? 'text-zinc-950 dark:text-white font-semibold'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <span>Flask Codebase</span>
            {activeTab === 'code' && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 dark:bg-blue-500" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('docs')}
            className={`relative whitespace-nowrap shrink-0 py-4 transition-colors focus-visible:outline-none ${
              activeTab === 'docs'
                ? 'text-zinc-950 dark:text-white font-semibold'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <span>Setup & Deployment</span>
            {activeTab === 'docs' && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 dark:bg-blue-500" />
            )}
          </button>
        </nav>

        {/* Zone 3: Theme Toggle + 1 Primary Action */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onToggleTheme}
            className="w-9 h-9 flex items-center justify-center text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onExportFlaskZip}
            disabled={isExportingZip}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>
              {isExportingZip ? (
                'Packaging...'
              ) : (
                <>
                  <span className="hidden sm:inline">Export Flask App (.ZIP)</span>
                  <span className="sm:hidden">Export ZIP</span>
                </>
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Tab Strip (compact horizontal scroll on small viewports) */}
      <div className="md:hidden border-t border-zinc-200/70 dark:border-zinc-800/70 px-4 flex items-center gap-5 overflow-x-auto text-xs font-medium">
        {(['scraper', 'code', 'docs'] as const).map((tabId) => {
          const label =
            tabId === 'scraper'
              ? 'Scraper Studio'
              : tabId === 'code'
                ? 'Flask Codebase'
                : 'Setup & Deployment';
          const isActive = activeTab === tabId;
          return (
            <button
              key={tabId}
              type="button"
              onClick={() => onSelectTab(tabId)}
              className={`relative py-2.5 whitespace-nowrap shrink-0 ${
                isActive
                  ? 'text-zinc-950 dark:text-white font-semibold'
                  : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {label}
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
