# Ultimate Image Processor — Capture, AI Vision, Color Grading & Post-Production Suite

> **Extract true full-resolution masters from any gallery, hub, or profile—then isolate human subjects with AI, grade colors and AR lenses, build animated GIF89a motion, cluster identities, and ship lossless batches in one Next.js 16 workstation.**

**Ultimate Image Processor** is a full-stack **Next.js 16 (App Router)**, **React 19**, **Tailwind CSS v4**, and **TypeScript** creative-engineering suite featuring a darkroom-inspired **Studio Rail** workspace (`Capture Studio`, `Crop & Resize`, `Filter & Lenses`, `GIF89a Motion`, `Face & ID Sort`, `Gemma 4 Vision`, and `Deployment & API`), a **`Cmd/Ctrl+K` Command Palette**, light/dark studio themes, and multi-layer client + server caching.

---

## End-to-End Architecture

```text
  Webpage URL · Nested Hub · Instagram Profile · Local Folder · Scraped Batch
                                       │
                                       ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ 1. Capture Studio & Multi-Gallery Extraction                            │
  │    • Cheerio DOM, JSON-LD, srcset / data-* heuristics & CDN un-shrinking│
  │    • Nested Hub crawler (/api/scrape/discover-galleries & /nested)      │
  │    • 3-Tier Instagram scraper (got-scraping / SSR / playwright-core)    │
  │    • Open-Tab DevTools Harvester & non-UK CORS/Geo-block relay support  │
  └───────────────────┬─────────────────────────────────┬───────────────────┘
                      │                                 │
                      ▼                                 ▼
  ┌───────────────────────────────────────┐ ┌───────────────────────────────┐
  │ 2. AI Vision & Contact-Sheet Triage   │ │ 3. Processing & Motion Studios│
  │ • Only Person · Exclude Landscape (AI)│ │ • Crop & Resize (Canvas/sharp)│
  │   (Gemini 3.1 Flash-Lite + LRU cache) │ │ • Filter & Lenses (14 FX + AR)│
  │ • Stackable AND filter workbench      │ │ • GIF89a Maker (Median Cut)   │
  │ • Client LRU Blob cache (no re-fetch) │ │ • Face & ID Sort + Gemma 4 E2B│
  └───────────────────┬───────────────────┘ └───────────────┬───────────────┘
                      │                                     │
                      ▼                                     ▼
        Resumable .7Z (LZMA2) / .ZIP (Range 206) · Direct Disk Folder
```

---

## Core Capabilities

### 1. Capture Studio (Webpages, Nested Hubs & Instagram)
- **CDN & CMS Un-shrinking**: Rewrites width-capped and cropped URL derivatives across **WordPress** (`-300x200.jpg`), **Wikimedia Commons** (`/thumb/`), **Unsplash** (`w=` / `crop`), **Cloudinary**, **Shopify** (`_master`), **Flickr**, **Pinterest** (`/originals/`), **Blogger / Google** (`/s0/`), **YouTube** (`maxresdefault.jpg`), and generic `<picture>` / `srcset` / lazy-load attributes.
- **Linked Detail-Page & Pagination Crawler**: Follows `/photo/<id>/`, `/item/`, and paginated subpages to uncover signed CDN masters and Schema.org `contentUrl` targets.
- **Nested Multi-Gallery Hub Crawler** (`/api/scrape/discover-galleries` & `/api/scrape/nested`): Discovers and ranks child albums from hub/category/search pages (including multi-page hub pagination and `/video/<slug>/` intermediate links), queues selectable child galleries, and merges all images with `galleryId`/`galleryTitle` provenance.
- **3-Tier Instagram Profile Pipeline** (`/api/instagram/profile`): Combines TLS-fingerprinted HTTP (`got-scraping`), SSR hydration JSON parsing, and a `playwright-core` browser fallback with carousel expansion, HD avatars, pagination resume, and optional in-memory `sessionid`.
- **Resilient Intake Fallbacks**: Custom CORS/Geo-block Relay URLs, **Paste Previews / HTML / JSON**, and a **DevTools Open-Tab Harvester** snippet generator (`harvesterScripts.ts`).

