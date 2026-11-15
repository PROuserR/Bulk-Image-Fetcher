import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInstagramProfileUrl,
  formatInstagramCookieHeader,
  parseInstagramSessionCookies,
  extractInstagramTokensFromHtml,
  extractContextJsonPayloads,
  extractInstagramMediaFromJson,
  extractInstagramMediaFromHtml,
} from './instagramExtractor';
import { parsePreviewUrlsOrManifest } from './htmlExtractor';

test('parseInstagramProfileUrl parses valid profile URLs and handles while rejecting posts and non-profile routes', () => {
  assert.deepEqual(parseInstagramProfileUrl('https://www.instagram.com/natgeo/'), {
    username: 'natgeo',
    profileUrl: 'https://www.instagram.com/natgeo/',
  });

  assert.deepEqual(parseInstagramProfileUrl('instagram.com/nasa_webb?hl=en'), {
    username: 'nasa_webb',
    profileUrl: 'https://www.instagram.com/nasa_webb/',
  });

  assert.deepEqual(parseInstagramProfileUrl('@travel.photographer'), {
    username: 'travel.photographer',
    profileUrl: 'https://www.instagram.com/travel.photographer/',
  });

  // Post, reel, explore, login pages must return null
  assert.equal(parseInstagramProfileUrl('https://www.instagram.com/p/C9xYz123/'), null);
  assert.equal(parseInstagramProfileUrl('https://www.instagram.com/reel/AbCdEf/'), null);
  assert.equal(parseInstagramProfileUrl('https://www.instagram.com/accounts/login/'), null);
  assert.equal(parseInstagramProfileUrl('https://example.com/natgeo/'), null);
});

test('formatInstagramCookieHeader formats raw sessionid tokens and full cookie strings', () => {
  assert.equal(formatInstagramCookieHeader(undefined), undefined);
  assert.equal(formatInstagramCookieHeader('   '), undefined);
  assert.equal(formatInstagramCookieHeader('123456%3Aabc%3A1'), 'sessionid=123456%3Aabc%3A1');
  assert.equal(
    formatInstagramCookieHeader('csrftoken=xyz; sessionid=123456'),
    'csrftoken=xyz; sessionid=123456'
  );
});

