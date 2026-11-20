# FullRes Studio — High-Resolution Image Scraper & Batch Darkroom

> **Stop downloading 480px thumbnails when the 4K master is hiding behind a URL parameter.**

**FullRes Studio** is a full-stack **Next.js 16 (App Router)**, **Tailwind CSS v4**, and **TypeScript** workstation built for developers, archivists, and creative engineers. It extracts original uncropped master images from arbitrary webpages, linked photo detail galleries, and Instagram profiles—then lets you inspect, filter, batch crop, resize, and export them locally using HTML5 Canvas or native **`sharp`**.

---

## Why FullRes Exists

Modern websites rarely link directly to the file on the camera roll. Instead, galleries serve cropped `srcset` previews, WordPress `-300x200` derivatives, CDN width-capped URLs (`?w=640`, `/thumb/`, `s640x640`), or paginated JSON feeds behind TLS fingerprinting.

FullRes reverses those layers in a single pipeline:

```text
  URL / HTML / Instagram / Local Folder
                 │
                 ▼
  ┌──────────────────────────────────────────────────────────┐
  │ 1. Extraction & Unshrinking                              │
  │    • Cheerio DOM + JSON-LD + srcset/data-* heuristics    │
  │    • Linked detail-page crawler & CDN pattern rewriter   │
  │    • 3-tier Instagram scraper (TLS/SSR/Playwright)       │
  └──────────────┬───────────────────────────┬───────────────┘
                 │                           │
                 ▼                           ▼
  ┌──────────────────────────┐ ┌─────────────────────────────┐
  │ 2. Contact-Sheet Studio  │ │ 3. Crop & Resize Darkroom   │
  │ • Stackable AND filters  │ │ • 8-handle live crop canvas │
  │ • Live blank/1x1 probing │ │ • Aspect & print presets    │
  │ • Progressive disk save  │ │ • Browser Canvas / sharp    │
  └──────────────┬───────────┘ └─────────────┬───────────────┘
                 │                           │
                 ▼                           ▼
        Direct Disk / ZIP          Processed Folder / ZIP
```

---

## Key Capabilities

### 1. Intelligent Full-Resolution Scraping
- **CDN & CMS Un-shrinking**: Normalizes URL patterns across **WordPress** (`-300x200.jpg`), **Wikimedia Commons** (`/thumb/`), **Unsplash** (`w=` / `crop`), **Cloudinary**, **Shopify** (`_master`), **Flickr**, **Pinterest** (`/originals/`), **Blogger / Google** (`/s0/`), **YouTube** (`maxresdefault.jpg`), and generic `<picture>` / `srcset` / lazy-load (`data-original`, `data-full`) attributes.
- **Linked Detail Page Crawler**: Follows `/photo/<id>/`, `/item/`, and gallery detail subpages to extract signed master CDN URLs and Schema.org `contentUrl` fields.
- **3-Tier Instagram Profile Pipeline** (`instagram.com/<user>/` or `@user`):
  1. **TLS-Fingerprinted HTTP (`got-scraping`)**: Paginates GraphQL & REST feeds while extracting HD profile avatars, single posts, and every slide inside multi-photo carousels.
  2. **SSR Hydration Parser**: Extracts embedded `xdt_api__v1__feed__user_timeline_graphql_connection` payloads from initial HTML.
  3. **Headless Browser Fallback (`playwright-core`)**: Intercepts live profile feeds when strict login walls or anti-bot challenges block HTTP requests, with optional in-memory `sessionid` cookie support and a **DevTools Open-Tab Harvester**.
- **Geo-Block & Paste Fallbacks**: Supports custom CORS/Relay worker URLs plus a **Paste Previews / HTML / JSON** drawer accepting preview URL batches, raw HTML, Instagram JSON dumps, or Harvester manifests.