### 2. AI Human-Face Filter (`Only Person · Exclude Landscape (AI)`) & Stackable Workbench
- **One-Click AI Subject Isolation**: Filter scraped images down to frames containing visible human faces—automatically excluding nature scenery, landscapes, objects, icons, and empty spacers—accessible directly in the gallery toolbar right alongside **Caption with Gemma 4**.
- **Smart Multimodal Vision Pipeline** (`/api/ai/human-face-filter`, `humanFaceFilterService.ts`): Normalizes images via `sharp` (`<=384px` JPEG, magic-byte check, `<16px` icon short-circuiting), falls back cleanly to browser-captured preview data URIs when hotlink guards block server egress, evaluates batches of 12 via `@google/genai` (**`gemini-3.1-flash-lite`** primary with **`gemini-4-hydrogen`** transient fallback), and caches verdicts in a 30-minute LRU cache.
- **Composable AND Filter Stack**: Combine **Only Person · Exclude Landscape (AI)**, **Full Masters Only**, **Previewable / No Blanks**, **Un-shrunk**, **HD / 4K (`≥1920px`)**, **Has Subpage**, **Hide Icons / GIFs**, **Format**, **Resolution Tier**, **Orientation**, **Gallery Filter**, and instant text search.

### 3. Resumable `.7Z` / `.ZIP` & Direct Folder Downloads
- **Staged `.7Z` (LZMA2) & `.ZIP` Archives** (`/api/download-zip`, `archiveBuilder.ts`, `archiveDownloader.ts`): Streams NDJSON progress (`fetching` → `compressing` via native `7zip-bin` multi-threaded LZMA2 or `JSZip` → `ready` staged token), supports **Pause / Resume** over HTTP `Range` (`206 Partial Content`), and falls back automatically to in-browser `JSZip` if remote hosts reject server packaging.
- **Resumable Direct Folder & Individual Queue** (`progressiveDownloader.ts`): Saves masters concurrently into a user-chosen local folder (File System Access API) or browser downloads with `localStorage` pause/resume checkpoints and zero-double-fetch reuse of already cached preview Blobs.

### 4. Batch Crop & Resize Studio
- **Dual Processing Engines**: Run lossless HTML5 Canvas transforms on browser-dropped folders (`webkitdirectory`), local files, built-in test plates, or handed-off scraped batches—or scan any absolute local server directory (`/api/crop-resize/scan-dir`) and batch-process via native C++ **`sharp`** (`/api/crop-resize/process-dir`).
- **Interactive 8-Handle Crop Canvas**: Rule-of-thirds overlay, freeform/locked aspect ratios (`Original`, `1:1`, `4:5`, `16:9`, `3:2`, `4:3`, `9:16`), pixel-exact resize modes (`Original`, `Width × Height`, `Fit Max Edge`, `Percentage Scale`), and `JPEG`/`PNG`/`WebP`/`AVIF` export.

### 5. Non-Destructive Filter & Lenses Studio
- **Color Grading & Studio Presets** (`FilterStudio.tsx`, `imageFilterLogic.ts`, `canvasFilterRenderer.ts`): Real-time 14-parameter pipeline (`Brightness`, `Contrast`, `Saturation`, `Exposure`, `Warmth`, `Tint`, `Grayscale`, `Sepia`, `Hue Rotate`, `Blur`, `Sharpen`, `Vignette`, `Film Grain`, `Invert`) plus 8 curated presets (`Original`, `B&W Noir`, `Vintage Sepia`, `Golden Hour`, `Crisp Vivid`, `Matte Film`, `Cool Nordic`, `Cyber Neon`) and split-screen Before/After comparison.
- **9 Face-Anchored AR & Optical Lenses**: Automatic YCbCr skin-portrait head anchor estimation with draggable target controls for `Puppy Ears`, `Flower Crown`, `Heart Blush`, `Rainbow Aura`, `Cool Shades`, `Gold Butterflies`, `90s VHS`, `Fisheye Bulge`, and `Comic Pop`, plus single-image or batch ZIP export.

