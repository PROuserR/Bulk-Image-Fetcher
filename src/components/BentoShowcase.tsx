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
  ScanFace,
} from 'lucide-react';
import { motion } from 'motion/react';
import prismShowcaseImg from '../assets/images/ultimate_pipeline_prism_1795515690631.jpg';
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
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      aria-label="Ultimate Image Processing Modules"
      className="space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 px-1">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-[#141413] dark:text-[#F5F4F0] tracking-tight">
            Ultimate Image Processing Pipeline
          </h2>
          <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
            Load local folders or pipe extracted masters directly into AI face isolation, color grading, batch geometry, and motion synthesis.
          </p>
        </div>

        {onRunNatureSample && (
          <button
            type="button"
            onClick={onRunNatureSample}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start sm:self-auto whitespace-nowrap cursor-pointer"
          >
            <span>Try Extraction Demo</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Asymmetric Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-5 items-stretch">
        {/* Featured Tile 1 (Wide Visual): Color Grading, Filters & Cropping */}
        <article className="md:col-span-7 bg-white dark:bg-[#101218] border border-[#E2DED3] dark:border-white/[0.08] rounded-2xl overflow-hidden grid grid-cols-1 sm:grid-cols-12 group hover:-translate-y-0.5 transition-all duration-200">
          <div className="sm:col-span-5 relative min-h-[200px] bg-zinc-900 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={prismShowcaseImg.src}
              alt="Multi-coated optical filter rings and spectral glass prism on dark stone"
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300 ease-out"
            />
          </div>

          <div className="sm:col-span-7 p-5 sm:p-6 flex flex-col justify-between gap-4">
            <div>
              <div className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
                01. Optics, Grading &amp; Geometry
              </div>
              <h3 className="font-display text-lg font-bold text-[#141413] dark:text-[#F5F4F0] mt-1 tracking-tight">
                Filter Grading, AR Lenses &amp; Batch Crop
              </h3>
              <p className="text-xs sm:text-[13px] text-zinc-600 dark:text-zinc-400 mt-2 leading-relaxed">
                Non-destructive exposure, tone curves, film grain, face-anchored lenses, and exact aspect-ratio cropping rendered cleanly at full resolution.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => onSelectTab('filters')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#141413] hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-[#141413] rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>Open Filter &amp; Lenses</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectTab('crop')}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#F5F4EF] dark:bg-white/[0.06] border border-[#E2DED3] dark:border-white/[0.08] hover:border-zinc-400 dark:hover:border-white/20 text-[#141413] dark:text-zinc-200 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <Crop className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Crop &amp; Resize</span>
              </button>
            </div>
          </div>
        </article>

        {/* Featured Tile 2: AI Vision, Portrait Filtering & Gemma 4 */}
        <article className="md:col-span-5 bg-white dark:bg-[#101218] border border-[#E2DED3] dark:border-white/[0.08] rounded-2xl p-5 sm:p-6 flex flex-col justify-between gap-4 group hover:-translate-y-0.5 transition-all duration-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
                02. AI Vision &amp; Face Isolation
              </div>
              <h3 className="font-display text-lg font-bold text-[#141413] dark:text-[#F5F4F0] mt-1 tracking-tight">
                Gemma 4 &amp; Human Face Engine
              </h3>
            </div>

            {/* Tactile 3-frame portrait fan */}
            <div className="flex items-center -space-x-3 shrink-0 pt-1">
              <img
                src="/samples/humans/random_001.jpg"
                alt="Portrait sample 1"
                className="w-10 h-12 rounded-lg object-cover border-2 border-white dark:border-[#101218] -rotate-6 shadow-xs"
              />
              <img
                src="/samples/humans/random_002.jpg"
                alt="Portrait sample 2"
                className="w-10 h-12 rounded-lg object-cover border-2 border-white dark:border-[#101218] z-10 shadow-xs"
              />
              <img
                src="/samples/humans/random_003.jpg"
                alt="Portrait sample 3"
                className="w-10 h-12 rounded-lg object-cover border-2 border-white dark:border-[#101218] rotate-6 shadow-xs"
              />
            </div>
          </div>

          <p className="text-xs sm:text-[13px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Automatically exclude landscapes and background clutter with AI person detection, cluster portraits by identity, or run multimodal Gemma 4 captions.
          </p>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onSelectTab('gemma')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Gemma 4 Vision</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectTab('classifier')}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#F5F4EF] dark:bg-white/[0.06] border border-[#E2DED3] dark:border-white/[0.08] hover:border-zinc-400 dark:hover:border-white/20 text-[#141413] dark:text-zinc-200 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Face &amp; ID Sort</span>
            </button>
          </div>
        </article>

        {/* Bottom Row Tile 3: Animated GIF89a Synthesis */}
        <article className="md:col-span-4 bg-white dark:bg-[#101218] border border-[#E2DED3] dark:border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between gap-4 hover:-translate-y-0.5 transition-all duration-200">
          <div>
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
              <span>03. Motion Synthesis</span>
              <Film className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <h3 className="font-display text-base font-bold text-[#141413] dark:text-[#F5F4F0] mt-2">
              Animated GIF89a Studio
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
              Assemble multi-frame sequences with Median Cut 256-color quantization, Bayer dithering, boomerang loops, crossfades, and typography banners.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSelectTab('gif')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
          >
            <span>Launch GIF89a Motion</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </article>

        {/* Bottom Row Tile 4: Instagram & Nested Crawling */}
        <article className="md:col-span-4 bg-white dark:bg-[#101218] border border-[#E2DED3] dark:border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between gap-4 hover:-translate-y-0.5 transition-all duration-200">
          <div>
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
              <span>04. Social &amp; Nested Crawl</span>
              <Instagram className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <h3 className="font-display text-base font-bold text-[#141413] dark:text-[#F5F4F0] mt-2">
              Instagram Grids &amp; Nested Hubs
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
              Resolve multi-slide GraphSidecar carousels, paginate timelines, or recursively discover and extract linked gallery collections.
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

        {/* Bottom Row Tile 5: Harvester, Cache & Resumable Transfers */}
        <article className="md:col-span-4 bg-white dark:bg-[#101218] border border-[#E2DED3] dark:border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between gap-4 hover:-translate-y-0.5 transition-all duration-200">
          <div>
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
              <span>05. Relay &amp; Resumable Export</span>
              <Terminal className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <h3 className="font-display text-base font-bold text-[#141413] dark:text-[#F5F4F0] mt-2">
              Harvester, Cache &amp; Pause/Resume
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
              Bypass geo-blocks via in-tab JSON harvesting, reuse cached image previews, and pause or resume .7Z, .ZIP, and direct folder saves anytime.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onOpenHarvesterMode}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              <span>Open-Tab Harvester</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
              <ScanFace className="w-3 h-3" />
              <span>AI Ready</span>
            </span>
          </div>
        </article>
      </div>
    </motion.section>
  );
};