test('extractInstagramMediaFromJson extracts single posts, carousels, HD avatar, and pagination cursor from GraphQL payload', () => {
  const graphqlPayload = {
    data: {
      user: {
        id: '787132',
        username: 'natgeo',
        full_name: 'National Geographic',
        profile_pic_url: 'https://scontent.cdninstagram.com/avatar_150.jpg',
        profile_pic_url_hd: 'https://scontent.cdninstagram.com/avatar_hd_1080.jpg',
        edge_owner_to_timeline_media: {
          page_info: { has_next_page: true, end_cursor: 'CURSOR_NEXT_1' },
          edges: [
            {
              node: {
                id: '1001',
                shortcode: 'C_SINGLE_1',
                display_url: 'https://scontent.cdninstagram.com/v/post1_full.jpg',
                thumbnail_src: 'https://scontent.cdninstagram.com/v/post1_thumb.jpg',
                dimensions: { width: 1440, height: 1800 },
                edge_media_to_caption: { edges: [{ node: { text: 'Alpine sunrise' } }] },
              },
            },
            {
              node: {
                id: '1002',
                shortcode: 'C_CAROUSEL_2',
                edge_media_to_caption: { edges: [{ node: { text: 'Glacier series' } }] },
                edge_sidecar_to_children: {
                  edges: [
                    {
                      node: {
                        id: '1002_a',
                        display_url: 'https://scontent.cdninstagram.com/v/slide1_full.jpg',
                        thumbnail_src: 'https://scontent.cdninstagram.com/v/slide1_thumb.jpg',
                        dimensions: { width: 2160, height: 2700 },
                      },
                    },
                    {
                      node: {
                        id: '1002_b',
                        display_url: 'https://scontent.cdninstagram.com/v/slide2_full.jpg',
                        thumbnail_src: 'https://scontent.cdninstagram.com/v/slide2_thumb.jpg',
                        dimensions: { width: 2160, height: 2700 },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  };

  const res = extractInstagramMediaFromJson(graphqlPayload);
  assert.equal(res.userId, '787132');
  assert.equal(res.username, 'natgeo');
  assert.equal(res.fullName, 'National Geographic');
  assert.equal(res.hasNextPage, true);
  assert.equal(res.endCursor, 'CURSOR_NEXT_1');
  assert.equal(res.images.length, 4); // HD avatar + 1 single + 2 carousel slides

  assert.equal(res.images[0].fullUrl, 'https://scontent.cdninstagram.com/avatar_hd_1080.jpg');
  assert.equal(res.images[1].linkedPageUrl, 'https://www.instagram.com/p/C_SINGLE_1/');
  assert.equal(res.images[1].resolutionTier, 'medium');
  assert.equal(res.images[2].resolutionTier, 'hd');
  assert.equal(res.images[2].filename, 'natgeo_C_CAROUSEL_2_slide1.jpg');
  assert.equal(res.images[3].filename, 'natgeo_C_CAROUSEL_2_slide2.jpg');
});

test('extractInstagramMediaFromJson picks largest image_versions2 candidate from REST v1 feed items', () => {
  const v1Feed = {
    more_available: true,
    next_max_id: 'MAX_ID_999',
    items: [
      {
        pk: '555',
        code: 'V1_POST_A',
        media_type: 1,
        original_width: 3000,
        original_height: 2000,
        user: { pk: 787132, username: 'natgeo', full_name: 'National Geographic' },
        image_versions2: {
          candidates: [
            { url: 'https://scontent.cdninstagram.com/small_320.jpg', width: 320, height: 213 },
            { url: 'https://scontent.cdninstagram.com/master_3000.jpg', width: 3000, height: 2000 },
            { url: 'https://scontent.cdninstagram.com/med_640.jpg', width: 640, height: 427 },
          ],
        },
      },
    ],
  };

  const res = extractInstagramMediaFromJson(v1Feed);
  assert.equal(res.hasNextPage, true);
  assert.equal(res.nextMaxId, 'MAX_ID_999');
  assert.equal(res.images.length, 1);
  assert.equal(res.images[0].fullUrl, 'https://scontent.cdninstagram.com/master_3000.jpg');
  assert.equal(res.images[0].thumbnailUrl, 'https://scontent.cdninstagram.com/small_320.jpg');
  assert.equal(res.images[0].resolutionTier, 'hd');
  assert.equal(res.images[0].aspectRatio, '3:2');
});

test('extractInstagramMediaFromHtml & parsePreviewUrlsOrManifest extract embedded SSR profile JSON and raw API JSON', () => {
  const ssrPayload = {
    require: [
      [
        'RelayPrefetched',
        [],
        [
          {
            xdt_api__v1__feed__user_timeline_graphql_connection: {
              page_info: { has_next_page: false },
              edges: [
                {
                  node: {
                    pk: '999',
                    code: 'SSR_POST_1',
                    original_width: 1920,
                    original_height: 1280,
                    user: { username: 'nasa' },
                    image_versions2: {
                      candidates: [
                        { url: 'https://scontent.cdninstagram.com/nasa_full.jpg', width: 1920, height: 1280 },
                        { url: 'https://scontent.cdninstagram.com/nasa_sm.jpg', width: 320, height: 213 },
                      ],
                    },
                  },
                },
              ],
            },
          },
        ],
      ],
    ],
  };

  const html = `<!doctype html><html><body><script type="application/json">${JSON.stringify(ssrPayload)}</script></body></html>`;
  const fromHtml = extractInstagramMediaFromHtml(html, 'https://www.instagram.com/nasa/', 'nasa');
  assert.equal(fromHtml.images.length, 1);
  assert.equal(fromHtml.images[0].fullUrl, 'https://scontent.cdninstagram.com/nasa_full.jpg');
  assert.equal(fromHtml.images[0].linkedPageUrl, 'https://www.instagram.com/p/SSR_POST_1/');

  const apiJsonText = JSON.stringify({
    data: {
      user: {
        id: '123',
        username: 'nasa',
        edge_owner_to_timeline_media: {
          page_info: { has_next_page: false },
          edges: [
            {
              node: {
                id: '88',
                shortcode: 'RAW_API_1',
                display_url: 'https://scontent.cdninstagram.com/raw_api_master.jpg',
                dimensions: { width: 2048, height: 2048 },
              },
            },
          ],
        },
      },
    },
  });
  const parsedManifest = parsePreviewUrlsOrManifest(apiJsonText);
  assert.ok(parsedManifest !== null);
  assert.equal(parsedManifest?.images[0].fullUrl, 'https://scontent.cdninstagram.com/raw_api_master.jpg');
});

test('parseInstagramSessionCookies and extractInstagramTokensFromHtml extract CSRF, sessionid, LSD, and owner_id', () => {
  const parsedFull = parseInstagramSessionCookies('Cookie: csrftoken=csrf_999; sessionid=sess_123; ds_user_id=777');
  assert.equal(parsedFull.csrfToken, 'csrf_999');
  assert.equal(parsedFull.sessionId, 'sess_123');
  assert.equal(parsedFull.hasSessionId, true);
  assert.equal(parsedFull.header, 'csrftoken=csrf_999; sessionid=sess_123; ds_user_id=777');

  const html = `<script>requireLazy(["ServerJS"],function(){s.handle({"define":[["LSD",[],{"token":"LSD_TOK_1"}],["DTSGInitialData",[],{"token":"DTSG_2"}]],"owner_id":"528817151"});});</script>`;
  const tokens = extractInstagramTokensFromHtml(html);
  assert.equal(tokens.lsd, 'LSD_TOK_1');
  assert.equal(tokens.fbDtsg, 'DTSG_2');
  assert.equal(tokens.userId, '528817151');
});

test('extractInstagramMediaFromHtml parses ServerJS embed contextJSON profile & GraphSidecar posts and post gql_data slides', () => {
  const profileEmbedObj = {
    context: {
      username: 'nasa',
      full_name: 'NASA',
      owner_id: '528817151',
      posts_count: 5010,
      profile_pic_url: 'https://scontent-lhr11-1.cdninstagram.com/v/t51.2885-19/avatar_150.jpg?stp=dst-jpg_s150x150_tt6',
      graphql_media: [
        {
          shortcode_media: {
            __typename: 'GraphImage',
            id: '101',
            shortcode: 'IMG_ONE',
            dimensions: { width: 1080, height: 1080 },
            display_url: 'https://scontent-lhr11-1.cdninstagram.com/v/t51.82787-15/nasa_post_1.jpg?stp=dst-jpg_e35_tt6',
            edge_media_to_caption: { edges: [{ node: { text: 'Deep space nebula' } }] },
          },
        },
        {
          shortcode_media: {
            __typename: 'GraphSidecar',
            id: '102',
            shortcode: 'CAROUSEL_TWO',
            dimensions: { width: 1080, height: 1077 },
            display_url: 'https://scontent-lhr11-1.cdninstagram.com/v/t51.82787-15/carousel_s1.jpg?stp=dst-jpg_e35_tt6',
            edge_media_to_caption: { edges: [{ node: { text: 'Rocket launch' } }] },
          },
        },
      ],
    },
  };

  const escapedProfileEmbed = JSON.stringify(JSON.stringify(profileEmbedObj));
  const profileEmbedHtml = `<script>s.handle({"contextJSON":${escapedProfileEmbed}});</script>`;

  assert.equal(extractContextJsonPayloads(profileEmbedHtml).length, 1);
  const extracted = extractInstagramMediaFromHtml(
    profileEmbedHtml,
    'https://www.instagram.com/nasa/embed/',
    'nasa'
  );
  assert.equal(extracted.username, 'nasa');
  assert.equal(extracted.userId, '528817151');
  assert.equal(extracted.postsCount, 5010);
  assert.deepEqual(extracted.shortcodesToEnrich, ['CAROUSEL_TWO']);
  assert.equal(extracted.images.length, 3); // avatar + 2 posts
  assert.equal(extracted.images[0].isUnshrunk, false); // s150x150 avatar marked as thumbnail
  assert.equal(extracted.images[1].filename, 'nasa_IMG_ONE.jpg');

  const postEmbedObj = {
    context: { type: 'GraphSidecar', shortcode: 'CAROUSEL_TWO' },
    gql_data: {
      shortcode_media: {
        __typename: 'GraphSidecar',
        shortcode: 'CAROUSEL_TWO',
        edge_sidecar_to_children: {
          edges: [
            {
              node: {
                id: 's1',
                display_url: 'https://scontent-lhr11-1.cdninstagram.com/v/t51.82787-15/carousel_s1.jpg?oh=new',
                dimensions: { width: 1080, height: 1077 },
              },
            },
            {
              node: {
                id: 's2',
                display_url: 'https://scontent-lhr11-1.cdninstagram.com/v/t51.82787-15/carousel_s2.jpg?oh=new',
                dimensions: { width: 1080, height: 1350 },
              },
            },
          ],
        },
      },
    },
  };
  const postEmbedHtml = `<script>s.handle({"contextJSON":${JSON.stringify(JSON.stringify(postEmbedObj))}});</script>`;
  const postPage = extractInstagramMediaFromHtml(postEmbedHtml, 'https://www.instagram.com/p/CAROUSEL_TWO/embed/', 'nasa');
  assert.equal(postPage.images.length, 2);
  assert.equal(postPage.images[0].filename, 'nasa_CAROUSEL_TWO_slide1.jpg');
  assert.equal(postPage.images[1].filename, 'nasa_CAROUSEL_TWO_slide2.jpg');
});

test('extractInstagramMediaFromJson handles Polaris clips connection payloads', () => {
  const clipsPayload = {
    data: {
      xdt_api__v1__clips__user_connection_v2: {
        page_info: { has_next_page: true, end_cursor: 'CLIPS_CURSOR_2' },
        edges: [
          {
            node: {
              media: {
                pk: '888',
                code: 'REEL_CLIP_1',
                media_type: 2,
                original_width: 1080,
                original_height: 1920,
                user: { pk: 528817151, username: 'nasa' },
                image_versions2: {
                  candidates: [
                    { url: 'https://scontent.cdninstagram.com/reel_cover_1080.jpg', width: 1080, height: 1920 },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };

  const res = extractInstagramMediaFromJson(clipsPayload);
  assert.equal(res.userId, '528817151');
  assert.equal(res.hasNextPage, true);
  assert.equal(res.endCursor, 'CLIPS_CURSOR_2');
  assert.equal(res.images.length, 1);
  assert.equal(res.images[0].filename, 'nasa_REEL_CLIP_1.jpg');
});

import { parseInstagramUpstreamJsonPayloads } from './instagramExtractor';

test('parseInstagramSessionCookies strips quotes and extracts numeric ds_user_id from raw sessionid', () => {
  const parsed = parseInstagramSessionCookies('  "528817151%3AAbcDef%3A29%3AAYf123"  ');
  assert.equal(parsed.hasSessionId, true);
  assert.equal(parsed.sessionId, '528817151%3AAbcDef%3A29%3AAYf123');
  assert.equal(parsed.dsUserId, '528817151');
  assert.equal(parsed.header, 'sessionid=528817151%3AAbcDef%3A29%3AAYf123');
});

test('parseInstagramUpstreamJsonPayloads parses multi-line Polaris NDJSON chunks with __bbox payloads', () => {
  const chunk1 = JSON.stringify({
    data: { viewer: { id: '528817151' } },
  });
  const chunk2 = JSON.stringify({
    label: 'PolarisProfilePostsQuery$stream',
    __bbox: {
      result: {
        data: {
          xdt_api__v1__profile_timeline__user_timeline_graphql_connection: {
            page_info: { has_next_page: true, end_cursor: 'NDJSON_CUR_1' },
            edges: [
              {
                node: {
                  pk: '7001',
                  code: 'POLARIS_1',
                  original_width: 1440,
                  original_height: 1800,
                  user: { pk: 528817151, username: 'nasa' },
                  image_versions2: {
                    candidates: [
                      { url: 'https://scontent.cdninstagram.com/polaris_1.jpg', width: 1440, height: 1800 },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    },
  });

  const ndjsonBody = `for (;;);${chunk1}\n${chunk2}\n`;
  const { payloads, isHtmlLogin } = parseInstagramUpstreamJsonPayloads(ndjsonBody);
  assert.equal(isHtmlLogin, false);
  assert.ok(payloads.length >= 2);

  const extracted = payloads
    .map((p) => extractInstagramMediaFromJson(p, 'nasa'))
    .find((page) => page.images.length > 0);

  assert.ok(extracted);
  assert.equal(extracted?.hasNextPage, true);
  assert.equal(extracted?.endCursor, 'NDJSON_CUR_1');
  assert.equal(extracted?.images[0].fullUrl, 'https://scontent.cdninstagram.com/polaris_1.jpg');
});