### 6. Animated GIF89a Motion Studio
- **Pure Client GIF89a Synthesizer** (`GifMakerStudio.tsx`, `gifMakerLogic.ts`, `gifEncoder.ts`): Reorderable storyboard frames, **Median Cut 256-color quantization** with optional **4×4 Bayer ordered dithering**, **Forward / Reverse / Boomerang** playback, frame **crossfade morphing**, **aspect-ratio crop fitting**, live frame timing FPS controls, and styled **top/bottom caption overlays**.

### 7. Offline Human Identity Classifier & Gemma 4 Vision Studio
- **Face & ID Sort** (`HumanClassifierStudio.tsx`, `/api/ai/classify-humans/*`): Clusters browser files, scraped selections, or server folders into per-person folders using local Python (**InsightFace `buffalo_l`**, **MediaPipe Pose Landmarker**, and **scikit-learn**) or Gemini multimodal grouping, with editable group labels, folder writeback, and ZIP export.
- **Gemma 4 Vision Studio** (`GemmaStudio.tsx`, `/api/ai/gemma/*`): Connects to a local `llama.cpp` (`llama-server`) instance running **Gemma 4 E2B + vision projector** for multi-image conversational analysis and batch auto-captioning (`Concise`, `Detailed`, `Structured JSON`, `Alt-Text`) with optional `.txt` sidecar generation and JSON/CSV/Markdown/ZIP export.

---

## Performance, Caching & Next.js 16 Architecture

- **Client Image LRU Cache (`clientImageCache.ts`)**: Bounded 120 MB in-memory Blob cache + in-flight request deduplication shared across contact-sheet thumbnails, Lightbox views, Crop & Resize, Filter & Lenses, and progressive/ZIP downloads so images are never fetched twice.
- **Server Image & Scrape LRU Caches (`fetchHelpers.ts`, `galleryScraperService.ts`)**: Bounded in-memory image buffer cache (`128 MB` / 4-min TTL), detail-HTML cache, and 90-second single-gallery scrape cache with concurrent request deduplication.
- **Next.js 16 Config (`next.config.ts`)**: Enables `httpAgentOptions.keepAlive`, HTTP gzip/Brotli compression, immutable `/_next/static/*` cache headers, `experimental.optimizePackageImports` (`lucide-react`, `motion`), `experimental.staleTimes` (`dynamic: 60s`, `static: 300s`), and `serverExternalPackages` for native binaries (`sharp`, `7zip-bin`, `playwright-core`, `got-scraping`).

---

## Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Framework & UI** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 (`Bricolage Grotesque`, `Plus Jakarta Sans`, `JetBrains Mono`), `motion`, `lucide-react` |
| **Imaging, Motion & Archives** | `sharp` (native C++), HTML5 Canvas, custom GIF89a encoder (Median Cut + Bayer), `7zip-bin` (LZMA2 `.7z`), `jszip` |
| **Cloud & Local Vision AI** | `@google/genai` (`gemini-3.1-flash-lite` / `gemini-4-hydrogen`), `llama.cpp` + **Gemma 4 E2B**, Python (`insightface`, `mediapipe`, `scikit-learn`, `opencv-python-headless`) |
| **Scraping & Networking** | `cheerio`, `got-scraping`, `tough-cookie`, `p-limit`, `playwright-core` |
| **Testing** | Node.js built-in test runner (`node:test`) via `tsx --test` (**151 unit tests**) |

---

## Architecture & Directory Map

