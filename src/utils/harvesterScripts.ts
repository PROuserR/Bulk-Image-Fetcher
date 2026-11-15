/**
 * Self-contained browser DevTools console harvester scripts for extracting live
 * session-authenticated master images from open browser tabs.
 */

export const OPEN_TAB_HARVESTER_SCRIPT = `(async () => {
  const seen = new Set();
  const anchors = [...document.querySelectorAll('a[href*="/photo/"], a[original]')];
  const entries = [];
  for (const a of anchors) {
    const img = a.querySelector('img');
    const thumb = img?.getAttribute('src') || img?.getAttribute('data-src') || '';
    const href = a.href || '';
    const orig = a.getAttribute('original') || '';
    if ((!href && !orig) || seen.has(href || orig)) continue;
    seen.add(href || orig);
    entries.push({ thumb: thumb ? new URL(thumb, location.href).href : '', linkedPageUrl: href, fullUrl: orig, altText: img?.alt || a.title || '' });
  }
  const map = new Map();
  const crawl = async (item) => {
    if (!item.linkedPageUrl || item.fullUrl.includes('/images/full/')) return;
    try {
      const html = await (await fetch(item.linkedPageUrl, { credentials: 'include' })).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('a[original], a[href*="/images/full/"], a[imageid]').forEach((el) => {
        const u = el.getAttribute('original') || el.getAttribute('href') || '';
        const id = el.getAttribute('imageid') || (u.match(/\\/(\\d{6,14})\\.(?:jpg|jpeg|png|webp)/i) || [])[1];
        const dim = (el.getAttribute('dimension') || '').split('x');
        if (id && u.includes('/images/full/')) map.set(id, { fullUrl: new URL(u, item.linkedPageUrl).href, width: +dim[0] || undefined, height: +dim[1] || undefined });
      });
      doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        try {
          const j = JSON.parse(s.textContent || '{}');
          const c = j.contentUrl || (typeof j.image === 'string' ? j.image : j.image?.url);
          const id = (item.linkedPageUrl.match(/\\/photo\\/(\\d+)/) || [])[1];
          if (c && id && !map.has(id)) map.set(id, { fullUrl: new URL(c, item.linkedPageUrl).href, width: +j.width || undefined, height: +j.height || undefined });
        } catch {}
      });
      const id = (item.linkedPageUrl.match(/\\/photo\\/(\\d+)/) || [])[1];
      if (id && map.has(id)) {
        Object.assign(item, map.get(id));
      } else {
        const m = html.match(/https?:\\/\\/[^"'\\s<>]+\\/images\\/full\\/[0-9a-zA-Z\\/_-]+\\.(?:jpg|jpeg|png|webp|avif)(?:\\?[^"'\\s<>]*)?/i);
        if (m) item.fullUrl = m[0].replace(/&amp;/g, '&');
      }
    } catch {}
  };
  for (let i = 0; i < entries.length; i += 4) {
    await Promise.all(entries.slice(i, i + 4).map(crawl));
  }
  const images = entries.map((e, idx) => ({
    id: 'img_' + (idx + 1),
    thumbnailUrl: e.thumb || e.fullUrl,
    fullUrl: e.fullUrl || e.thumb,
    linkedPageUrl: e.linkedPageUrl || undefined,
    width: e.width,
    height: e.height,
    altText: e.altText || undefined,
    isUnshrunk: Boolean(e.fullUrl && e.fullUrl.includes('/images/full/')),
    unshrinkMethod: 'Open-Tab Live Harvester',
  }));
  const payload = JSON.stringify({ sourceUrl: location.href, pageTitle: document.title, images }, null, 2);
  window.__harvesterPayload = payload;
  if (typeof copy === 'function') copy(payload);
  try { await navigator.clipboard.writeText(payload); } catch {}
  console.log('Harvested ' + images.length + ' master links. Paste from clipboard or inspect window.__harvesterPayload');
})();`;

