'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Terminal,
  Copy,
  Check,
  Server,
  Box,
  Play,
  FileJson,
  Loader2,
  Sliders,
  ExternalLink,
} from 'lucide-react';
import { COLOR_PRESETS, type ColorPresetId } from '../utils/imageFilterLogic';
import { fetchApiJson } from '../utils/safeFetchJson';

type SnippetLang = 'curl' | 'typescript' | 'python';

function createValidGradientSamplePng(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 96, 96);
    grad.addColorStop(0, '#2563eb');
    grad.addColorStop(0.5, '#f59e0b');
    grad.addColorStop(1, '#ec4899');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 96, 96);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(48, 48, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas.toDataURL('image/png');
}

/**
 * In-app Deployment, Codebase Export & Consumer REST API Hub (`Deployment & API` studio tab).
 * Exposes `/api/health`, `/api/openapi.json`, `/api/process`, `/api/scrape`,
 * `/api/ai/human-face-filter`, and `/api/download-zip` with copyable SDK snippets
 * and a live `/api/health` + `/api/process` interactive verifier.
 */
export const DeploymentDocs: React.FC = () => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [snippetLang, setSnippetLang] = useState<SnippetLang>('curl');

  // Live Consumer API Tester state
  const [selectedPreset, setSelectedPreset] = useState<ColorPresetId>('golden_hour');
  const [selectedFormat, setSelectedFormat] = useState<'webp' | 'png' | 'jpeg'>('webp');
  const [isTestingHealth, setIsTestingHealth] = useState(false);
  const [isTestingProcess, setIsTestingProcess] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<{
    endpoint: string;
    status: number;
    summary: string;
    jsonPreview: string;
    outputDataUri?: string;
    error?: string;
  } | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleTestHealth = async () => {
    setIsTestingHealth(true);
    try {
      const parsed = await fetchApiJson('/api/health');
      setApiTestResult({
        endpoint: 'GET /api/health',
        status: parsed.status,
        summary: parsed.ok ? 'Service healthy & OpenAPI ready' : 'Health check failed',
        jsonPreview: JSON.stringify(parsed.data, null, 2),
        error: parsed.error || undefined,
      });
    } catch (err: any) {
      setApiTestResult({
        endpoint: 'GET /api/health',
        status: 500,
        summary: 'Network error',
        jsonPreview: '',
        error: err?.message || 'Request failed',
      });
    } finally {
      setIsTestingHealth(false);
    }
  };

  const handleTestProcess = async () => {
    setIsTestingProcess(true);
    try {
      const sampleDataUri = createValidGradientSamplePng();
      const parsed = await fetchApiJson('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: sampleDataUri,
          preset: selectedPreset,
          resize: { mode: 'exact', width: 96, height: 96, lockAspect: false },
          format: selectedFormat,
          quality: 90,
          responseType: 'json',
        }),
      });
      const data = parsed.data || {};
      const redacted = { ...data };
      if (typeof redacted.imageBase64 === 'string') {
        redacted.imageBase64 = `<base64 ${redacted.imageBase64.length} chars>`;
      }
      if (typeof redacted.dataUri === 'string') {
        redacted.dataUri = `<dataUri ${redacted.dataUri.length} chars>`;
      }

      setApiTestResult({
        endpoint: 'POST /api/process',
        status: parsed.status,
        summary: parsed.ok
          ? `Processed ${data.width}×${data.height} ${String(data.format || '').toUpperCase()} (${data.sizeBytes} bytes)`
          : 'Processing failed',
        jsonPreview: JSON.stringify(redacted, null, 2),
        outputDataUri: typeof data.dataUri === 'string' ? data.dataUri : undefined,
        error: parsed.error || undefined,
      });
    } catch (err: any) {
      setApiTestResult({
        endpoint: 'POST /api/process',
        status: 500,
        summary: 'Request failed',
        jsonPreview: '',
        error: err?.message || 'Request failed',
      });
    } finally {
      setIsTestingProcess(false);
    }
  };

  const processSnippet =
    snippetLang === 'curl'
      ? `curl -X POST http://localhost:3000/api/process \\
  -H "Content-Type: application/json" \\
  -d '{
    "imageUrl": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1600",
    "preset": "golden_hour",
    "resize": { "mode": "maxEdge", "maxEdge": 1280 },
    "format": "webp",
    "quality": 90
  }' --output graded_portrait.webp`
      : snippetLang === 'typescript'
        ? `const res = await fetch('http://localhost:3000/api/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1600',
    preset: 'golden_hour',
    resize: { mode: 'maxEdge', maxEdge: 1280 },
    format: 'webp',
    responseType: 'json',
  }),
});
const { dataUri, width, height } = await res.json();`
        : `import requests

resp = requests.post(
    "http://localhost:3000/api/process",
    json={
        "imageUrl": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1600",
        "preset": "golden_hour",
        "resize": {"mode": "maxEdge", "maxEdge": 1280},
        "format": "webp",
    },
    timeout=30,
)
resp.raise_for_status()
open("graded_portrait.webp", "wb").write(resp.content)`;

  const scrapeSnippet =
    snippetLang === 'curl'
      ? `curl -X POST http://localhost:3000/api/scrape \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://en.wikipedia.org/wiki/Yosemite_National_Park"}'`
      : snippetLang === 'typescript'
        ? `const res = await fetch('http://localhost:3000/api/scrape', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://en.wikipedia.org/wiki/Yosemite_National_Park' }),
});
const { images, stats } = await res.json();`
        : `import requests

data = requests.post(
    "http://localhost:3000/api/scrape",
    json={"url": "https://en.wikipedia.org/wiki/Yosemite_National_Park"},
    timeout=30,
).json()
print(len(data["images"]), "masters extracted")`;

  const faceFilterSnippet =
    snippetLang === 'curl'
      ? `curl -X POST http://localhost:3000/api/ai/human-face-filter \\
  -H "Content-Type: application/json" \\
  -d '{"images": [{"id": "img_1", "url": "https://example.com/portrait.jpg"}]}'`
      : snippetLang === 'typescript'
        ? `const res = await fetch('http://localhost:3000/api/ai/human-face-filter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    images: [{ id: 'img_1', url: 'https://example.com/portrait.jpg' }],
  }),
});
const { results } = await res.json();`
        : `import requests

verdicts = requests.post(
    "http://localhost:3000/api/ai/human-face-filter",
    json={"images": [{"id": "img_1", "url": "https://example.com/portrait.jpg"}]},
    timeout=30,
).json()`;

  const archiveSnippet =
    snippetLang === 'curl'
      ? `curl -X POST http://localhost:3000/api/download-zip \\
  -H "Content-Type: application/json" \\
  -d '{"format": "7z", "images": [{"url": "https://example.com/photo.jpg", "filename": "photo.jpg"}]}' \\
  --output ultimate_archive.7z`
      : snippetLang === 'typescript'
        ? `const res = await fetch('http://localhost:3000/api/download-zip', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    format: '7z',
    images: [{ url: 'https://example.com/photo.jpg', filename: 'photo.jpg' }],
  }),
});
const blob = await res.blob();`
        : `import requests

archive = requests.post(
    "http://localhost:3000/api/download-zip",
    json={"format": "7z", "images": [{"url": "https://example.com/photo.jpg", "filename": "photo.jpg"}]},
    timeout=60,
)
open("ultimate_archive.7z", "wb").write(archive.content)`;

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-xl p-6 sm:p-8 transition-colors">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1.5">
              <Server className="w-3.5 h-3.5" />
              <span>Consumer REST API, OpenAPI 3.1 &amp; Codebase Deployment</span>
            </div>
            <h2 className="text-2xl font-display font-bold text-[#0F141F] dark:text-slate-50 tracking-tight">
              FrameVault API &amp; Self-Hosting
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
              Consume extraction, AI human-face isolation, stateless <code className="font-mono text-xs">/api/process</code> image grading, and LZMA2 <code className="font-mono text-xs">.7z</code> packaging programmatically via REST, or download the complete Next.js 16 source tree.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href="/api/openapi.json"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-[#171C28] text-slate-800 dark:text-slate-100 hover:border-blue-500/60 transition-colors"
            >
              <FileJson className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>OpenAPI 3.1 JSON</span>
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
            <a
              href="/api/export-full-project"
              download="ultimate_image_processor_codebase.zip"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg transition-colors"
            >
              <span>Download Codebase (.ZIP)</span>
            </a>
          </div>
        </div>

        {/* Live Consumer API Sandbox */}
        <div className="mb-8 p-4 sm:p-5 rounded-xl bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.08] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#0F141F] dark:text-slate-50 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Interactive Consumer API Sandbox</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Verify live JSON responses from <code className="font-mono">GET /api/health</code> and <code className="font-mono">POST /api/process</code> directly against this server.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Color preset for API process test"
                value={selectedPreset}
                onChange={(e) => setSelectedPreset(e.target.value as ColorPresetId)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-white dark:bg-[#141720] text-slate-800 dark:text-slate-100"
              >
                {COLOR_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    Preset: {p.label}
                  </option>
                ))}
              </select>

              <select
                aria-label="Output format for API process test"
                value={selectedFormat}
                onChange={(e) => setSelectedFormat(e.target.value as 'webp' | 'png' | 'jpeg')}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-white dark:bg-[#141720] text-slate-800 dark:text-slate-100"
              >
                <option value="webp">Format: WebP</option>
                <option value="png">Format: PNG</option>
                <option value="jpeg">Format: JPEG</option>
              </select>

              <button
                type="button"
                onClick={handleTestHealth}
                disabled={isTestingHealth}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-white dark:bg-[#141720] text-slate-800 dark:text-slate-100 hover:border-blue-500/60 disabled:opacity-50 cursor-pointer"
              >
                {isTestingHealth ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 text-emerald-600" />}
                <span>Test /api/health</span>
              </button>

              <button
                type="button"
                onClick={handleTestProcess}
                disabled={isTestingProcess}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 cursor-pointer"
              >
                {isTestingProcess ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                <span>Run /api/process Sample</span>
              </button>
            </div>
          </div>

          {apiTestResult && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-3 border-t border-[#DCE1EB] dark:border-white/[0.08]">
              <div className={apiTestResult.outputDataUri ? 'lg:col-span-9 space-y-2' : 'lg:col-span-12 space-y-2'}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {apiTestResult.endpoint} → HTTP {apiTestResult.status}
                  </span>
                  <span className={apiTestResult.error ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-emerald-600 dark:text-emerald-400 font-medium'}>
                    {apiTestResult.error || apiTestResult.summary}
                  </span>
                </div>
                {apiTestResult.jsonPreview && (
                  <pre className="bg-[#090C12] border border-slate-800 text-slate-200 p-3 rounded-lg font-mono text-[11px] max-h-52 overflow-auto">
                    {apiTestResult.jsonPreview}
                  </pre>
                )}
              </div>

              {apiTestResult.outputDataUri && (
                <div className="lg:col-span-3 flex flex-col items-center justify-center p-3 rounded-lg bg-white dark:bg-[#141720] border border-[#DCE1EB] dark:border-white/[0.08]">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">
                    Processed Output Preview
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={apiTestResult.outputDataUri}
                    alt="API process sample output"
                    className="w-24 h-24 rounded-md object-contain border border-slate-200 dark:border-slate-700"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* REST API Consumer Snippets */}
        <div className="pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h3 className="text-base font-display font-bold text-[#0F141F] dark:text-slate-50">
              REST API Consumer Integration
            </h3>
            <div className="inline-flex rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] p-0.5 bg-[#F4F6F9] dark:bg-[#090C12]">
              {(['curl', 'typescript', 'python'] as SnippetLang[]).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setSnippetLang(lang)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md capitalize cursor-pointer transition-colors ${
                    snippetLang === lang
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  }`}
                >
                  {lang === 'curl' ? 'cURL' : lang === 'typescript' ? 'TypeScript' : 'Python'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
            {[
              {
                id: 'api-process',
                method: 'POST',
                path: '/api/process',
                desc: 'Stateless image crop, resize, studio preset / 14-slider color grading, format conversion (JPEG/PNG/WebP/AVIF), and optional AI face metadata.',
                code: processSnippet,
              },
              {
                id: 'api-scrape',
                method: 'POST',
                path: '/api/scrape',
                desc: 'Extracts full-resolution master URLs from webpages, Instagram profiles, or manifests (use /api/scrape/nested for multi-gallery hubs).',
                code: scrapeSnippet,
              },
              {
                id: 'api-face',
                method: 'POST',
                path: '/api/ai/human-face-filter',
                desc: 'Evaluates up to 12 images via Gemini multimodal vision to retain human portraits and exclude landscapes/icons.',
                code: faceFilterSnippet,
              },
              {
                id: 'api-zip',
                method: 'POST',
                path: '/api/download-zip',
                desc: 'Builds compressed LZMA2 .7z or .zip archives cleanly (supports NDJSON progress streaming and GET Range 206 resume).',
                code: archiveSnippet,
              },
            ].map((item) => (
              <div key={item.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-mono font-semibold text-zinc-950 dark:text-zinc-100">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                      {item.method}
                    </span>
                    <span>{item.path}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(item.code, item.id)}
                    className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded cursor-pointer"
                    aria-label={`Copy ${item.path} example`}
                  >
                    {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-slate-600 dark:text-slate-400">{item.desc}</p>
                <pre className="bg-[#090C12] border border-slate-800 text-slate-200 p-3 rounded-lg font-mono text-[11px] overflow-x-auto">
                  {item.code}
                </pre>
              </div>
            ))}
          </div>
        </div>

        {/* Local Development & Production Steps */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8 pt-6 border-t border-[#DCE1EB] dark:border-white/[0.08]">
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
              Install npm packages, optionally bootstrap the offline Python AI worker, and start Next.js 16 on port 3000:
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

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                <Box className="w-4 h-4 text-blue-600 dark:text-blue-500" />
                <span>2. Test, Type-Check &amp; Production Build</span>
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
              Run all unit tests, verify TypeScript types, build Next.js production bundles, and launch the server:
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
      </div>
    </div>
  );
};