```text
├── next.config.ts                         # Next.js 16 tuning, keepAlive, optimizePackageImports & headers
├── postcss.config.mjs                     # Tailwind CSS v4 PostCSS plugin setup
├── .env.example                           # GEMINI_API_KEY, APP_URL, CHROMIUM_PATH & optional GEMMA_* overrides
├── src/
│   ├── App.tsx                            # Root workspace controller, studio state, scrape & download orchestrators
│   ├── app/                               # Next.js 16 App Router pages & API route handlers
│   │   ├── layout.tsx                     # Root HTML shell, theme bootstrap & Google Fonts (Bricolage/Jakarta/JetBrains)
│   │   ├── globals.css                    # Tailwind v4 tokens, studio grid/surface themes & animations
│   │   ├── page.tsx                       # Server page entry rendering ClientAppMount
│   │   ├── view-image/route.ts            # Standalone full-resolution image inspector route
│   │   ├── download-all/route.ts          # Bulk link download route
│   │   └── api/
│   │       ├── health/route.ts            # Service health, active capabilities & preset discovery
│   │       ├── openapi.json/route.ts      # OpenAPI 3.1.0 schema document for external consumers
│   │       ├── process/route.ts           # Stateless image crop, resize, color grade & encode API
│   │       ├── scrape/route.ts            # Single gallery, Instagram, preview batch & HTML/JSON scraper
│   │       ├── scrape/discover-galleries/ # Parent hub child-gallery discovery & pagination crawler
│   │       ├── scrape/nested/route.ts     # Parallel multi-gallery crawl & merged gallery response
│   │       ├── instagram/profile/         # Dedicated paginated Instagram profile endpoint
│   │       ├── deep-resolve/route.ts      # Single linked detail-page master URL resolver
│   │       ├── links/route.ts             # JSON / CSV / TXT link exporter
│   │       ├── proxy/route.ts             # CORS-bypass image proxy with smart Referer & cache headers
│   │       ├── download-file/route.ts     # Single master attachment streamer with fallbacks
│   │       ├── download-zip/route.ts      # NDJSON-streamed .7Z / .ZIP builder + GET HTTP Range (206) endpoint
│   │       ├── export-full-project/       # Packages the Next.js 16 source tree into a ZIP download
│   │       ├── crop-resize/               # Local disk scan, preview, sharp batch processor & ZIP export
│   │       └── ai/
│   │           ├── human-face-filter/     # Gemini multimodal "Only Person · Exclude Landscape" filter endpoint
│   │           ├── classify-humans/       # analyze-batch, cluster, disk-classify, download-zip & export-disk
│   │           └── gemma/                 # status, chat, caption, disk-caption & export-zip
│   ├── components/                        # 21 React studio & UI modules
│   │   ├── ClientAppMount.tsx             # Hydration-safe client root wrapper
│   │   ├── StudioSidebar.tsx              # Left desktop Studio Rail & mobile drawer navigation
│   │   ├── Header.tsx                     # Active studio header, theme switcher, ⌘K trigger & source ZIP export
│   │   ├── CommandPalette.tsx             # ⌘K / Ctrl+K studio & quick-action launcher
│   │   ├── BentoShowcase.tsx              # Capture Studio empty-state pipeline bento showcase
│   │   ├── ScraperControls.tsx            # URL bar, Nested Hub toggle, Instagram, Relay & Paste drawers
│   │   ├── NestedGalleryQueue.tsx         # Discovered child gallery selector & crawl queue UI
│   │   ├── FilterStackBar.tsx             # Composable boolean AND filter bar + AI face filter trigger
│   │   ├── GalleryView.tsx                # Contact-sheet grid, blank/1x1 probing, Gemma & Face-Filter actions
│   │   ├── ArchiveDownloadBar.tsx         # Pause/Resume/Cancel HUD for .7Z & .ZIP builds
│   │   ├── ProgressiveDownloadBar.tsx     # Concurrent direct-folder / file download queue HUD
│   │   ├── CropResizeStudio.tsx           # Batch Crop & Resize studio workspace
│   │   ├── CropResizeInspector.tsx        # Crop, Resize, Naming & Export inspector panel
│   │   ├── InteractiveCropCanvas.tsx      # 8-handle interactive crop overlay with aspect lock
│   │   ├── FilterStudio.tsx               # Non-destructive 14-slider Color Grading & AR Lenses studio
│   │   ├── GifMakerStudio.tsx             # Storyboard, timing, dithering & caption GIF89a studio
│   │   ├── HumanClassifierStudio.tsx      # Offline/AI person identity clustering & folder sort studio
│   │   ├── GemmaStudio.tsx                # Local Gemma 4 E2B multimodal chat & batch auto-captioner
│   │   ├── FullImageLinksModal.tsx        # Multi-tab link table, CDN list & CSV/JSON export modal
│   │   ├── LightboxModal.tsx              # Zoomable high-resolution side-by-side preview lightbox
│   │   └── DeploymentDocs.tsx             # In-app API reference, environment setup & project export view
│   ├── server/                            # Server services & domain helpers
│   │   ├── archiveBuilder.ts              # 7zip-bin (LZMA2) / JSZip builder & /tmp Range token store
│   │   ├── directoryImageService.ts       # Path-safe disk scanning & native sharp batch processor
│   │   ├── fetchHelpers.ts                # Relay routing, Referer headers, buffer LRU cache & resolvers
│   │   ├── galleryScraperService.ts       # Single-gallery extraction orchestrator & 90s LRU cache
│   │   ├── gemmaChatService.ts            # Gemma 4 OpenAI-compatible multimodal chat & caption client
│   │   ├── gemmaServerManager.ts          # Local llama-server health/warmup & process supervisor
│   │   ├── humanClassifierService.ts      # Person identity clustering service (Python worker + Gemini)
│   │   ├── humanFaceFilterService.ts      # Gemini 3.1 Flash-Lite human-face detector + 30-min LRU cache
│   │   ├── imageProcessService.ts         # Stateless /api/process pipeline (SSRF guard, sharp & RGBA filters)
│   │   ├── instagramService.ts            # 3-tier paginated Instagram profile & Playwright service
│   │   ├── openApiSpec.ts                 # OpenAPI 3.1.0 schema builder for GET /api/openapi.json
│   │   ├── pythonClassifierWorker.ts      # Persistent Python worker bridge for InsightFace + MediaPipe
│   │   ├── scrapeRouteHelpers.ts          # Pagination extractors, fallback datasets & ZIP tree helpers
│   │   └── viewImageTemplate.ts           # Standalone /view-image HTML renderer
│   └── utils/                             # Pure client/shared logic & deterministic algorithms (with *.test.ts)
│       ├── archiveDownloader.ts           # NDJSON .7Z/.ZIP download client with HTTP Range pause/resume
│       ├── browserImageProcessor.ts       # HTML5 Canvas crop/resize & synthetic test-plate generator
│       ├── canvasFilterRenderer.ts        # Full Canvas color-grade shader & 9 AR/optical lens renderers
│       ├── clientImageCache.ts            # 120 MB Blob LRU cache, in-flight dedupe & preview-URI helper
│       ├── downloader.ts                  # Archive filename, MIME & Content-Disposition helpers
│       ├── gemmaCaptionLogic.ts           # Prompt builders & structured/CSV/Markdown caption formatters
│       ├── gifEncoder.ts                  # Zero-dependency binary GIF89a encoder & Median Cut quantizer
│       ├── gifMakerLogic.ts               # Boomerang sequence, crossfade interpolation & frame fit math
│       ├── harvesterScripts.ts            # Browser DevTools console harvester snippets
│       ├── htmlExtractor.ts               # Cheerio DOM, JSON-LD, srcset & manifest parser
│       ├── humanClassifierLogic.ts        # Similarity clustering, folder naming & export helpers
│       ├── imageFilterLogic.ts            # Color grading math, presets, RGBA filters & YCbCr face anchor
│       ├── imageTransformLogic.ts         # Normalized crop clamping, aspect lock & resize calculations
│       ├── instagramExtractor.ts          # Instagram GraphQL / REST v1 / SSR hydration JSON parser
│       ├── nestedGalleryLogic.ts          # Child gallery discovery, scoring, hub pagination & merging
│       ├── progressiveDownloader.ts       # Bounded worker pool & File System Access API saver
│       ├── safeFetchJson.ts               # Content-Type safe JSON fetch wrapper
│       ├── samplePages.ts                 # Built-in showcase & nested hub demo datasets
│       └── scraperLogic.ts                # CDN URL un-shrinker, resolution classifier & AND filter engine
```