export const INSTAGRAM_PROFILE_HARVESTER_SCRIPT = `(async () => {
  const pathParts = location.pathname.split('/').filter(Boolean);
  const username = pathParts[0] || '';
  if (!username) { console.error('Open an Instagram profile tab first (instagram.com/username/)'); return; }
  const csrfMatch = document.cookie.match(/(?:^|;\\s*)csrftoken=([^;]+)/);
  const headers = {
    'x-ig-app-id': '936619743392459',
    'x-requested-with': 'XMLHttpRequest',
    'x-asbd-id': '129477',
    ...(csrfMatch ? { 'x-csrftoken': decodeURIComponent(csrfMatch[1]) } : {}),
  };
  const pickBest = (cands) => {
    if (!Array.isArray(cands) || !cands.length) return null;
    return [...cands].sort((a, b) => (((b.width || b.config_width || 0) * (b.height || b.config_height || 0)) - ((a.width || a.config_width || 0) * (a.height || a.config_height || 0))))[0];
  };
  const safeJson = async (res) => {
    const t = (await res.text()).trim();
    if (!t || t.startsWith('<')) return null;
    try { return JSON.parse(t.startsWith('for (;;);') ? t.slice(9) : t); } catch { return null; }
  };
  const images = [];
  const seen = new Set();
  const add = (url, thumb, width, height, code, slide, alt) => {
    if (!url) return;
    const clean = url.replace(/&amp;/g, '&');
    let pathKey = clean;
    try { pathKey = new URL(clean).pathname; } catch {}
    if (seen.has(clean) || seen.has(pathKey)) return;
    seen.add(clean);
    seen.add(pathKey);
    images.push({
      id: 'ig_' + (images.length + 1),
      thumbnailUrl: thumb || clean,
      fullUrl: clean,
      linkedPageUrl: code ? 'https://www.instagram.com/p/' + code + '/' : location.href,
      width,
      height,
      altText: alt || (username + '_' + (code || images.length + 1)),
      filename: username + '_' + (code || images.length + 1) + (slide ? '_slide' + slide : '') + '.jpg',
      isUnshrunk: true,
      unshrinkMethod: slide ? 'Instagram Carousel Slide ' + slide + ' Master' : 'Instagram Profile Full-Res Master',
    });
  };
  let user = null;
  let userId = null;
  try {
    const profileRes = await fetch('/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username), { headers, credentials: 'include' });
    const profileJson = await safeJson(profileRes);
    user = profileJson?.data?.user || null;
    userId = user?.id || null;
  } catch {}
  const parseNode = (raw) => {
    const n = raw?.shortcode_media || raw?.media || raw;
    if (!n || typeof n !== 'object') return;
    const code = n.shortcode || n.code;
    const cap = n.edge_media_to_caption?.edges?.[0]?.node?.text || n.caption?.text || '';
    if (Array.isArray(n.carousel_media) && n.carousel_media.length) {
      n.carousel_media.forEach((s, i) => {
        const b = pickBest(s.image_versions2?.candidates);
        if (b) add(b.url, s.image_versions2?.candidates?.slice(-1)[0]?.url, s.original_width || b.width, s.original_height || b.height, code, i + 1, cap);
      });
    } else if (n.edge_sidecar_to_children?.edges?.length) {
      n.edge_sidecar_to_children.edges.forEach((se, i) => {
        const sn = se.node;
        const best = pickBest(sn?.display_resources);
        const u = sn?.display_url || best?.url;
        if (u) add(u, sn.thumbnail_src || u, sn.dimensions?.width || best?.width, sn.dimensions?.height || best?.height, code, i + 1, cap);
      });
    } else if (n.image_versions2?.candidates) {
      const b = pickBest(n.image_versions2.candidates);
      if (b) add(b.url, n.image_versions2.candidates.slice(-1)[0]?.url, n.original_width || b.width, n.original_height || b.height, code, 0, cap);
    } else if (n.display_url || n.display_resources?.length) {
      const best = pickBest(n.display_resources);
      const u = n.display_url || best?.url;
      if (u) add(u, n.thumbnail_src || u, n.dimensions?.width || best?.width, n.dimensions?.height || best?.height, code, 0, cap);
    }
  };
  if (user?.profile_pic_url_hd || user?.hd_profile_pic_url_info?.url) {
    add(user.hd_profile_pic_url_info?.url || user.profile_pic_url_hd, user.profile_pic_url, 1080, 1080, null, 0, '@' + username + ' Avatar');
  }
  (user?.edge_owner_to_timeline_media?.edges || []).forEach((e) => e.node && parseNode(e.node));
  if (images.length === 0) {
    document.querySelectorAll('script[type="application/json"]').forEach((sc) => {
      const t = sc.textContent || '';
      if (!t.includes('image_versions2') && !t.includes('edge_owner_to_timeline_media') && !t.includes('xdt_api__v1__feed__user_timeline_graphql_connection')) return;
      try {
        const walk = (o) => {
          if (!o || typeof o !== 'object') return;
          if (!userId && o.user?.id && o.user?.username === username) userId = String(o.user.id);
          if (Array.isArray(o.edges)) o.edges.forEach((e) => e?.node && parseNode(e.node));
          if (Array.isArray(o.items)) o.items.forEach(parseNode);
          for (const k of Object.keys(o)) if (typeof o[k] === 'object') walk(o[k]);
        };
        walk(JSON.parse(t));
      } catch {}
    });
  }
  let maxId = '';
  let more = Boolean(userId);
  let pages = 0;
  while (more && pages < 25) {
    pages++;
    const feedRes = await fetch('/api/v1/feed/user/' + userId + '/?count=33' + (maxId ? '&max_id=' + encodeURIComponent(maxId) : ''), { headers, credentials: 'include' });
    if (!feedRes.ok) break;
    const feedJson = await safeJson(feedRes);
    if (!feedJson) break;
    (feedJson.items || []).forEach(parseNode);
    more = Boolean(feedJson.more_available && feedJson.next_max_id);
    maxId = feedJson.next_max_id || '';
  }
  if (images.length === 0) {
    document.querySelectorAll('main img[src*="cdninstagram"], main img[src*="fbcdn"]').forEach((img) => {
      if (img.src.includes('rsrc.php')) return;
      const href = img.closest('a')?.getAttribute('href') || '';
      const code = (href.match(/\\/(?:p|reel)\\/([A-Za-z0-9_-]+)/) || [])[1];
      add(img.src, img.src, img.naturalWidth || undefined, img.naturalHeight || undefined, code, 0, img.alt);
    });
  }
  const payload = JSON.stringify({ sourceUrl: location.href, pageTitle: '@' + username + ' — Instagram Full-Res Profile', images }, null, 2);
  window.__igHarvesterPayload = payload;
  if (typeof copy === 'function') copy(payload);
  try { await navigator.clipboard.writeText(payload); } catch {}
  console.log('Harvested ' + images.length + ' full-res Instagram photos for @' + username + '. Paste JSON into the app.');
})();`;
