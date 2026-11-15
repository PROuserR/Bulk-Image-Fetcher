import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSafeApiResponse } from './safeFetchJson.ts';

test('parseSafeApiResponse parses valid JSON payloads cleanly', () => {
  const res = parseSafeApiResponse('{"url":"https://instagram.com/natgeo/","images":[]}', 200, true);
  assert.equal(res.ok, true);
  assert.deepEqual(res.data, { url: 'https://instagram.com/natgeo/', images: [] });
});

test('parseSafeApiResponse handles Cloud Run / nginx HTML 504 timeout without throwing', () => {
  const html = '<html><head><title>504 Gateway Time-out</title></head><body><h1>504 Gateway Time-out</h1></body></html>';
  const res = parseSafeApiResponse(html, 504, false, 'Gateway Time-out');
  assert.equal(res.ok, false);
  assert.equal(res.data, null);
  assert.match(res.error || '', /HTTP 504/i);
  assert.match(res.error || '', /1-Click IG Profile Harvester/i);
});

test('parseSafeApiResponse handles generic HTML 200 fallback pages gracefully', () => {
  const html = '<html><head><title>App Loading</title></head><body><div id="root"></div></body></html>';
  const res = parseSafeApiResponse(html, 200, true);
  assert.equal(res.ok, false);
  assert.equal(res.data, null);
  assert.match(res.error || '', /HTML response instead of JSON/i);
  assert.match(res.error || '', /App Loading/);
});

test('parseSafeApiResponse strips XSSI prefix for(;;); before JSON.parse', () => {
  const res = parseSafeApiResponse('for (;;);{"require_login":true}', 403, false);
  assert.equal(res.ok, false);
  assert.deepEqual(res.data, { require_login: true });
});
