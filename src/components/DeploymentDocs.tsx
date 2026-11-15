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
            Download the self-contained Python Flask application or the entire full-stack monorepo with one click:
          </p>
        </div>

        {/* 1-Click Download Options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <a
            href="/api/export-flask-project"
            download="flask_image_scraper_project.zip"
            className="flex items-center justify-between gap-4 p-4 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl hover:border-blue-500/60 dark:hover:border-blue-500/50 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold font-mono text-sm shrink-0">
                Py
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                  Python Flask App (.ZIP)
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  app.py, scraper.py, templates, static assets &amp; Dockerfile
                </p>
              </div>
            </div>
            <span className="px-3 py-1.5 bg-blue-600 text-white font-semibold text-xs rounded-lg shrink-0">
              Download ZIP
            </span>
          </a>

          <a
            href="/api/export-full-project"
            download="fullres_scraper_full_codebase.zip"
            className="flex items-center justify-between gap-4 p-4 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center font-bold font-mono text-sm shrink-0">
                All
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                  Full Codebase (.ZIP)
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  Full monorepo (Python Flask + React + Vite + Express + tests)
                </p>
              </div>
            </div>
            <span className="px-3 py-1.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-semibold text-xs rounded-lg shrink-0">
              Download All
            </span>
          </a>
        </div>

        {/* Steps Grid — Clean Flat Hairline Columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
          {/* Step 1: Virtualenv */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-blue-600 dark:text-blue-500" />
                <span>1. Local Setup with Virtualenv</span>
              </h3>
              <button
                onClick={() =>
                  copyToClipboard(
                    'python3 -m venv venv\nsource venv/bin/activate\npip install -r requirements.txt\npython app.py',
                    'venv'
                  )
                }
                className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Copy commands"
              >
                {copiedId === 'venv' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Create an isolated Python 3.10+ environment and install dependencies:
            </p>
            <div className="bg-[#0B0C10] border border-zinc-800 text-zinc-100 p-3.5 rounded-lg font-mono text-xs leading-relaxed overflow-x-auto">
              <code>
                cd flask_app<br />
                python3 -m venv venv<br />
                source venv/bin/activate<br />
                pip install -r requirements.txt<br />
                python app.py
              </code>
            </div>
          </div>

          {/* Step 2: Docker */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                <Box className="w-4 h-4 text-blue-600 dark:text-blue-500" />
                <span>2. Containerized Deployment (Docker)</span>
              </h3>
              <button
                onClick={() =>
                  copyToClipboard(
                    'docker build -t fullres-scraper .\ndocker run -p 5000:5000 fullres-scraper',
                    'docker'
                  )
                }
                className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Copy commands"
              >
                {copiedId === 'docker' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Build a production container using multi-stage Python 3.11-slim:
            </p>
            <div className="bg-[#0B0C10] border border-zinc-800 text-zinc-100 p-3.5 rounded-lg font-mono text-xs leading-relaxed overflow-x-auto">
              <code>
                cd flask_app<br />
                docker build -t fullres-scraper .<br />
                docker run -d -p 5000:5000 fullres-scraper
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
                Scrapes webpage, parses srcset and lazy attributes, resolves original full-size masters.
              </p>
              <pre className="bg-[#0B0C10] border border-zinc-800 text-zinc-200 p-3 rounded-lg font-mono text-[11px] overflow-x-auto">
                {`curl -X POST http://localhost:5000/api/scrape \\
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
                Creates an in-memory streaming ZIP archive of selected image URLs.
              </p>
              <pre className="bg-[#0B0C10] border border-zinc-800 text-zinc-200 p-3 rounded-lg font-mono text-[11px] overflow-x-auto">
                {`curl -X POST http://localhost:5000/api/download-zip \\
  -H "Content-Type: application/json" \\
  -d '{"images": [{"url": "https://images.unsplash.com/photo-...", "filename": "photo.jpg"}]}' \\
  --output downloaded_images.zip`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
