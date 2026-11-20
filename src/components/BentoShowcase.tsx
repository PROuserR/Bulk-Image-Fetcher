'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  ArrowUpRight,
  Wand2,
  Crop,
  Film,
  Instagram,
  Terminal,
  Sparkles,
  Users,
} from 'lucide-react';
import lensShowcaseImg from '../assets/images/studio_bento_lens_1795110057979.jpg';
import { WorkspaceTabId } from './Header';

interface BentoShowcaseProps {
  onSelectTab: (tab: WorkspaceTabId) => void;
  onRunNatureSample?: () => void;
  onOpenInstagramMode: () => void;
  onOpenHarvesterMode: () => void;
}

export const BentoShowcase: React.FC<BentoShowcaseProps> = ({
  onSelectTab,
  onRunNatureSample,
  onOpenInstagramMode,
  onOpenHarvesterMode,
}) => {
  return (
    <section
      aria-label="Creative Studio Modules"
      className="space-y-4 animate-fadeIn"
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 px-1">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-[#141413] dark:text-[#F5F4F0] tracking-tight">
            Connected Post-Production &amp; Capture Suite
          </h2>
          <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
            Jump straight into any studio with local files or pipe scraped masters directly across tabs.
          </p>
        </div>

        {onRunNatureSample && (
          <button
            type="button"
            onClick={onRunNatureSample}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start sm:self-auto whitespace-nowrap cursor-pointer"
          >
            <span>Try Nature Extraction Demo</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Asymmetric Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-5">
        {/* Featured Tile 1 (Wide Visual): Color Grading, Filters & Cropping */}
        <article className="md:col-span-7 bg-white dark:bg-[#111319] border border-[#E4E0D6] dark:border-white/[0.08] rounded-2xl overflow-hidden grid grid-cols-1 sm:grid-cols-12 group hover:-translate-y-0.5 transition-all duration-200">
          <div className="sm:col-span-5 relative min-h-[190px] bg-zinc-200 dark:bg-zinc-900 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lensShowcaseImg.src}
              alt="Optical camera lenses and glass filter rings on stone"
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300 ease-out"
            />
          </div>

          <div className="sm:col-span-7 p-5 sm:p-6 flex flex-col justify-between gap-4">
            <div>
              <div className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
                01. Optics &amp; Framing
              </div>
              <h3 className="font-display text-lg font-bold text-[#141413] dark:text-[#F5F4F0] mt-1 tracking-tight">
                Filter Grading, Snapchat Lenses &amp; Batch Crop
              </h3>
              <p className="text-xs sm:text-[13px] text-zinc-600 dark:text-zinc-400 mt-2 leading-relaxed">
                Non-destructive exposure, film grain, vintage tonal presets, face-anchored lenses, and exact aspect-ratio cropping rendered cleanly in browser Canvas.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => onSelectTab('filters')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#141413] hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-[#141413] rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>Open Filter Studio</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectTab('crop')}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#F6F5F1] dark:bg-white/[0.06] border border-[#E4E0D6] dark:border-white/[0.08] hover:border-zinc-400 dark:hover:border-white/20 text-[#141413] dark:text-zinc-200 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <Crop className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Crop &amp; Resize</span>
              </button>
            </div>
          </div>
        </article>

        {/* Featured Tile 2: Animated GIF89a Motion Studio */}
        <article className="md:col-span-5 bg-white dark:bg-[#111319] border border-[#E4E0D6] dark:border-white/[0.08] rounded-2xl p-5 sm:p-6 flex flex-col justify-between gap-4 group hover:-translate-y-0.5 transition-all duration-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
                02. Motion Synthesis
              </div>
              <h3 className="font-display text-lg font-bold text-[#141413] dark:text-[#F5F4F0] mt-1 tracking-tight">
                Animated GIF89a Builder
              </h3>
            </div>

            {/* Tactile 3-frame contact fan */}
            <div className="flex items-center -space-x-3 shrink-0 pt-1">
              <img
                src="/samples/humans/random_001.jpg"
                alt="GIF sample frame 1"
                className="w-10 h-12 rounded-lg object-cover border-2 border-white dark:border-[#111319] -rotate-6 shadow-xs"
              />
              <img
                src="/samples/humans/random_002.jpg"
                alt="GIF sample frame 2"
                className="w-10 h-12 rounded-lg object-cover border-2 border-white dark:border-[#111319] z-10 shadow-xs"
              />
              <img
                src="/samples/humans/random_003.jpg"
                alt="GIF sample frame 3"
                className="w-10 h-12 rounded-lg object-cover border-2 border-white dark:border-[#111319] rotate-6 shadow-xs"
              />
            </div>
          </div>

          <p className="text-xs sm:text-[13px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Assemble multi-frame sequences with Median Cut 256-color quantization, Bayer dithering, boomerang loops, smooth crossfades, and caption banners.
          </p>

          <button
            type="button"
            onClick={() => onSelectTab('gif')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors self-start whitespace-nowrap cursor-pointer"
          >
            <Film className="w-3.5 h-3.5" />
            <span>Launch GIF Maker</span>
          </button>
        </article>

        {/* Bottom Row Tile 3: Instagram Carousels */}
        <article className="md:col-span-4 bg-white dark:bg-[#111319] border border-[#E4E0D6] dark:border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between gap-4 hover:-translate-y-0.5 transition-all duration-200">
          <div>
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
              <span>03. Social Extraction</span>
              <Instagram className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <h3 className="font-display text-base font-bold text-[#141413] dark:text-[#F5F4F0] mt-2">
              Instagram Grids &amp; Carousels
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
              Resolves multi-slide GraphSidecar posts and paginates timelines cleanly with optional session cookies.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenInstagramMode}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
          >
            <span>Open Instagram Mode</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </article>

        {/* Bottom Row Tile 4: Geo-Bypass & Progressive Save */}
        <article className="md:col-span-4 bg-white dark:bg-[#111319] border border-[#E4E0D6] dark:border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between gap-4 hover:-translate-y-0.5 transition-all duration-200">
          <div>
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
              <span>04. Browser Relay</span>
              <Terminal className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <h3 className="font-display text-base font-bold text-[#141413] dark:text-[#F5F4F0] mt-2">
              Open-Tab Harvester &amp; Relay
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
              Bypass geo-blocks or authenticated sessions with zero-friction in-tab JSON harvesting and non-UK HTML fallback.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenHarvesterMode}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
          >
            <span>Open-Tab Harvester</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </article>

        {/* Bottom Row Tile 5: Offline Local AI Suite */}
        <article className="md:col-span-4 bg-white dark:bg-[#111319] border border-[#E4E0D6] dark:border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between gap-4 hover:-translate-y-0.5 transition-all duration-200">
          <div>
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
              <span>05. Offline Vision</span>
              <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <h3 className="font-display text-base font-bold text-[#141413] dark:text-[#F5F4F0] mt-2">
              Gemma 4 AI &amp; Human Identity Sort
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
              Cluster portraits offline using local Python embeddings or multi-image caption &amp; chat via local Gemma 4.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => onSelectTab('gemma')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              <span>Gemma 4 AI</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onSelectTab('classifier')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:underline cursor-pointer"
            >
              <Users className="w-3 h-3" />
              <span>Classifier</span>
            </button>
          </div>
        </article>
      </div>
    </section>
  );
};
