# FullRes Image Scraper & Studio

A full-stack web application and Python Flask toolkit that extracts **original, uncropped master images** from webpages, image galleries, linked photo detail pages, and Instagram profiles—bypassing compressed thumbnails, responsive `srcset` caps, and CDN resize restrictions.

---

## Features

- **Intelligent Full-Resolution Unshrinking**
  - **Instagram Profiles** (`instagram.com/<username>/` or `@username`): Extracts HD profile avatars, single posts, and all multi-photo carousel slides via paginated API & SSR extraction, plus optional `sessionid` cookie support and a 1-click browser DevTools **Instagram Profile Harvester** script.
  - **Linked Detail Page Crawler**: Automatically follows `/photo/<id>/`, `/item/`, and gallery detail subpages to resolve live signed master CDN URLs (e.g., `/images/full/...`) and JSON-LD `contentUrl` entries.
  - **CDN & CMS Normalization**: Unshrinks WordPress (`-300x200.jpg`), Wikimedia Commons (`/thumb/`), Unsplash (`w=`/`crop`), Cloudinary, Shopify (`_master`), Flickr, Pinterest (`/originals/`), Blogger/Google (`/s0/`), YouTube (`maxresdefault.jpg`), and generic `<picture>` / `srcset` / lazy-load (`data-original`, `data-full`) attributes.
  - **Geo-Block & Paste Fallbacks**: Includes an **Open-Tab Console Harvester** script, optional CORS/Relay worker URL input, and a **Paste Previews / HTML / JSON** drawer that accepts preview URL batches, raw page HTML, Instagram `web_profile_info` / `feed/user` JSON, or Harvester JSON manifests.

- **Stackable High-Level Filter Workbench**
  - Stack boolean AND rules across the gallery and exporter modal: **Full Masters Only**, **Previewable / No Blanks** (filters broken/404/1x1 tracking pixels), **Un-shrunk**, **HD / 4K (≥1920px)**, **Has Subpage**, **Hide Icons / GIFs**, **Format**, **Resolution Tier**, **Orientation**, and live text search.
  - Includes a 1-click **Clean Masters Preset** and **Select Full Masters** bulk action.

- **Multi-Format Link Harvester & Batch ZIP Downloads**
  - **Full Image Links Harvester** modal with **Direct Master Links (CDN)**, **Master Webpage Links**, **Interactive Table**, **JSON**, and **CSV** tabs.
  - Fast server-side ZIP bundling (`POST /api/download-zip` with `STORE` compression) plus automatic browser-side `JSZip` fallback assembly and direct single-file downloads.
  - Built-in CORS image proxy (`/api/proxy`), standalone high-res viewer (`/view-image`), persistent Dark/Light theme, and a **Flask Codebase** exporter (`flask_app/`).

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, JSZip
- **Backend (Primary Full-Stack)**: Node.js, Express 4, Cheerio, Vite 8
- **Optional Python Sibling**: Flask, BeautifulSoup4, Requests, Gunicorn (`flask_app/`)
- **Testing & Quality**: `node:test` via `tsx --test`, TypeScript (`tsc --noEmit`)

---

## Project Structure

```text
├── server.ts                          # Express + Vite dev/prod unified server entry point
├── package.json
├── index.html
├── .env.example                       # Sample environment variables (copy to .env if needed)
├── src/
│   ├── App.tsx                        # Main studio shell, state, toast & download orchestrators
│   ├── components/
│   │   ├── Header.tsx                 # Top navigation bar, theme toggle & Flask ZIP export
│   │   ├── ScraperControls.tsx        # URL form, Instagram Profile panel, Bypass & Paste drawers
│   │   ├── FilterStackBar.tsx         # Shared stackable filter chips component
│   │   ├── GalleryView.tsx            # Filterable grid, preview probing & batch selection toolbar
│   │   ├── FullImageLinksModal.tsx    # CDN / Webpage / Table / JSON / CSV exporter modal
│   │   ├── LightboxModal.tsx          # Zoomable high-res inspector with preview comparison
│   │   ├── FlaskCodeViewer.tsx        # In-app Python Flask source viewer
│   │   └── DeploymentDocs.tsx         # Setup & API reference tab
│   ├── server/
│   │   ├── fetchHelpers.ts            # Relay builder, referer resolver, filename sanitizer & fetch retry
│   │   ├── fetchHelpers.test.ts       # Unit tests for server helpers
│   │   ├── instagramService.ts        # Paginated Instagram profile scraper service
│   │   └── viewImageTemplate.ts       # Standalone /view-image HTML renderer
│   └── utils/
│       ├── scraperLogic.ts            # CDN unshrinker, resolution classifier & filter engine
│       ├── scraperLogic.test.ts       # Unit tests for unshrinking & filtering logic
│       ├── htmlExtractor.ts           # Cheerio HTML/JSON-LD/manifest parser
│       ├── htmlExtractor.test.ts      # Unit tests for HTML & manifest parsing
│       ├── instagramExtractor.ts      # Instagram GraphQL / REST v1 / SSR JSON parser
│       ├── instagramExtractor.test.ts # Unit tests for Instagram profile & carousel parsing
│       ├── harvesterScripts.ts        # Browser DevTools console harvester snippets
│       ├── downloader.ts              # Native disk save & viewer URL helpers
│       └── samplePages.ts             # Offline showcase presets
└── flask_app/                         # Self-contained Python Flask alternative + Dockerfile
    ├── app.py
    ├── scraper.py
    ├── config.py
    ├── wsgi.py
    ├── requirements.txt
    ├── Dockerfile
    ├── templates/
    └── static/
```