### 2. Stackable Contact-Sheet Workbench
- **Composable AND Filters**: Combine **Full Masters Only**, **Previewable / No Blanks** (probes for 404s and `1×1` tracking pixels), **Un-shrunk**, **HD / 4K (`≥1920px`)**, **Has Subpage**, **Hide Icons / GIFs**, **Format**, **Resolution Tier**, **Orientation**, and instant text search.
- **Multi-Format Link Harvester**: Inspect and export **Direct Master Links (CDN)**, **Master Webpage Links**, **Interactive Table**, **JSON**, and **CSV**.
- **Resilient Downloads**: Streams server-side `STORE`-compressed ZIP bundles (`/api/download-zip`), falls back seamlessly to browser `JSZip`, or writes straight to a chosen local directory via the File System Access API (`progressiveDownloader`).

### 3. Batch Directory Crop & Resize Darkroom
- **Two Processing Backends**:
  - **Browser Folder / Scraped Batch**: Drop a local folder (`webkitdirectory`), select individual files, load built-in test plates, or send filtered results directly from the Scraper Gallery (`Crop / Resize (N)`). Processed losslessly in-browser via HTML5 Canvas.
  - **Server Disk Directory Mode**: Scan an absolute filesystem path (`/api/crop-resize/scan-dir`) and batch-process hundreds of files via native C++ **`sharp`** (`/api/crop-resize/process-dir`), writing directly to a target subfolder or streaming a ZIP (`/api/crop-resize/download-zip`).
- **Interactive 8-Handle Crop Canvas**: Drag corners, edges, or reposition the selection box with rule-of-thirds guides and aspect-ratio locks (`Free`, `Original`, `1:1`, `4:5`, `16:9`, `3:2`, `4:3`, `9:16`).
- **Flexible Resize Modes**: Supports `Original`, `Width × Height`, `Fit Max Edge`, and `Percentage Scale` with `Cover`, `Contain`, `Fill`, and `Inside` strategies across `JPEG`, `PNG`, `WebP`, and `AVIF`.

### 4. Offline Human Identity Classifier
- **100% Local Python AI Pipeline**: Combines **InsightFace (`buffalo_l` / ArcFace 512-D facial embeddings)**, **MediaPipe Pose Landmarker** (shoulder/hip/stature body proportions), and **scikit-learn agglomerative clustering** over a persistent Python worker (`/python/human_classifier.py`).
- **Dual Intake & Grouping**: Classify browser-dropped image batches, scraped gallery hits, or an entire local server directory, grouping each unique human into a dedicated editable subfolder and exporting as a ZIP or organized disk folders.

### 5. Local Open-Source Gemma 4 Chat & Auto-Captioner
- **Local Multimodal LLM (`Gemma 4 E2B` + Vision Projector)**: Runs locally via `llama.cpp` (`llama-server` on loopback) with zero external API keys required.
- **Multi-Image Conversational Chat**: Attach up to 6 images per turn, compare outfits/subjects side-by-side, stream replies token-by-token, and reuse one-click multimodal prompt templates.
- **Batch Auto-Captioner (Files or Directory)**: Select multiple browser files, hand off scraped images, or point to a server disk directory (`./public/samples/humans`) to generate `Detailed Description`, `Dataset Caption (1-Sentence)`, `Structured JSON + Tags`, or `Accessibility Alt-Text`, optionally writing `.txt` sidecar caption files next to images and exporting JSON, CSV, Markdown, or a combined `.zip` bundle.

---

## Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Framework & UI** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Lucide Icons |
| **Image & Archive Engine** | `sharp` (server native), HTML5 Canvas (client), `jszip` (streaming & browser ZIPs) |
| **Local Offline AI** | `llama.cpp` + **Gemma 4 E2B** (multimodal vision chat & captioning), Python (`insightface`, `mediapipe`, `scikit-learn`, `opencv-python-headless`) |
| **Scraping & Networking** | `cheerio`, `got-scraping`, `tough-cookie`, `p-limit`, `playwright-core` |
| **Testing** | Node.js built-in test runner (`node:test`) via `tsx --test` (**83 unit tests**) |