---

## Getting Started

### Prerequisites
- **Node.js 20+** (Node 22+ recommended)
- **npm 10+**
- *(Optional)* **Python 3.10+** with `insightface`, `mediapipe`, `scikit-learn`, and `opencv-python-headless` for offline Face & ID clustering
- *(Optional)* **`llama.cpp` (`llama-server`)** + Gemma 4 E2B weights for local offline Gemma 4 Vision Chat & Auto-Captioning

### 1. Environment Variables
Copy `.env.example` to `.env` and configure any optional services:

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | For Cloud AI Face Filter / Classifier | Server-side Google Gemini API key (`process.env.GEMINI_API_KEY`). Enables **Only Person · Exclude Landscape (AI)** and cloud identity grouping. |
| `APP_URL` | Optional | Public origin URL of the running app (defaults to `http://localhost:3000`). |
| `CHROMIUM_PATH` | Optional | Path to local Chromium/Chrome binary for headless Playwright Instagram fallbacks. |
| `GEMMA_SERVER_URL`, `GEMMA_LLAMA_SERVER_BIN`, `GEMMA_MODEL_PATH`, `GEMMA_MMPROJ_PATH`, `GEMMA_LLAMA_PORT`, `GEMMA_THREADS`, `GEMMA_CTX_SIZE` | Optional | Custom paths and runtime parameters for the local `llama-server` Gemma 4 E2B process. |

