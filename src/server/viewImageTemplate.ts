import { escapeHtml } from './fetchHelpers.ts';

export interface ViewImageTemplateParams {
  imageUrl: string;
  title: string;
  sourcePage: string;
  linkedPage: string;
  method: string;
}

/**
 * Renders the standalone full-resolution image viewer HTML page (/view-image).
 */
export function renderViewImageHtml(params: ViewImageTemplateParams): string {
  const { imageUrl, title, sourcePage, linkedPage, method } = params;
  const referer = sourcePage || linkedPage || imageUrl;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Full-Sized Master Viewer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --surface: #0f172a;
      --border: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #3b82f6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0.875rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 700;
      font-size: 1rem;
      text-decoration: none;
      color: var(--text);
    }
    .badge {
      background: rgba(59, 130, 246, 0.2);
      color: #93c5fd;
      border: 1px solid rgba(59, 130, 246, 0.4);
      padding: 0.25rem 0.625rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .btn {
      background: var(--accent);
      color: #ffffff;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-size: 0.8125rem;
      font-weight: 600;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.9; }
    .btn-secondary {
      background: #1e293b;
      color: var(--text);
      border: 1px solid var(--border);
    }
    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      position: relative;
    }
    .image-container {
      max-width: 95vw;
      max-height: 75vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      border-radius: 8px;
      background: #020617;
      padding: 1rem;
      border: 1px solid var(--border);
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .master-img {
      max-width: 100%;
      max-height: 70vh;
      object-fit: contain;
      border-radius: 4px;
      transition: transform 0.2s;
    }
    .meta-bar {
      margin-top: 1.25rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.5rem;
      width: 100%;
      max-width: 900px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      font-size: 0.8125rem;
    }
    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .meta-label {
      color: var(--text-muted);
      font-size: 0.6875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .meta-value {
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
      color: var(--text);
    }
    .meta-link {
      color: #60a5fa;
      text-decoration: underline;
      max-width: 250px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
      <span>Ultimate Image Processor Viewer</span>
    </a>
    <div style="display: flex; align-items: center; gap: 0.75rem;">
      <span class="badge">${escapeHtml(method)}</span>
      <a href="/" class="btn btn-secondary">Back to Capture Studio</a>
      <a href="/api/download-file?url=${encodeURIComponent(imageUrl)}&filename=${encodeURIComponent(title)}&referer=${encodeURIComponent(referer)}" class="btn">Download Master Image</a>
    </div>
  </header>

  <main>
    <div class="image-container">
      <img id="masterImage" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" class="master-img" referrerpolicy="no-referrer">
    </div>

    <div class="meta-bar">
      <div class="meta-item">
        <span class="meta-label">Original Master Dimensions</span>
        <span id="dimText" class="meta-value">Measuring...</span>
      </div>

      ${linkedPage ? `
      <div class="meta-item">
        <span class="meta-label">Linked Detail Webpage</span>
        <a href="${escapeHtml(linkedPage)}" target="_blank" rel="noopener" class="meta-value meta-link" title="${escapeHtml(linkedPage)}">
          ${escapeHtml(linkedPage)}
        </a>
      </div>` : ''}

      ${sourcePage ? `
      <div class="meta-item">
        <span class="meta-label">Source Webpage</span>
        <a href="${escapeHtml(sourcePage)}" target="_blank" rel="noopener" class="meta-value meta-link" title="${escapeHtml(sourcePage)}">
          ${escapeHtml(sourcePage)}
        </a>
      </div>` : ''}

      <div class="meta-item">
        <span class="meta-label">Direct Master Link</span>
        <a href="${escapeHtml(imageUrl)}" target="_blank" rel="noopener" class="meta-value meta-link">
          Open Raw File
        </a>
      </div>
    </div>
  </main>

  <script>
    const img = document.getElementById('masterImage');
    const dimText = document.getElementById('dimText');
    if (img.complete) {
      dimText.textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px';
    } else {
      img.onload = () => {
        dimText.textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px';
      };
    }
  </script>
</body>
</html>`;
}