---

## Architecture & Directory Map

```text
├── next.config.ts                       # Next.js 16 configuration & remote image optimization
├── postcss.config.mjs                   # Tailwind CSS v4 PostCSS setup
├── .env.example                         # Optional APP_URL and CHROMIUM_PATH config
├── src/
│   ├── App.tsx                          # Root studio shell, theme state, scrape & download orchestrators
│   ├── app/                             # Next.js 16 App Router pages & REST Route Handlers
│   │   ├── layout.tsx                   # Root HTML shell, Space Grotesk / Inter / JetBrains Mono fonts
│   │   ├── globals.css                  # Tailwind v4 entry & theme tokens
│   │   ├── page.tsx                     # Home Studio route
│   │   ├── view-image/route.ts          # Standalone full-res image inspector page
│   │   ├── download-all/route.ts        # Legacy bulk download route
│   │   └── api/
│   │       ├── scrape/route.ts          # Main webpage, detail-crawler & Instagram scrape endpoint
│   │       ├── instagram/profile/       # Dedicated paginated Instagram profile endpoint
│   │       ├── deep-resolve/route.ts    # Single linked detail-page master resolver
│   │       ├── links/route.ts           # JSON / CSV / TXT link exporter
│   │       ├── proxy/route.ts           # CORS-bypass image proxy with smart Referer headers
│   │       ├── download-file/route.ts   # Single master attachment streamer
│   │       ├── download-zip/route.ts    # In-memory STORE ZIP packager
│   │       ├── export-full-project/     # Downloads the full Next.js 16 codebase as a ZIP
│   │       └── crop-resize/             # Disk directory scan, preview, sharp batch & ZIP endpoints
│   ├── components/
│   │   ├── Header.tsx                   # Studio navigation bar, Dark/Light theme & project ZIP export
│   │   ├── ScraperControls.tsx          # Target URL bar, Instagram Profile panel, Relay & Paste drawers
│   │   ├── FilterStackBar.tsx           # Composable boolean AND filter rule bar
│   │   ├── GalleryView.tsx              # Contact-sheet grid, broken/1x1 probing & batch selection
│   │   ├── CropResizeStudio.tsx         # Batch darkroom workspace, folder intake & queue manager
│   │   ├── CropResizeInspector.tsx      # 4-section Crop, Resize, Naming & Export inspector rail
│   │   ├── InteractiveCropCanvas.tsx    # Pointer-driven 8-handle crop overlay with thirds grid
│   │   ├── FullImageLinksModal.tsx      # Multi-tab link inspector & CSV/JSON exporter modal
│   │   ├── LightboxModal.tsx            # Zoomable high-res inspector with before/after preview
│   │   ├── ProgressiveDownloadBar.tsx   # Parallel stream & disk-write progress HUD
│   │   └── DeploymentDocs.tsx           # In-app API reference & 1-click codebase ZIP tab
│   ├── server/
│   │   ├── fetchHelpers.ts              # Relay builder, Referer rules & fallback image buffer resolver
│   │   ├── scrapeRouteHelpers.ts        # Shared detail-link predicates, fallback presets & ZIP tree walker
│   │   ├── instagramService.ts          # 3-tier paginated Instagram profile & Playwright service
│   │   ├── directoryImageService.ts     # Path-safe disk scanning & sharp crop/resize pipeline
│   │   └── viewImageTemplate.ts         # Standalone /view-image HTML template generator
│   └── utils/
│       ├── scraperLogic.ts              # CDN unshrinker, resolution classifier & filter engine
│       ├── htmlExtractor.ts             # Cheerio DOM, JSON-LD, gallery map & manifest extractor
│       ├── instagramExtractor.ts        # Instagram GraphQL / REST v1 / SSR JSON parser
│       ├── imageTransformLogic.ts       # Normalized crop clamping, aspect lock & resize math
│       ├── browserImageProcessor.ts     # Client HTML5 Canvas crop/resize & test-plate generator
│       ├── progressiveDownloader.ts     # Parallel fetch queue & File System Access direct saver
│       ├── harvesterScripts.ts          # Browser DevTools console harvester snippets
│       ├── safeFetchJson.ts             # Content-type safe JSON response guard
│       ├── downloader.ts                # Blob download & viewer URL helpers
│       └── samplePages.ts               # Built-in showcase & parser regression presets
```