---

## Quickstart (Node.js Full-Stack)

### Prerequisites
- **Node.js 20+** (Node 22+ recommended)
- **npm 10+**

### 1. Install Dependencies
```bash
git clone https://github.com/<your-username>/fullres-image-scraper.git
cd fullres-image-scraper
npm install
```

### 2. Run Development Server
```bash
npm run dev
```
Open **`http://localhost:3000`** in your browser.

> **Windows Note:** Do not place the repository inside a folder whose path contains an ampersand (`&`, e.g. `foo & bar`), because `cmd.exe` splits unquoted `.bin\tsx.cmd` shim paths at `&`. If your Node.js version is 22.6+, you can also start the server directly with:
> ```bash
> node server.ts
> ```

### 3. Run Tests, Type Check & Production Build
```bash
npm test          # Runs all unit tests (fetchHelpers, htmlExtractor, instagramExtractor, scraperLogic)
npm run lint      # Runs TypeScript type checking (tsc --noEmit)
npm run build     # Builds production frontend bundle into dist/
```

### 4. Production Start
```bash
NODE_ENV=production npm start
```
*(On Windows PowerShell: `$env:NODE_ENV="production"; npm start`)*

---

## Python Flask Setup (Optional Standalone Backend)

A self-contained Python implementation lives under `flask_app/`:

```bash
cd flask_app
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py                   # Serves on http://localhost:5000
```

Or run via Docker:
```bash
cd flask_app
docker build -t fullres-image-scraper:latest .
docker run -d -p 5000:5000 --name image-scraper fullres-image-scraper:latest
```

---

## REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/scrape` | Scrapes a webpage URL, Instagram profile, preview batch, HTML, or Harvester JSON manifest (`{ url, customHtml?, followLinkedPages?, relayUrl?, instagramSession?, maxPosts? }`). |
| `POST` | `/api/instagram/profile` | Dedicated Instagram profile full-resolution photo & carousel fetcher (`{ profileUrl, sessionCookie?, maxPosts?, relayUrl? }`). |
| `POST` | `/api/deep-resolve` | Resolves the master image URL from a single linked detail webpage (`{ linkedPageUrl, relayUrl? }`). |
| `ALL` | `/api/links` | Exports harvested direct master links and webpage links as `json`, `csv`, or `txt`. |
| `GET` | `/api/proxy` | CORS-bypass image proxy with smart site `Referer` headers (`?url=...&referer=...`). |
| `GET` | `/api/download-file` | Streams an individual master image with `Content-Disposition: attachment`. |
| `POST` | `/api/download-zip` | Packages selected master images into an in-memory `.zip` archive (`STORE` compression). |
| `GET` | `/view-image` | Renders a dedicated standalone master image inspection page. |
| `GET` | `/api/export-flask-project` | Downloads `flask_app/` as a standalone `.zip` project. |

---

## Privacy & Responsible Use

- Do not commit `.env` files, personal Instagram `sessionid` cookies, or downloaded media archives to version control.
- `sessionid` cookies entered in the UI are used solely in-memory for the active request and are never persisted to disk or logged.
- Respect target website Terms of Service, copyright laws, and rate limits when scraping media.

---

## License

Apache-2.0 License.
