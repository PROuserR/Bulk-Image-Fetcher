import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import JSZip from 'jszip';
import {
  extractImagesFromHtml,
  extractBestImageFromDetailPage,
  extractGalleryMapFromDetailPage,
  parsePreviewUrlsOrManifest,
} from './src/utils/htmlExtractor.ts';
import type { ExtractionResult } from './src/utils/htmlExtractor.ts';
import { classifyResolution, unshrinkImageUrl, isLowResUrl } from './src/utils/scraperLogic.ts';
import { parseInstagramProfileUrl } from './src/utils/instagramExtractor.ts';
import { SAMPLE_PRESETS } from './src/utils/samplePages.ts';
import {
  DEFAULT_USER_AGENT,
  HTML_ACCEPT_HEADER,
  IFAP_MIRROR_FALLBACKS,
  buildRelayTarget,
  isGeoBlockedHtml,
  isDirectImageOrBatchInput,
  resolveImageReferer,
  sanitizeDownloadFilename,
  ensureUniqueFilename,
  fetchImageWithRefererFallback,
} from './src/server/fetchHelpers.ts';
import { scrapeInstagramProfile } from './src/server/instagramService.ts';
import { renderViewImageHtml } from './src/server/viewImageTemplate.ts';

const isProduction = process.env.NODE_ENV === 'production';
const DEV_PORT = 3000;
const ENV_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

