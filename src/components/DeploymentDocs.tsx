'use client';

import React, { useState } from 'react';
import { Terminal, Copy, Check, Server, Box } from 'lucide-react';

export const DeploymentDocs: React.FC = () => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 sm:p-8 transition-colors">
        <div className="max-w-3xl mb-6">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1.5">
            <Server className="w-3.5 h-3.5" />
            <span>Setup, Download &amp; Deployment Guide</span>
          </div>
          <h2 className="text-2xl font-display font-bold text-zinc-950 dark:text-zinc-50 tracking-tight">
            How to Download &amp; Run This Project
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2 leading-relaxed">
            Download the full-stack Next.js 16 (App Router), Tailwind CSS v4, and TypeScript codebase in one click and run it locally or in production:
          </p>
        </div>

        {/* 1-Click Download Option */}
        <div className="mb-8">
          <a
            href="/api/export-full-project"
            download="fullres_scraper_full_codebase.zip"
            className="flex items-center justify-between gap-4 p-4 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl hover:border-blue-500/60 dark:hover:border-blue-500/50 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold font-mono text-sm shrink-0">
                NX
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                  Full Codebase (.ZIP)
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  Next.js 16 App Router API routes, sharp image pipeline, TypeScript extractors, and unit tests
                </p>
              </div>
            </div>
            <span className="px-3.5 py-2 bg-blue-600 text-white font-semibold text-xs rounded-lg shrink-0 whitespace-nowrap">
              Download ZIP
            </span>
          </a>
        </div>

        {/* Steps Grid — Clean Flat Hairline Columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
          {/* Step 1: Local Development */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-blue-600 dark:text-blue-500" />
                <span>1. Local Development (Node.js 20+)</span>
              </h3>
              <button
                type="button"
                onClick={() =>
                  copyToClipboard(
                    'npm install\npython3 -m venv .venv && .venv/bin/pip install -r python/requirements.txt\nnpm run dev',
                    'dev'
                  )
                }
                className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Copy commands"
                aria-label="Copy local development commands"
              >
                {copiedId === 'dev' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Install npm packages, bootstrap the offline Python AI environment, and launch Next.js 16 on port 3000:
            </p>
            <div className="bg-[#0B0C10] border border-zinc-800 text-zinc-100 p-3.5 rounded-lg font-mono text-xs leading-relaxed overflow-x-auto">
              <code>
                npm install<br />
                python3 -m venv .venv &amp;&amp; .venv/bin/pip install -r python/requirements.txt<br />
                npm run dev<br />
                # Open http://localhost:3000
              </code>
            </div>
          </div>

          {/* Step 2: Test & Production Build */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                <Box className="w-4 h-4 text-blue-600 dark:text-blue-500" />
                <span>2. Test, Build &amp; Production Start</span>
              </h3>
              <button
                type="button"
                onClick={() =>
                  copyToClipboard(
                    'npm test\nnpm run lint\nnpm run build\nnpm start',
                    'prod'
                  )
                }
                className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Copy commands"
                aria-label="Copy test and production commands"
              >
                {copiedId === 'prod' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Run unit tests, verify TypeScript types, build Next.js production bundles, and launch the server:
            </p>
            <div className="bg-[#0B0C10] border border-zinc-800 text-zinc-100 p-3.5 rounded-lg font-mono text-xs leading-relaxed overflow-x-auto">
              <code>
                npm test &amp;&amp; npm run lint<br />
                npm run build<br />
                npm start
              </code>
            </div>
          </div>
        </div>

        {/* REST API Quick Reference */}
        <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-zinc-800">
          <h3 className="text-base font-display font-bold text-zinc-950 dark:text-zinc-50 mb-4">
            REST API Integration Reference
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-mono font-semibold text-zinc-950 dark:text-zinc-100">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  POST
                </span>
                <span>/api/scrape</span>
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">
                Scrapes a webpage URL or Instagram profile, parses srcset and lazy attributes, and resolves full-size masters.
              </p>
              <pre className="bg-[#0B0C10] border border-zinc-800 text-zinc-200 p-3 rounded-lg font-mono text-[11px] overflow-x-auto">
                {`curl -X POST http://localhost:3000/api/scrape \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://en.wikipedia.org/wiki/Yosemite_National_Park"}'`}
              </pre>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 font-mono font-semibold text-zinc-950 dark:text-zinc-100">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  POST
                </span>
                <span>/api/download-zip</span>
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">
                Creates an in-memory streaming ZIP archive of selected full-resolution image URLs.
              </p>
              <pre className="bg-[#0B0C10] border border-zinc-800 text-zinc-200 p-3 rounded-lg font-mono text-[11px] overflow-x-auto">
                {`curl -X POST http://localhost:3000/api/download-zip \\
  -H "Content-Type: application/json" \\
  -d '{"images": [{"url": "https://example.com/photo.jpg", "filename": "photo.jpg"}]}' \\
  --output downloaded_images.zip`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