### 2. Install & Launch Development Server
```bash
npm install
npm run dev
```
Open **`http://localhost:3000`** in your browser.

### 3. Run Unit Tests, Type-Check & Production Build
```bash
npm test          # Runs 151 node:test unit tests across src/utils & src/server
npm run lint      # Strict TypeScript verification (tsc --noEmit)
npm run build     # Compiles Next.js 16 App Router production bundles (.next/)
npm start         # Serves the production build on port 3000
```

---

## Consuming the REST API

Every studio capability is exposed over HTTP so automation scripts, CI pipelines, and external apps can consume **Ultimate Image Processor** headlessly. Open the in-app **Deployment & API** tab for an interactive live tester or inspect **`GET /api/openapi.json`** for the full OpenAPI 3.1.0 schema.

### Stateless Image Processing (`POST /api/process`)

Send either a JSON payload (`imageUrl` or `imageBase64`) or `multipart/form-data` (`file`) to crop, resize, color-grade (8 presets + 14 sliders), convert formats (`jpeg`, `png`, `webp`, `avif`), and optionally run Gemini human-face detection (`detectFaces: true`):

```bash
# 1. Check service capabilities & presets
curl http://localhost:3000/api/health

# 2. Grade, resize, and convert a remote image into WebP (binary output)
curl -X POST http://localhost:3000/api/process \
  -H "Content-Type: application/json" \
  -d '{
    "imageUrl": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1600",
    "preset": "golden_hour",
    "adjustments": { "sharpen": 25, "vignette": 15 },
    "crop": { "xRatio": 0.1, "yRatio": 0.05, "widthRatio": 0.8, "heightRatio": 0.85 },
    "resize": { "mode": "maxEdge", "maxEdge": 1280 },
    "format": "webp",
    "quality": 90
  }' --output processed_portrait.webp

# 3. Upload a local file via multipart/form-data and get JSON + AI face metadata
curl -X POST http://localhost:3000/api/process \
  -F "file=@portrait.jpg" \
  -F 'options={"preset":"bw_noir","format":"png","detectFaces":true,"responseType":"json"}'
```

