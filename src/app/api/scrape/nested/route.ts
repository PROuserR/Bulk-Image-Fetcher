import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import {
  discoverChildGalleryLinks,
  extractParentHubPaginationUrls,
  mergeNestedGalleryResults,
  normalizeGalleryHref,
  type DiscoveredGallery,
  type NestedGalleryRunInput,
} from '@/utils/nestedGalleryLogic';
import { isGeoBlockedHtml } from '@/server/fetchHelpers';
import { normalizeGalleryFetchUrl } from '@/server/scrapeRouteHelpers';
import {
  fetchHtmlWithFallback,
  resolveVirtualPresetHtml,
  scrapeSingleGallery,
} from '@/server/galleryScraperService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      url,
      customHtml,
      relayUrl,
      followLinkedPages = true,
      urlPatternFilter = '',
      sameOriginOnly = true,
      maxGalleries = 25,
      selectedGalleries,
    } = body || {};

    const targetUrl = String(url || '').trim();
    if (!targetUrl && (!Array.isArray(selectedGalleries) || selectedGalleries.length === 0)) {
      return NextResponse.json(
        { error: 'Please provide a parent hub URL or a list of child galleries.' },
        { status: 400 }
      );
    }

    let parentUrl = targetUrl;
    let parentTitle = targetUrl;
    let targetGalleries: DiscoveredGallery[] = [];

    if (Array.isArray(selectedGalleries) && selectedGalleries.length > 0) {
      targetGalleries = selectedGalleries.slice(0, Math.min(Number(maxGalleries) || 50, 100));
    } else {
      let html = '';
      let isLiveFetch = false;
      if (customHtml && String(customHtml).trim()) {
        html = String(customHtml);
        parentUrl = targetUrl ? normalizeGalleryFetchUrl(targetUrl) : 'https://nested-hub.local/';
      } else {
        const virtualMatch = resolveVirtualPresetHtml(targetUrl);
        if (virtualMatch) {
          html = virtualMatch.html;
          parentUrl = virtualMatch.url;
        } else {
          const normalized = normalizeGalleryFetchUrl(targetUrl);
          const fetchRes = await fetchHtmlWithFallback(normalized, relayUrl, 16000);
          if (!fetchRes.ok) {
            return NextResponse.json(
              { error: `Parent hub returned HTTP ${fetchRes.status}` },
              { status: fetchRes.status || 502 }
            );
          }
          html = fetchRes.html;
          parentUrl = fetchRes.url || normalized;
          isLiveFetch = true;
          if (isGeoBlockedHtml(html, parentUrl)) {
            return NextResponse.json(
              {
                geoBlocked: true,
                error: 'Parent webpage hit UK geo-blocking (uk_ban_ifap).',
              },
              { status: 403 }
            );
          }
        }
      }

      const $ = cheerio.load(html);
      parentTitle = $('title').first().text().trim() || parentUrl;
      const requestedMax = Math.min(Math.max(1, Number(maxGalleries) || 25), 100);
      const cleanFilter = typeof urlPatternFilter === 'string' ? urlPatternFilter : '';
      const sameOrigin = sameOriginOnly !== false;

      targetGalleries = discoverChildGalleryLinks(html, parentUrl, {
        maxGalleries: requestedMax,
        urlPatternFilter: cleanFilter,
        sameOriginOnly: sameOrigin,
      });

      if (isLiveFetch && targetGalleries.length < requestedMax) {
        const hubPages = extractParentHubPaginationUrls(html, parentUrl, 3);
        if (hubPages.length > 0) {
          const seenKeys = new Set<string>(
            targetGalleries.map((g) => normalizeGalleryHref(g.url, parentUrl)?.canonicalKey || g.url)
          );
          const merged: DiscoveredGallery[] = [...targetGalleries];
          const extraHtmls = await Promise.all(
            hubPages.map(async (pageHref) => {
              try {
                const res = await fetchHtmlWithFallback(pageHref, relayUrl, 12000);
                return res.ok && !isGeoBlockedHtml(res.html, res.url)
                  ? { html: res.html, url: res.url || pageHref }
                  : null;
              } catch {
                return null;
              }
            })
          );
          for (const extra of extraHtmls) {
            if (!extra || merged.length >= requestedMax) break;
            const extraGals = discoverChildGalleryLinks(extra.html, extra.url, {
              maxGalleries: requestedMax,
              urlPatternFilter: cleanFilter,
              sameOriginOnly: sameOrigin,
            });
            for (const g of extraGals) {
              if (merged.length >= requestedMax) break;
              const key = normalizeGalleryHref(g.url, extra.url)?.canonicalKey || g.url;
              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                merged.push({ ...g, id: `gal_${merged.length + 1}` });
              }
            }
          }
          targetGalleries = merged;
        }
      }
    }

    if (targetGalleries.length === 0) {
      return NextResponse.json(
        { error: 'No child gallery URLs were discovered on this webpage.' },
        { status: 404 }
      );
    }

    const runs: NestedGalleryRunInput[] = [];
    const CONCURRENCY = 2;

    for (let i = 0; i < targetGalleries.length; i += CONCURRENCY) {
      const chunk = targetGalleries.slice(i, i + CONCURRENCY);
      const chunkRuns = await Promise.all(
        chunk.map(async (gallery): Promise<NestedGalleryRunInput> => {
          try {
            const outcome = await scrapeSingleGallery({
              url: gallery.url,
              followLinkedPages,
              relayUrl,
            });
            if (!outcome.ok || !outcome.result) {
              return {
                gallery,
                result: null,
                error: outcome.error || `HTTP ${outcome.status}`,
                geoBlocked: outcome.geoBlocked,
              };
            }
            return {
              gallery,
              result: outcome.result,
              geoBlocked: outcome.geoBlocked,
            };
          } catch (err: any) {
            return {
              gallery,
              result: null,
              error: err?.message || 'Gallery fetch failed',
            };
          }
        })
      );
      runs.push(...chunkRuns);
    }

    const merged = mergeNestedGalleryResults(parentUrl, parentTitle, runs);
    const anyGeoBlocked = runs.some((r) => r.geoBlocked);

    return NextResponse.json({
      ...merged,
      isNestedMultiGallery: true,
      geoBlocked: anyGeoBlocked,
    });
  } catch (err: any) {
    console.error('Nested scrape error:', err);
    return NextResponse.json(
      { error: `Nested multi-gallery crawl failed: ${err?.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}
