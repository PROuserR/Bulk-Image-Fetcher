'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  ArrowRight,
  Sun,
  Moon,
  Download,
  Sparkles,
  Instagram,
  FolderTree,
  X,
} from 'lucide-react';
import { WorkspaceTabId } from './Header';
import { STUDIO_NAV_ITEMS } from './StudioSidebar';

interface CommandAction {
  id: string;
  label: string;
  detail: string;
  category: 'Studios' | 'Quick Actions';
  shortcut?: string;
  icon: React.FC<{ className?: string }>;
  run: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onSelectTab: (tab: WorkspaceTabId) => void;
  onRunNatureSample: () => void;
  onOpenNestedMode?: () => void;
  onOpenInstagramMode: () => void;
  onExportProjectZip: () => void;
}

/**
 * Keyboard-accessible command palette (`Cmd/Ctrl+K`) for switching between the 7 studios
 * and triggering quick sample, Instagram, nested hub, theme, and project export actions.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  theme,
  onToggleTheme,
  onSelectTab,
  onRunNatureSample,
  onOpenNestedMode,
  onOpenInstagramMode,
  onExportProjectZip,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const actions: CommandAction[] = useMemo(() => {
    const studioItems: CommandAction[] = STUDIO_NAV_ITEMS.map((item) => ({
      id: `studio-${item.id}`,
      label: item.label,
      detail: item.subtitle,
      category: 'Studios',
      shortcut: item.shortcut,
      icon: item.icon,
      run: () => {
        onSelectTab(item.id);
        onClose();
      },
    }));

    const quickItems: CommandAction[] = [
      {
        id: 'action-sample-nature',
        label: 'Run Extraction Gallery Sample',
        detail: 'Test subpage crawling, CDN un-shrinking & AI face filtering',
        category: 'Quick Actions',
        icon: Sparkles,
        run: () => {
          onSelectTab('scraper');
          onRunNatureSample();
          onClose();
        },
      },
      ...(onOpenNestedMode
        ? [
            {
              id: 'action-nested-galleries',
              label: 'Open Nested Multi-Gallery Crawler',
              detail: 'Crawl a hub webpage containing multiple child gallery URLs',
              category: 'Quick Actions' as const,
              icon: FolderTree,
              run: () => {
                onSelectTab('scraper');
                onOpenNestedMode();
                onClose();
              },
            },
          ]
        : []),
      {
        id: 'action-instagram',
        label: 'Open Instagram Profile Extractor',
        detail: 'Extract public grids, carousels & timelines',
        category: 'Quick Actions',
        icon: Instagram,
        run: () => {
          onSelectTab('scraper');
          onOpenInstagramMode();
          onClose();
        },
      },
      {
        id: 'action-theme',
        label: `Switch to ${theme === 'dark' ? 'Archival Light' : 'Calibrated Dark'} Theme`,
        detail: 'Toggle Ultimate Image Processor workspace theme',
        category: 'Quick Actions',
        icon: theme === 'dark' ? Sun : Moon,
        run: () => {
          onToggleTheme();
          onClose();
        },
      },
      {
        id: 'action-export-zip',
        label: 'Export Full Project Archive (.ZIP)',
        detail: 'Download ready-to-run codebase package',
        category: 'Quick Actions',
        icon: Download,
        run: () => {
          onExportProjectZip();
          onClose();
        },
      },
    ];

    return [...studioItems, ...quickItems];
  }, [
    theme,
    onToggleTheme,
    onSelectTab,
    onRunNatureSample,
    onOpenNestedMode,
    onOpenInstagramMode,
    onExportProjectZip,
    onClose,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.detail.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
    );
  }, [actions, query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((prev) =>
          filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0
        );
      } else if (e.key === 'Enter' && filtered[selectedIdx]) {
        e.preventDefault();
        filtered[selectedIdx].run();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, filtered, selectedIdx, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ultimate Image Processor Command Palette"
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden animate-fadeIn"
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#DCE1EB] dark:border-white/[0.08]">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            placeholder="Jump to a processing studio, run a sample, or switch theme..."
            className="flex-1 bg-transparent text-sm text-[#0F141F] dark:text-white placeholder-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No matching studios or actions.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={item.run}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : 'text-[#0F141F] dark:text-slate-100 hover:bg-[#F4F6F9] dark:hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-white/20 text-white'
                          : 'bg-[#EEF1F6] dark:bg-white/[0.06] text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{item.label}</div>
                      <div
                        className={`text-[11px] truncate ${
                          isSelected ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {item.detail}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[10px] font-medium ${
                        isSelected ? 'text-blue-100' : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {item.category}
                    </span>
                    {item.shortcut ? (
                      <kbd
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : 'bg-[#EEF1F6] dark:bg-white/[0.06] text-slate-500'
                        }`}
                      >
                        {item.shortcut}
                      </kbd>
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5 opacity-60" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