### REST API Reference

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service status, active AI/native capabilities, limits, and supported presets/formats. |
| `GET` | `/api/openapi.json` | Machine-readable OpenAPI 3.1.0 specification for SDKs, Postman, and Swagger. |
| `GET` | `/api/process` | Returns supported presets, adjustment slider keys, resize modes, and parameter limits. |
| `POST` | `/api/process` | Stateless crop, resize, preset/adjustment color grading, format conversion & optional face check. |
| `POST` | `/api/scrape` | Scrapes a webpage URL, Instagram profile, preview batch, raw HTML, or Harvester JSON manifest. |
| `POST` | `/api/scrape/discover-galleries` | Discovers and scores child gallery albums from a parent hub/category page (with pagination). |
| `POST` | `/api/scrape/nested` | Crawls selected or discovered child galleries concurrently and returns a unified merged collection. |
| `POST` | `/api/instagram/profile` | Dedicated paginated Instagram profile photo, HD avatar, and multi-slide carousel extractor. |
| `POST` | `/api/deep-resolve` | Resolves the master image URL from a single linked detail webpage. |
| `GET/POST` | `/api/links` | Exports harvested direct master links and webpage links as `json`, `csv`, or `txt`. |
| `GET` | `/api/proxy` | CORS-bypass image proxy with smart site `Referer` headers and browser caching (`?url=...&referer=...`). |
| `GET` | `/api/download-file` | Streams a single master image attachment with fallback resolution. |
| `POST` | `/api/download-zip` | Packages selected images into `.7z` (LZMA2) or `.zip` and streams NDJSON stage progress (`streamProgress: true`). |
| `GET` | `/api/download-zip` | Downloads staged `.7z` / `.zip` archives by token with HTTP `Range` (`206 Partial Content`) resume support. |
| `DELETE` | `/api/download-zip` | Cleans up a staged archive token from temporary server storage. |
| `POST` | `/api/crop-resize/scan-dir` | Lists supported images & dimensions inside a local server directory via `sharp`. |
| `GET` | `/api/crop-resize/local-preview` | Serves sanitized local thumbnails for the Crop & Resize workspace. |
| `POST` | `/api/crop-resize/process-dir` | Batch crops/resizes a local server directory with `sharp` and writes outputs to disk. |
| `POST` | `/api/crop-resize/download-zip` | Streams processed images from a local server directory as a `.zip` archive. |
| `POST` | `/api/ai/human-face-filter` | Evaluates up to 12 scraped images via Gemini multimodal vision for visible human faces (`hasHumanFace`). |
| `POST` | `/api/ai/classify-humans/analyze-batch` | Extracts face/subject descriptors from an uploaded image batch. |
| `POST` | `/api/ai/classify-humans/cluster` | Clusters analyzed person descriptors into grouped identity buckets. |
| `POST` | `/api/ai/classify-humans/disk-classify` | Streams offline InsightFace + MediaPipe clustering progress over a local server directory. |
| `POST` | `/api/ai/classify-humans/download-zip` | Packages clustered person folders into a downloadable `.zip` archive. |
| `POST` | `/api/ai/classify-humans/export-disk` | Writes grouped person subfolders directly to a chosen server disk path. |
| `GET/POST` | `/api/ai/gemma/status` | Inspects health or warms up the local Gemma 4 E2B multimodal server. |
| `POST` | `/api/ai/gemma/chat` | Streams multi-image conversational replies from local Gemma 4 E2B. |
| `POST` | `/api/ai/gemma/caption` | Batch-captions browser or remote images with Gemma 4 (`concise`, `detailed`, `structured`, `alt_text`). |
| `POST` | `/api/ai/gemma/disk-caption` | Scans a server directory and streams batch captions + optional `.txt` sidecars. |
| `POST` | `/api/ai/gemma/export-zip` | Exports generated captions as JSON, CSV, Markdown, and `.txt` sidecars in a `.zip`. |
| `GET` | `/view-image` | Renders the standalone full-resolution image inspector page. |
| `GET` | `/api/export-full-project` | Packages the entire Next.js 16 source tree as a downloadable `.zip`. |

---

## Privacy & Responsible Use

- Never commit `.env` files, API secrets, personal Instagram `sessionid` cookies, or downloaded media archives.
- `sessionid` cookies entered in the UI stay strictly in-memory for active requests and are never logged or persisted to disk.
- Respect target site Terms of Service, copyright restrictions, and rate limits when extracting or processing media.

---

## License

Apache-2.0 License.
