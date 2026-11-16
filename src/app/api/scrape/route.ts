import { NextRequest, NextResponse } from 'next/server';
import {
  extractImagesFromHtml,
  extractBestImageFromDetailPage,
  extractGalleryMapFromDetailPage,
  parsePreviewUrlsOrManifest,
} from '@/utils/htmlExtractor';
import type { ExtractionResult } from '@/utils/htmlExtractor';
import { classifyResolution } from '@/utils/scraperLogic';
import { parseInstagramProfileUrl } from '@/utils/instagramExtractor';
import { SAMPLE_PRESETS } from '@/utils/samplePages';
import {
  DEFAULT_USER_AGENT,
  HTML_ACCEPT_HEADER,
  buildRelayTarget,
  isGeoBlockedHtml,
  isDirectImageOrBatchInput,
} from '@/server/fetchHelpers';
import { scrapeInstagramProfile } from '@/server/instagramService';
import {
  resolveKnownIfapFallbackHtml,
  isPhotoDetailPage,
  isNavigationalLink,
} from '@/server/scrapeRouteHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
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
    } = body || {};
    const targetUrl = String(url || '').trim();

    if (!targetUrl && !customHtml) {
      return NextResponse.json(
        {
          error:
            'Please provide a valid webpage URL, Instagram profile, preview image URL(s), HTML, or JSON manifest.',
        },
        { status: 400 }
      );
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
          return NextResponse.json(
            {
              error: igResult.error,
              loginRequired: igResult.loginRequired,
              sessionExpired: igResult.sessionExpired,
              instagramProfile: true,
              username: igProfile.username,
            },
            { status: igResult.status }
          );
        }
        return NextResponse.json(igResult.data);
      }
    }

    let htmlToParse = '';
    let finalUrl = targetUrl;
    let preExtracted: ExtractionResult | null = null;
    let geoBlocked = false;
    let notice: string | undefined;

    if (customHtml && String(customHtml).trim()) {
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
        return NextResponse.json({ error: `Preset "${presetId}" not found.` }, { status: 404 });
      }
    } else if (isDirectImageOrBatchInput(targetUrl)) {
      const batchResult = parsePreviewUrlsOrManifest(targetUrl, targetUrl);
      if (batchResult) {
        preExtracted = batchResult;
      } else {
        return NextResponse.json(
          { error: 'Could not parse preview image URL(s).' },
          { status: 400 }
        );
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
            return NextResponse.json(
              {
                error: `Remote webpage returned HTTP status ${fetchResponse.status} ${fetchResponse.statusText}`,
              },
              { status: fetchResponse.status }
            );
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
              return NextResponse.json(
                {
                  geoBlocked: true,
                  error:
                    'ImageFap blocked this server’s UK IP (uk_ban_ifap). Open the "Bypass Geo-Block / Open-Tab Harvester" panel to harvest live signed master links from your open gallery tab or supply a Relay Worker URL.',
                },
                { status: 403 }
              );
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
          return NextResponse.json(
            {
              error: `Failed to fetch webpage: ${fetchErr.message || 'Network timeout or unreachable host'}. Check the URL and try again.`,
            },
            { status: 502 }
          );
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

    return NextResponse.json({
      ...extracted,
      geoBlocked,
      notice,
    });
  } catch (err: any) {
    console.error('Scrape error:', err);
    return NextResponse.json(
      { error: `Internal scraping error: ${err?.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}