---

## Getting Started

### Prerequisites
- **Node.js 20+** (Node 22+ recommended)
- **npm 10+**

### 1. Install & Launch Development Server
```bash
npm install
npm run dev
```
Open **`http://localhost:3000`** in your browser.

*(Optional)* Copy `.env.example` to `.env` if you want to customize `APP_URL` or point `CHROMIUM_PATH` to a specific local Chromium binary for headless Instagram fallbacks.

### 2. Run Unit Tests, Type-Check & Production Build
```bash
npm test          # Runs 68 node:test unit tests across utils & server modules
npm run lint      # Strict TypeScript verification (tsc --noEmit)
npm run build     # Compiles Next.js 16 App Router production bundles (.next/)
npm start         # Serves the production build on port 3000
```

---

## REST API Reference

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `POST` | `/api/scrape` | Scrapes a webpage URL, Instagram profile, preview batch, raw HTML, or JSON manifest. |
| `POST` | `/api/instagram/profile` | Paginated Instagram profile photo, avatar, and multi-slide carousel extractor. |
| `POST` | `/api/deep-resolve` | Resolves the master image URL from a single linked detail webpage. |
| `ALL` | `/api/links` | Exports harvested direct master links and webpage links as `json`, `csv`, or `txt`. |
| `GET` | `/api/proxy` | CORS-bypass image proxy with smart site `Referer` headers (`?url=...&referer=...`). |
| `GET` | `/api/download-file` | Streams a single master image with fallback resolution (`Content-Disposition: attachment`). |
| `POST` | `/api/download-zip` | Packages selected master URLs into a fast in-memory `STORE` `.zip` archive. |
| `POST` | `/api/crop-resize/scan-dir` | Lists supported images & dimensions inside a local server directory (`sharp`). |
| `GET` | `/api/crop-resize/local-preview` | Serves sanitized local thumbnails for the Crop & Resize workspace. |
| `POST` | `/api/crop-resize/process-dir` | Batch crops/resizes a local directory with `sharp` and saves outputs to disk. |
| `POST` | `/api/crop-resize/download-zip` | Streams processed images from a local directory as a `.zip` archive. |
| `POST` | `/api/ai/classify-humans/disk-classify` | Streams offline InsightFace + MediaPipe human clustering progress over a directory. |
| `GET/POST` | `/api/ai/gemma/status` | Inspects or warms up the local Gemma 4 E2B multimodal server. |
| `POST` | `/api/ai/gemma/chat` | Streams multi-image conversational replies from local Gemma 4 E2B. |
| `POST` | `/api/ai/gemma/caption` | Batch-captions selected or remote images with Gemma 4 (`concise`, `detailed`, `structured`, `alt_text`). |
| `POST` | `/api/ai/gemma/disk-caption` | Scans a server directory and streams batch captions + optional `.txt` sidecar files. |
| `POST` | `/api/ai/gemma/export-zip` | Exports generated captions as JSON, CSV, Markdown, and `.txt` sidecars in a `.zip`. |
| `GET` | `/view-image` | Renders the standalone full-resolution image viewer page. |
| `GET` | `/api/export-full-project` | Packages the entire Next.js 16 source tree as a downloadable `.zip`. |

---

## Privacy & Responsible Use

- Never commit `.env` files, personal Instagram `sessionid` cookies, or downloaded media archives.
- `sessionid` cookies entered in the UI stay strictly in-memory for active requests and are never logged or written to disk.
- Respect target site Terms of Service, copyright restrictions, and rate limits when extracting media.

---

## License

Apache-2.0 License.
