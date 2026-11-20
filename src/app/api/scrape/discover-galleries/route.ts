import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import {
  discoverChildGalleryLinks,
  extractParentHubPaginationUrls,
  normalizeGalleryHref,
  type DiscoveredGallery,
} from '@/utils/nestedGalleryLogic';
import { isGeoBlockedHtml } from '@/server/fetchHelpers';
import {
  normalizeGalleryFetchUrl,
  resolveDiscoveredGalleriesIntermediateLinks,
} from '@/server/scrapeRouteHelpers';
import {
  fetchHtmlWithFallback,
  resolveVirtualPresetHtml,
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
      urlPatternFilter = '',
      sameOriginOnly = true,
      maxGalleries = 50,
    } = body || {};

    const targetUrl = String(url || '').trim();
    if (!targetUrl && !customHtml) {
      return NextResponse.json(
        { error: 'Please provide a parent hub webpage URL or HTML source.' },
        { status: 400 }
      );
    }

    let html = '';
    let finalUrl = targetUrl;
    let geoBlocked = false;
    let notice: string | undefined;
    let isLiveFetch = false;

    if (customHtml && String(customHtml).trim()) {
      html = String(customHtml);
      finalUrl = targetUrl ? normalizeGalleryFetchUrl(targetUrl) : 'https://nested-hub.local/';
    } else {
      const virtualMatch = resolveVirtualPresetHtml(targetUrl);
      if (virtualMatch) {
        html = virtualMatch.html;
        finalUrl = virtualMatch.url;
      } else {
        const normalizedUrl = normalizeGalleryFetchUrl(targetUrl);
        const fetchRes = await fetchHtmlWithFallback(normalizedUrl, relayUrl, 16000);
        if (!fetchRes.ok) {
          return NextResponse.json(
            {
              error: `Parent webpage returned HTTP ${fetchRes.status} ${fetchRes.statusText || ''}`.trim(),
            },
            { status: fetchRes.status || 502 }
          );
        }
        html = fetchRes.html;
        finalUrl = fetchRes.url || normalizedUrl;
        isLiveFetch = true;
        if (isGeoBlockedHtml(html, finalUrl)) {
          geoBlocked = true;
          return NextResponse.json(
            {
              geoBlocked: true,
              error:
                'Parent webpage hit UK geo-blocking (uk_ban_ifap). Configure a Relay Worker URL or paste the parent hub HTML source.',
            },
            { status: 403 }
          );
        }
      }
    }

    const $ = cheerio.load(html);
    const parentTitle = $('title').first().text().trim() || finalUrl;
    const requestedMax = Math.min(Math.max(1, Number(maxGalleries) || 50), 100);
    const cleanFilter = typeof urlPatternFilter === 'string' ? urlPatternFilter : '';
    const sameOrigin = sameOriginOnly !== false;

    let galleries = discoverChildGalleryLinks(html, finalUrl, {
      maxGalleries: requestedMax,
      urlPatternFilter: cleanFilter,
      sameOriginOnly: sameOrigin,
    });

    if (isLiveFetch && galleries.length < requestedMax) {
      const hubPages = extractParentHubPaginationUrls(html, finalUrl, 3);
      if (hubPages.length > 0) {
        const seenKeys = new Set<string>(
          galleries.map((g) => normalizeGalleryHref(g.url, finalUrl)?.canonicalKey || g.url)
        );
        const merged: DiscoveredGallery[] = [...galleries];
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
        galleries = merged;
      }
    }

    if (isLiveFetch && galleries.some((g) => g.isIntermediateItem)) {
      galleries = await resolveDiscoveredGalleriesIntermediateLinks(
        galleries,
        async (itemUrl, timeoutMs) => {
          const res = await fetchHtmlWithFallback(itemUrl, relayUrl, timeoutMs);
          return {
            ok: res.ok,
            url: res.url,
            html: res.html,
          };
        },
        { maxToResolve: 20, concurrency: 5 }
      );
    }

    if (galleries.length === 0) {
      notice =
        'No nested child gallery URLs matched the discovery rules on this page. Try unchecking "Same domain only" or adding a URL pattern filter.';
    }

    return NextResponse.json({
      parentUrl: finalUrl,
      parentTitle,
      galleries,
      totalFound: galleries.length,
      geoBlocked,
      notice,
    });
  } catch (err: any) {
    console.error('Discover galleries error:', err);
    return NextResponse.json(
      { error: `Failed to discover child galleries: ${err?.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}