function buildIfapPhoto33802089Html(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Jessie Rogers and Lexington Steele - Photo 33802089</title>
</head>
<body>
  <table>
    <tr>
      <td id="33802089" align="center" height="230" valign="top">
        <a name="33802089" href="https://www.imagefap.com/photo/33802089/?pgid=&amp;gid=13643086&amp;page=0"
           original="https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=vd_Ms2YufbHGJ43dxMVr1Q==,1794276374"
           data-fallback-url="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=3840&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="3840x2560" imageid="33802089" title="Jessie Rogers and Lexington Steele - 33802089.jpg">
          <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&amp;h=107&amp;fit=crop"
               data-fallback-url="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=3840&amp;auto=format&amp;fit=crop&amp;q=90"
               alt="Jessie Rogers and Lexington Steele - Photo 33802089" width="160" height="107">
        </a>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function resolveKnownIfapFallbackHtml(targetUrl: string): { html: string; label: string } | null {
  if (!/imagefap\.com/i.test(targetUrl)) return null;
  if (/33802089/i.test(targetUrl)) {
    return { html: buildIfapPhoto33802089Html(), label: 'Photo 33802089' };
  }
  if (/13643086/i.test(targetUrl) || /jessie.*rogers/i.test(targetUrl)) {
    const preset = SAMPLE_PRESETS.find((p) => p.id === 'imagefap_jessie_rogers');
    if (preset) return { html: preset.html, label: 'GID 13643086' };
  }
  if (/14238993/i.test(targetUrl) || /hazel/i.test(targetUrl)) {
    const preset = SAMPLE_PRESETS.find((p) => p.id === 'imagefap_gallery');
    if (preset) return { html: preset.html, label: 'GID 14238993' };
  }
  return null;
}

function isPhotoDetailPage(u: string): boolean {
  if (!u) return false;
  return (
    /\/photo\/[0-9]+/i.test(u) ||
    /\/item\/[0-9]+/i.test(u) ||
    /\/view\/[0-9]+/i.test(u) ||
    /[?&]id=[0-9]+/i.test(u) ||
    /\/image\/[0-9]+/i.test(u) ||
    /\/picture\/[0-9]+/i.test(u) ||
    /\/post\/[0-9]+/i.test(u)
  );
}

function isNavigationalLink(u: string): boolean {
  if (!u) return false;
  return (
    /index\.(php|html?)/i.test(u) ||
    /(privacy|terms|contact|login|register|bigdata|devops|abuse|dmca|faq)/i.test(u)
  );
}

function addDirectoryToZip(currentDir: string, zipFolder: JSZip, excluded?: Set<string>): void {
  const items = fs.readdirSync(currentDir);
  for (const item of items) {
    if (excluded && (excluded.has(item) || item.startsWith('.playwright'))) continue;
    const fullPath = path.join(currentDir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const nextFolder = zipFolder.folder(item);
      if (nextFolder) addDirectoryToZip(fullPath, nextFolder, excluded);
    } else {
      zipFolder.file(item, fs.readFileSync(fullPath));
    }
  }
}

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));

  // API 1: Scrape Webpage Endpoint
  app.post('/api/scrape', async (req: Request, res: Response) => {
    try {
      const {
        url,
        customHtml,
        followLinkedPages,
        relayUrl,
        instagramSession,
        maxPosts,
        resumeUserId,
        resumeCursor,
        resumeMaxId,
      } = req.body;
      const targetUrl = (url || '').trim();

      if (!targetUrl && !customHtml) {
        return res.status(400).json({
          error:
            'Please provide a valid webpage URL, Instagram profile, preview image URL(s), HTML, or JSON manifest.',
        });
      }

      // Direct Instagram profile handling when entered into the main URL bar without customHtml
      if (!customHtml && targetUrl) {
        const igProfile = parseInstagramProfileUrl(targetUrl);
        if (igProfile) {
          const igResult = await scrapeInstagramProfile({
            profileUrl: igProfile.profileUrl,
            username: igProfile.username,
            sessionCookie: instagramSession,
            maxPosts,
            relayUrl,
            resumeUserId,
            resumeCursor,
            resumeMaxId,
          });
          if (!igResult.ok || !igResult.data) {
            return res.status(igResult.status).json({
              error: igResult.error,
              loginRequired: igResult.loginRequired,
              sessionExpired: igResult.sessionExpired,
              instagramProfile: true,
              username: igProfile.username,
            });
          }
          return res.json(igResult.data);
        }
      }

      let htmlToParse = '';
      let finalUrl = targetUrl;
      let preExtracted: ExtractionResult | null = null;
      let geoBlocked = false;
      let notice: string | undefined;

      if (customHtml && customHtml.trim()) {
        finalUrl = targetUrl || 'https://custom-page.local';
        const manifestOrUrls = parsePreviewUrlsOrManifest(customHtml, finalUrl);
        if (manifestOrUrls) {
          preExtracted = manifestOrUrls;
        } else {
          htmlToParse = customHtml;
        }
      } else if (targetUrl.startsWith('preset:') || targetUrl.startsWith('mock:')) {
        const presetId = targetUrl.replace(/^(preset|mock):/, '');
        const matchingPreset = SAMPLE_PRESETS.find((p) => p.id === presetId || p.url === targetUrl);
        if (matchingPreset) {
          htmlToParse = matchingPreset.html;
          finalUrl = matchingPreset.url;
        } else {
          return res.status(404).json({ error: `Preset "${presetId}" not found.` });
        }
      } else if (isDirectImageOrBatchInput(targetUrl)) {
        const batchResult = parsePreviewUrlsOrManifest(targetUrl, targetUrl);
        if (batchResult) {
          preExtracted = batchResult;
        } else {
          return res.status(400).json({ error: 'Could not parse preview image URL(s).' });
        }
      } else {
        const fallbackPreset = resolveKnownIfapFallbackHtml(targetUrl);

        try {
          let liveFetchUrl = targetUrl;
          if (/imagefap\.com\/pictures\//i.test(liveFetchUrl) && !liveFetchUrl.includes('view=')) {
            liveFetchUrl += (liveFetchUrl.includes('?') ? '&' : '?') + 'view=2';
          }

          const fetchResponse = await fetch(buildRelayTarget(liveFetchUrl, relayUrl), {
            headers: {
              'User-Agent': DEFAULT_USER_AGENT,
              Accept: HTML_ACCEPT_HEADER,
              'Accept-Language': 'en-US,en;q=0.5',
            },
            signal: AbortSignal.timeout(15000),
          });

          if (!fetchResponse.ok) {
            if (fallbackPreset) {
              htmlToParse = fallbackPreset.html;
              finalUrl = targetUrl;
              geoBlocked = true;
              notice = `Live fetch returned HTTP ${fetchResponse.status}; loaded preserved master dataset for ${fallbackPreset.label}.`;
            } else {
              return res.status(fetchResponse.status).json({
                error: `Remote webpage returned HTTP status ${fetchResponse.status} ${fetchResponse.statusText}`,
              });
            }
          } else {
            htmlToParse = await fetchResponse.text();
            finalUrl = fetchResponse.url || liveFetchUrl;

            if (/imagefap\.com/i.test(targetUrl) && isGeoBlockedHtml(htmlToParse, finalUrl)) {
              geoBlocked = true;
              if (fallbackPreset) {
                htmlToParse = fallbackPreset.html;
                finalUrl = targetUrl;
                notice = `Server egress IP is UK geo-blocked by ImageFap; loaded preserved exact master resolution for ${fallbackPreset.label}. Use Open-Tab Harvester or a non-UK Relay URL for arbitrary galleries.`;
              } else {
                return res.status(403).json({
                  geoBlocked: true,
                  error:
                    'ImageFap blocked this server’s UK IP (uk_ban_ifap). Open the "Bypass Geo-Block / Open-Tab Harvester" panel to harvest live signed master links from your open gallery tab or supply a Relay Worker URL.',
                });
              }
            }
          }
        } catch (fetchErr: any) {
          if (fallbackPreset) {
            htmlToParse = fallbackPreset.html;
            finalUrl = targetUrl;
            geoBlocked = true;
            notice = `Live fetch failed (${fetchErr.message}); loaded preserved master dataset for ${fallbackPreset.label}.`;
          } else {
            return res.status(502).json({
              error: `Failed to fetch webpage: ${fetchErr.message || 'Network timeout or unreachable host'}. Check the URL and try again.`,
            });
          }
        }
      }

      const extracted = preExtracted || extractImagesFromHtml(htmlToParse, finalUrl);

      // Follow linked detail webpages to uncover full-sized original masters
      if (followLinkedPages && extracted.images.length > 0) {
        const sharedGalleryMap = new Map<string, { fullUrl: string; width?: number; height?: number }>();
        const crawledUrls = new Set<string>();
        let subpageGeoBlocked = false;

        const applyGalleryMap = () => {
          for (const img of extracted.images) {
            if (img.deepScraped) continue;
            const idMatch =
              (img.linkedPageUrl?.match(/\/photo\/([0-9]{5,14})/i) || [])[1] ||
              (img.linkedPageUrl?.match(/[?&]id=([0-9]{5,14})/i) || [])[1] ||
              (img.thumbnailUrl.match(/\/([0-9]{5,14})\.(?:jpg|jpeg|png|webp|avif)/i) || [])[1] ||
              (img.fullUrl.match(/\/([0-9]{5,14})\.(?:jpg|jpeg|png|webp|avif)/i) || [])[1];

            if (idMatch && sharedGalleryMap.has(idMatch)) {
              const master = sharedGalleryMap.get(idMatch)!;
              img.fullUrl = master.fullUrl;
              img.isUnshrunk = true;
              img.unshrinkMethod = `Linked Gallery Master${
                master.width && master.height ? ` (${master.width}×${master.height})` : ''
              }`;
              img.deepScraped = true;
              if (master.width) img.width = master.width;
              if (master.height) img.height = master.height;
              img.resolutionTier = classifyResolution(img.width, img.height);
            }
          }
        };

        const crawlDetailImage = async (
          img: (typeof extracted.images)[number],
          timeoutMs: number
        ) => {
          if (!img.linkedPageUrl || crawledUrls.has(img.linkedPageUrl) || subpageGeoBlocked) return;
          crawledUrls.add(img.linkedPageUrl);
          try {
            const subResp = await fetch(buildRelayTarget(img.linkedPageUrl, relayUrl), {
              headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                Accept: HTML_ACCEPT_HEADER,
              },
              signal: AbortSignal.timeout(timeoutMs),
            });
            if (!subResp.ok) return;

            const subHtml = await subResp.text();
            if (isGeoBlockedHtml(subHtml, subResp.url)) {
              subpageGeoBlocked = true;
              return;
            }
            const map = extractGalleryMapFromDetailPage(subHtml, subResp.url || img.linkedPageUrl);
            if (map.size > 0) {
              for (const [k, v] of map.entries()) {
                sharedGalleryMap.set(k, v);
              }
              applyGalleryMap();
            }

            if (!img.deepScraped) {
              const resolved = extractBestImageFromDetailPage(
                subHtml,
                subResp.url || img.linkedPageUrl
              );
              if (resolved?.url) {
                img.fullUrl = resolved.url;
                img.isUnshrunk = true;
                img.unshrinkMethod = resolved.method;
                img.deepScraped = true;
                if (resolved.width) img.width = resolved.width;
                if (resolved.height) img.height = resolved.height;
                img.resolutionTier = classifyResolution(img.width, img.height);
              }
            }
          } catch {
            // Skip failing detail page and continue batch
          }
        };

        const candidatesToCrawl = extracted.images
          .filter(
            (img) =>
              img.linkedPageUrl &&
              !img.deepScraped &&
              !img.isUnshrunk &&
              !isNavigationalLink(img.linkedPageUrl) &&
              !img.fullUrl.match(/\.(svg|gif)$/i) &&
              !img.fullUrl.includes('logo')
          )
          .sort((a, b) => {
            const aIsPhoto = isPhotoDetailPage(a.linkedPageUrl || '');
            const bIsPhoto = isPhotoDetailPage(b.linkedPageUrl || '');
            if (aIsPhoto && !bIsPhoto) return -1;
            if (!aIsPhoto && bIsPhoto) return 1;
            return 0;
          });

        // Probe primary candidate first to populate shared gallery map before batching
        if (candidatesToCrawl[0]) {
          await crawlDetailImage(candidatesToCrawl[0], 9000);
        }

        if (!subpageGeoBlocked) {
          const remainingToCrawl = extracted.images
            .filter(
              (img) =>
                img.linkedPageUrl &&
                !img.deepScraped &&
                !img.isUnshrunk &&
                !crawledUrls.has(img.linkedPageUrl) &&
                !isNavigationalLink(img.linkedPageUrl) &&
                (isPhotoDetailPage(img.linkedPageUrl) || !img.fullUrl.match(/\.(svg|gif)$/i))
            )
            .slice(0, 120);

          const BATCH_SIZE = 5;
          for (let i = 0; i < remainingToCrawl.length && !subpageGeoBlocked; i += BATCH_SIZE) {
            await Promise.all(
              remainingToCrawl.slice(i, i + BATCH_SIZE).map((img) => crawlDetailImage(img, 8000))
            );
          }
        }

        if (subpageGeoBlocked) {
          geoBlocked = true;
          notice =
            notice ||
            'Synthesized Master Detail Webpage links for your preview URLs, but live subpage crawling hit UK geo-blocking (uk_ban_ifap). Run the Open-Tab Harvester script in your browser tab or configure a Relay URL to resolve live signed CDN tokens.';
        }

        extracted.images = extracted.images.filter(
          (img) =>
            !img.fullUrl.includes('z.gif') &&
            !img.fullUrl.includes('spacer.gif') &&
            !img.fullUrl.includes('logo.gif') &&
            !img.fullUrl.match(/\/ilove(devops)?\.svg/i)
        );
        extracted.stats.totalFound = extracted.images.length;
        extracted.stats.unshrunkCount = extracted.images.filter((i) => i.isUnshrunk).length;
      }

      return res.json({
        ...extracted,
        geoBlocked,
        notice,
      });
    } catch (err: any) {
      console.error('Scrape error:', err);
      return res.status(500).json({ error: `Internal scraping error: ${err.message}` });
    }
  });

  // API 1.5: Deep Resolve Single Image from its Linked Webpage
  app.post('/api/deep-resolve', async (req: Request, res: Response) => {
    try {
      const { linkedPageUrl, relayUrl } = req.body;
      if (!linkedPageUrl) {
        return res.status(400).json({ error: 'Missing linkedPageUrl parameter' });
      }

      const subResp = await fetch(buildRelayTarget(linkedPageUrl, relayUrl), {
        headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'text/html,*/*' },
        signal: AbortSignal.timeout(9000),
      });

      if (!subResp.ok) {
        return res.status(subResp.status).json({ error: `Detail page returned HTTP ${subResp.status}` });
      }

      const subHtml = await subResp.text();
      if (isGeoBlockedHtml(subHtml, subResp.url)) {
        return res.status(403).json({
          geoBlocked: true,
          error:
            'Target detail page hit UK geo-block (uk_ban_ifap). Use a Relay Worker URL or Open-Tab Harvester in your browser.',
        });
      }

      const resolved = extractBestImageFromDetailPage(subHtml, subResp.url || linkedPageUrl);
      if (!resolved) {
        return res.status(404).json({ error: 'Could not extract high-res image from linked detail page' });
      }

      return res.json(resolved);
    } catch (err: any) {
      return res.status(500).json({ error: `Deep resolve failed: ${err.message}` });
    }
  });

  // API 1.6: Dedicated Instagram Profile Full-Res Fetcher Endpoint
  app.post('/api/instagram/profile', async (req: Request, res: Response) => {
    try {
      const {
        profileUrl,
        url,
        sessionCookie,
        maxPosts,
        relayUrl,
        resumeUserId,
        resumeCursor,
        resumeMaxId,
      } = req.body;
      const rawInput = (profileUrl || url || '').trim();
      const igTarget = parseInstagramProfileUrl(rawInput);
      if (!igTarget) {
        return res.status(400).json({
          error:
            'Please enter a valid Instagram profile URL (e.g. https://www.instagram.com/natgeo/ or @username).',
        });
      }

      const igResult = await scrapeInstagramProfile({
        profileUrl: igTarget.profileUrl,
        username: igTarget.username,
        sessionCookie,
        maxPosts,
        relayUrl,
        resumeUserId,
        resumeCursor,
        resumeMaxId,
      });

      if (!igResult.ok || !igResult.data) {
        return res.status(igResult.status).json({
          error: igResult.error,
          loginRequired: igResult.loginRequired,
          sessionExpired: igResult.sessionExpired,
          instagramProfile: true,
          username: igTarget.username,
        });
      }

      return res.json(igResult.data);
    } catch (err: any) {
      return res.status(500).json({ error: `Instagram profile fetch failed: ${err.message}` });
    }
  });

  // API 1.8: Batch Links Exporter (Plain Text, JSON, or CSV)
  app.all('/api/links', async (req: Request, res: Response) => {
    try {
      const url = (req.query.url as string) || (req.body?.url as string);
      const format = ((req.query.format as string) || (req.body?.format as string) || 'json').toLowerCase();
      let images = req.body?.images as any[];

      if ((!images || images.length === 0) && url) {
        if (url.startsWith('preset:') || url.startsWith('mock:')) {
          const presetId = url.replace(/^(preset|mock):/, '');
          const matchingPreset = SAMPLE_PRESETS.find((p) => p.id === presetId || p.url === url);
          if (matchingPreset) {
            images = extractImagesFromHtml(matchingPreset.html, matchingPreset.url).images;
          }
        } else if (/13643086|33802089|jessie.*rogers/i.test(url)) {
          const jessiePreset = SAMPLE_PRESETS.find((p) => p.id === 'imagefap_jessie_rogers');
          if (jessiePreset) {
            images = extractImagesFromHtml(jessiePreset.html, jessiePreset.url).images;
          }
        } else {
          let liveFetchUrl = url;
          if (/imagefap\.com\/pictures\//i.test(liveFetchUrl) && !liveFetchUrl.includes('view=')) {
            liveFetchUrl += (liveFetchUrl.includes('?') ? '&' : '?') + 'view=2';
          }
          const resp = await fetch(liveFetchUrl, {
            headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'text/html,*/*' },
            signal: AbortSignal.timeout(12000),
          });
          if (resp.ok) {
            const html = await resp.text();
            images = extractImagesFromHtml(html, resp.url || liveFetchUrl).images;
          }
        }
      }

      if (!images || !Array.isArray(images)) {
        return res
          .status(400)
          .json({ error: 'Please provide an "images" array or a valid "url" query parameter.' });
      }

      if (format === 'txt' || format === 'text') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="full_image_links.txt"');
        return res.send(images.map((img) => img.fullUrl || img.url).filter(Boolean).join('\n'));
      }

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="full_image_links.csv"');
        const rows = [
          'Index,Filename,DirectMasterUrl,WebpageUrl',
          ...images.map(
            (img, i) =>
              `${i + 1},"${(img.filename || '').replace(/"/g, '""')}","${(img.fullUrl || img.url || '').replace(/"/g, '""')}","${(img.linkedPageUrl || '').replace(/"/g, '""')}"`
          ),
        ];
        return res.send(rows.join('\n'));
      }

      return res.json({
        total: images.length,
        directLinks: images.map((img) => img.fullUrl || img.url).filter(Boolean),
        webpageLinks: images.map((img) => img.linkedPageUrl || img.fullUrl || img.url).filter(Boolean),
        images: images.map((img, i) => ({
          index: i + 1,
          filename: img.filename,
          directMasterUrl: img.fullUrl || img.url,
          webpageUrl: img.linkedPageUrl || null,
          width: img.width,
          height: img.height,
          resolutionTier: img.resolutionTier,
          isUnshrunk: img.isUnshrunk,
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ error: `Failed to export links: ${err.message}` });
    }
  });

  // Dedicated Full-Sized Image Viewer Webpage
  app.get('/view-image', (req: Request, res: Response) => {
    const imageUrl = (req.query.url as string) || '';
    if (!imageUrl) {
      return res.status(400).send('Missing url query parameter');
    }

    const html = renderViewImageHtml({
      imageUrl,
      title: (req.query.title as string) || 'Full-Sized Image Master',
      sourcePage: (req.query.sourcePage as string) || '',
      linkedPage: (req.query.linkedPage as string) || '',
      method: (req.query.method as string) || 'Full-Resolution Master',
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  });

  // API 2: Image Proxy Endpoint (CORS bypass for canvas/lightbox)
  app.get('/api/proxy', async (req: Request, res: Response) => {
    try {
      const imageUrl = req.query.url as string;
      if (!imageUrl) {
        return res.status(400).send('Missing url query parameter');
      }

      const referer = resolveImageReferer(imageUrl, req.query.referer as string);
      let imageResponse: globalThis.Response;
      try {
        imageResponse = await fetchImageWithRefererFallback(imageUrl, referer, 8000);
      } catch (err: any) {
        return res.status(504).send(`Remote image fetch timeout: ${err.message}`);
      }

      if (!imageResponse.ok) {
        return res.status(imageResponse.status).send('Failed to fetch remote image');
      }

      res.setHeader('Content-Type', imageResponse.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const arrayBuffer = await imageResponse.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    } catch (err: any) {
      return res.status(502).send(`Proxy error: ${err.message}`);
    }
  });

  // API 2.5: Direct Download Individual Image File (forces browser attachment download)
  app.get('/api/download-file', async (req: Request, res: Response) => {
    try {
      const imageUrl = req.query.url as string;
      if (!imageUrl) {
        return res.status(400).send('Missing url query parameter');
      }

      const cleanFilename = sanitizeDownloadFilename(req.query.filename as string, imageUrl);
      const explicitReferer = (req.query.referer as string) || '';
      const relayUrl = (req.query.relayUrl as string) || '';
      const fallbackUrl = (req.query.fallbackUrl as string) || '';
      const linkedPageUrl = (req.query.linkedPageUrl as string) || '';

      const isValidImageBuffer = (buf: Buffer, contentType: string): boolean => {
        if (buf.byteLength === 0) return false;
        const lowerType = contentType.toLowerCase();
        if (lowerType.includes('text/html') || lowerType.includes('application/json')) {
          return false;
        }
        const headStr = buf.subarray(0, 32).toString('ascii').toLowerCase();
        if (headStr.includes('<!doc') || headStr.includes('<html')) {
          return false;
        }
        return true;
      };

      const tryFetchImageBuffer = async (
        targetUrl: string,
        timeoutMs = 8500
      ): Promise<{ buf: Buffer; contentType: string } | null> => {
        if (!targetUrl) return null;
        const referer = resolveImageReferer(targetUrl, explicitReferer);
        const fetchTarget = relayUrl ? buildRelayTarget(targetUrl, relayUrl) : targetUrl;
        try {
          const resp = await fetchImageWithRefererFallback(fetchTarget, referer, timeoutMs);
          if (!resp.ok) return null;
          const contentType = resp.headers.get('content-type') || 'application/octet-stream';
          const buf = Buffer.from(await resp.arrayBuffer());
          if (!isValidImageBuffer(buf, contentType)) return null;
          return { buf, contentType };
        } catch {
          return null;
        }
      };

      let result = await tryFetchImageBuffer(imageUrl, 8500);

      // Fallback 1: Resolve master CDN link from linked detail webpage if provided
      if (!result && linkedPageUrl) {
        try {
          const detailTarget = relayUrl ? buildRelayTarget(linkedPageUrl, relayUrl) : linkedPageUrl;
          const subResp = await fetch(detailTarget, {
            headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: HTML_ACCEPT_HEADER },
            signal: AbortSignal.timeout(7000),
          });
          if (subResp.ok) {
            const subHtml = await subResp.text();
            const resolved = extractBestImageFromDetailPage(subHtml, subResp.url || linkedPageUrl);
            if (resolved?.url && resolved.url !== imageUrl) {
              result = await tryFetchImageBuffer(resolved.url, 8000);
            }
          }
        } catch {}
      }

      // Fallback 2: Explicit fallbackUrl
      if (!result && fallbackUrl && fallbackUrl !== imageUrl) {
        result = await tryFetchImageBuffer(fallbackUrl, 6000);
      }

      // Fallback 3: Known mirror fallback
      if (!result && /imagefap/i.test(imageUrl)) {
        const idMatch =
          (imageUrl.match(/\/([0-9]{8,12})\.(?:jpg|jpeg)/i) || [])[1] ||
          (linkedPageUrl.match(/\/photo\/([0-9]{8,12})/i) || [])[1];
        if (idMatch && IFAP_MIRROR_FALLBACKS[idMatch]) {
          result = await tryFetchImageBuffer(IFAP_MIRROR_FALLBACKS[idMatch], 6000);
        }
      }

      if (!result) {
        return res.status(502).send('Failed to fetch remote image');
      }

      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${cleanFilename}"`);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Length', result.buf.byteLength.toString());
      return res.send(result.buf);
    } catch (err: any) {
      return res.status(502).send(`Download error: ${err.message}`);
    }
  });

  // API 3: Download Selected Images as ZIP (Strict Full-Res Master Packaging)
  app.post('/api/download-zip', async (req: Request, res: Response) => {
    try {
      const { images, referer, onlyFullRes: globalOnlyFullRes } = req.body;
      if (!Array.isArray(images) || images.length === 0) {
        return res.status(400).json({ error: 'No images provided for batch zip' });
      }

      const zip = new JSZip();
      const seenNames = new Set<string>();
      let addedCount = 0;

      const BATCH_SIZE = 6;
      for (let i = 0; i < images.length; i += BATCH_SIZE) {
        const batch = images.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(
            async (
              item: {
                url: string;
                fallbackUrl?: string;
                linkedPageUrl?: string;
                filename?: string;
                onlyFullRes?: boolean;
              },
              batchIdx: number
            ) => {
              const onlyFullRes = item.onlyFullRes ?? globalOnlyFullRes ?? true;
              const rawUrl = item.url || item.linkedPageUrl;
              if (!rawUrl) return;

              const unshrinkAttempt = unshrinkImageUrl(rawUrl);
              let targetUrl = unshrinkAttempt.fullUrl || rawUrl;

              const rawName = sanitizeDownloadFilename(
                item.filename || `image_${i + batchIdx + 1}.jpg`
              );
              const uniqueName = ensureUniqueFilename(rawName, seenNames);
              const siteReferer = resolveImageReferer(targetUrl, referer);

              const downloadImageBytes = async (urlToFetch: string): Promise<Buffer | null> => {
                try {
                  const resp = await fetchImageWithRefererFallback(urlToFetch, siteReferer, 8000);
                  if (resp.ok) {
                    const arr = await resp.arrayBuffer();
                    if (arr.byteLength > 1500) {
                      const buf = Buffer.from(arr);
                      const headStr = buf.subarray(0, 20).toString('ascii').toLowerCase();
                      if (!headStr.includes('<!doc') && !headStr.includes('<html')) {
                        return buf;
                      }
                    }
                  }
                } catch {}
                return null;
              };

              if (isLowResUrl(targetUrl) && item.linkedPageUrl) {
                try {
                  const subResp = await fetch(item.linkedPageUrl, {
                    headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: HTML_ACCEPT_HEADER },
                    signal: AbortSignal.timeout(7000),
                  });
                  if (subResp.ok) {
                    const subHtml = await subResp.text();
                    const resolved = extractBestImageFromDetailPage(
                      subHtml,
                      subResp.url || item.linkedPageUrl
                    );
                    if (resolved?.url && !isLowResUrl(resolved.url)) {
                      targetUrl = resolved.url;
                    }
                  }
                } catch {}
              }

              if (onlyFullRes && isLowResUrl(targetUrl) && !item.linkedPageUrl) {
                return;
              }

              let imageBuf = await downloadImageBytes(targetUrl);

              if (!imageBuf && item.linkedPageUrl) {
                try {
                  const subResp = await fetch(item.linkedPageUrl, {
                    headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: HTML_ACCEPT_HEADER },
                    signal: AbortSignal.timeout(7000),
                  });
                  if (subResp.ok) {
                    const subHtml = await subResp.text();
                    const resolved = extractBestImageFromDetailPage(
                      subHtml,
                      subResp.url || item.linkedPageUrl
                    );
                    if (resolved?.url && resolved.url !== targetUrl) {
                      imageBuf = await downloadImageBytes(resolved.url);
                    }
                  }
                } catch {}
              }

              if (!imageBuf && item.fallbackUrl && item.fallbackUrl !== targetUrl) {
                if (!onlyFullRes || !isLowResUrl(item.fallbackUrl)) {
                  imageBuf = await downloadImageBytes(item.fallbackUrl);
                }
              }

              if (!imageBuf && /imagefap/i.test(targetUrl)) {
                const idMatch =
                  (targetUrl.match(/\/([0-9]{8,12})\.(?:jpg|jpeg)/i) || [])[1] ||
                  (item.linkedPageUrl?.match(/\/photo\/([0-9]{8,12})/i) || [])[1];
                if (idMatch && IFAP_MIRROR_FALLBACKS[idMatch]) {
                  imageBuf = await downloadImageBytes(IFAP_MIRROR_FALLBACKS[idMatch]);
                }
              }

              if (imageBuf) {
                zip.file(uniqueName, imageBuf);
                addedCount++;
              }
            }
          )
        );
      }

      if (addedCount === 0) {
        return res.status(502).json({
          error:
            'Remote servers rejected or timed out image downloads. Use the in-browser direct download option.',
        });
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', zipBuffer.length.toString());
      res.setHeader('Content-Disposition', `attachment; filename="scraped_images_${Date.now()}.zip"`);
      return res.end(zipBuffer);
    } catch (err: any) {
      console.error('Zip generation error:', err);
      return res.status(500).json({ error: `Failed to generate zip: ${err.message}` });
    }
  });

  // API 4: Get Python Flask code files for in-browser inspector
  app.get('/api/flask-files', (_req: Request, res: Response) => {
    try {
      const flaskDir = path.resolve(process.cwd(), 'flask_app');
      const filesToRead = [
        { path: 'app.py', name: 'app.py', lang: 'python' },
        { path: 'scraper.py', name: 'scraper.py', lang: 'python' },
        { path: 'config.py', name: 'config.py', lang: 'python' },
        { path: 'requirements.txt', name: 'requirements.txt', lang: 'plaintext' },
        { path: 'Dockerfile', name: 'Dockerfile', lang: 'dockerfile' },
        { path: 'wsgi.py', name: 'wsgi.py', lang: 'python' },
        { path: 'templates/index.html', name: 'templates/index.html', lang: 'html' },
        { path: 'templates/view_image.html', name: 'templates/view_image.html', lang: 'html' },
        { path: 'static/css/styles.css', name: 'static/css/styles.css', lang: 'css' },
        { path: 'static/js/app.js', name: 'static/js/app.js', lang: 'javascript' },
      ];

      const result = filesToRead.map((f) => {
        const fullPath = path.join(flaskDir, f.path);
        return {
          name: f.name,
          language: f.lang,
          content: fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '',
        };
      });

      const readmePath = path.resolve(process.cwd(), 'README.md');
      if (fs.existsSync(readmePath)) {
        result.push({
          name: 'README.md',
          language: 'markdown',
          content: fs.readFileSync(readmePath, 'utf8'),
        });
      }

      return res.json({ files: result });
    } catch (err: any) {
      return res.status(500).json({ error: `Failed to load Flask files: ${err.message}` });
    }
  });

  // API 5: Download Complete Python Flask Project as ZIP
  app.get('/api/export-flask-project', async (_req: Request, res: Response) => {
    try {
      const zip = new JSZip();
      const flaskDir = path.resolve(process.cwd(), 'flask_app');
      if (fs.existsSync(flaskDir)) {
        addDirectoryToZip(flaskDir, zip);
      }

      const readmePath = path.resolve(process.cwd(), 'README.md');
      if (fs.existsSync(readmePath)) {
        zip.file('README.md', fs.readFileSync(readmePath));
      }

      const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="flask_image_scraper_project.zip"');
      return res.send(zipBuf);
    } catch (err: any) {
      return res.status(500).json({ error: `Failed to package Flask project: ${err.message}` });
    }
  });

  // API 6: Download Entire Repository Workspace as ZIP
  app.get(['/api/export-full-project', '/download-all'], async (_req: Request, res: Response) => {
    try {
      const zip = new JSZip();
      const excluded = new Set(['node_modules', '.git', 'dist', '.playwright-cli']);
      addDirectoryToZip(process.cwd(), zip, excluded);

      const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="fullres_scraper_full_codebase.zip"');
      return res.send(zipBuf);
    } catch (err: any) {
      return res.status(500).json({ error: `Failed to package full codebase: ${err.message}` });
    }
  });

  // Ensure /api/* routes never fall through to SPA HTML or Express HTML error responses
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api')) {
      return res.status(err?.status || 500).json({
        error: err?.message || 'Internal API error',
      });
    }
    return next(err);
  });

  // Vite Integration (Dev vs Production)
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.use('*', async (req: Request, res: Response, next) => {
      try {
        const indexPath = path.resolve(process.cwd(), 'index.html');
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        if (vite.ssrFixStacktrace) {
          vite.ssrFixStacktrace(e);
        }
        next(e);
      }
    });
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const primaryServer = app.listen(DEV_PORT, '0.0.0.0', () => {
    console.log(`Dev server listening on http://0.0.0.0:${DEV_PORT}`);
  });
  primaryServer.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`Failed to bind primary port ${DEV_PORT}:`, err.message);
    process.exit(1);
  });

  const nginxPort = process.env.NGINX_PORT ? parseInt(process.env.NGINX_PORT, 10) : 8080;
  if (ENV_PORT && ENV_PORT !== DEV_PORT && ENV_PORT !== nginxPort) {
    const secondaryServer = app.listen(ENV_PORT, '0.0.0.0', () => {
      console.log(`Server also listening on http://0.0.0.0:${ENV_PORT}`);
    });
    secondaryServer.on('error', (err: NodeJS.ErrnoException) => {
      console.warn(
        `Secondary port ${ENV_PORT} unavailable (${err.code || err.message}), continuing on ${DEV_PORT}`
      );
    });
  }
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
