import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCaptionPrompt,
  buildBatchComparePrompt,
  buildOpenAiChatMessages,
  buildSidecarCaptionFilename,
  buildCaptionsCsv,
  buildCaptionsJson,
  buildCaptionsMarkdown,
  buildSidecarTextContent,
  chunkCaptionItems,
  parseCaptionModelOutput,
  stripDataUrlPrefix,
  stripModelThoughtBlocks,
  type CaptionedImageResult,
} from './gemmaCaptionLogic.ts';

test('stripModelThoughtBlocks removes Gemma thought/channel blocks cleanly', () => {
  const input =
    '<|channel>thought\nLet me inspect the lighting carefully.<channel|>A smiling traveler stands beside a mountain lake.';
  assert.equal(
    stripModelThoughtBlocks(input),
    'A smiling traveler stands beside a mountain lake.'
  );

  const xmlThought = '<thought>Thinking step</thought>\nTwo cyclists ride along an autumn trail.';
  assert.equal(stripModelThoughtBlocks(xmlThought), 'Two cyclists ride along an autumn trail.');
});

test('parseCaptionModelOutput extracts structured JSON fields and falls back gracefully', () => {
  const fenced = [
    '<thought>Evaluating composition</thought>',
    '```json',
    JSON.stringify({
      caption: 'Woman in a yellow raincoat holding a coffee cup.',
      detailedDescription:
        'A young woman wearing a bright yellow raincoat holds a ceramic mug on a misty balcony.',
      subjects: ['young woman', 'ceramic mug', 'young woman'],
      tags: ['raincoat', 'coffee', 'misty morning', 'portrait'],
      setting: 'misty outdoor balcony',
    }),
    '```',
  ].join('\n');

  const parsed = parseCaptionModelOutput(fenced, 'structured');
  assert.equal(parsed.caption, 'Woman in a yellow raincoat holding a coffee cup.');
  assert.match(parsed.detailedDescription, /ceramic mug/);
  assert.deepEqual(parsed.subjects, ['young woman', 'ceramic mug']);
  assert.deepEqual(parsed.tags, ['raincoat', 'coffee', 'misty morning', 'portrait']);
  assert.equal(parsed.setting, 'misty outdoor balcony');

  const malformed = parseCaptionModelOutput(
    'Two red kayaks rest on a pebble beach at sunset. Calm water reflects orange clouds.',
    'structured'
  );
  assert.equal(malformed.caption, 'Two red kayaks rest on a pebble beach at sunset.');
  assert.match(malformed.detailedDescription, /Calm water reflects/);
});

test('buildOpenAiChatMessages preserves multi-image attachments on current turn and prunes older images', () => {
  const messages = buildOpenAiChatMessages({
    systemPrompt: 'You are Gemma 4.',
    history: [
      {
        role: 'user',
        text: 'What is in old.jpg?',
        images: [{ id: '1', filename: 'old.jpg', dataUrl: 'data:image/jpeg;base64,OLD1' }],
      },
      { role: 'assistant', text: 'Old image shows a cat.' },
      {
        role: 'user',
        text: 'What about recent.jpg?',
        images: [{ id: '2', filename: 'recent.jpg', dataUrl: 'data:image/jpeg;base64,REC2' }],
      },
      { role: 'assistant', text: 'Recent image shows a dog.' },
    ],
    userText: 'Compare these two photos.',
    userImages: [
      { id: '3', filename: 'a.jpg', dataUrl: 'data:image/jpeg;base64,AAA' },
      { id: '4', filename: 'b.jpg', dataUrl: 'data:image/jpeg;base64,BBB' },
    ],
  });

  assert.equal(messages[0].role, 'system');
  // First prior turn had its image pruned to text hint
  assert.equal(typeof messages[1].content, 'string');
  assert.match(String(messages[1].content), /Previously attached 1 image\(s\): old\.jpg/);
  // Latest prior image turn retained image_url
  assert.ok(Array.isArray(messages[3].content));
  // Current turn contains both image attachments + user prompt
  const last = messages[messages.length - 1];
  assert.equal(last.role, 'user');
  assert.ok(Array.isArray(last.content));
  assert.equal(last.content.length, 3);
  assert.equal(last.content[0].image_url?.url, 'data:image/jpeg;base64,AAA');
  assert.equal(last.content[1].image_url?.url, 'data:image/jpeg;base64,BBB');
  assert.equal(last.content[2].text, 'Compare these two photos.');
});

test('caption prompts, data-url stripping, sidecar paths, and exporters format cleanly', () => {
  assert.match(buildCaptionPrompt('concise', 'note clothing'), /note clothing/);
  assert.match(buildBatchComparePrompt(['one.jpg', 'two.jpg']), /Image 1: one\.jpg, Image 2: two\.jpg/);
  assert.equal(stripDataUrlPrefix('data:image/png;base64,iVBOR'), 'iVBOR');
  assert.equal(buildSidecarCaptionFilename('portraits/day1/sample.01.jpg'), 'portraits/day1/sample.01.txt');
  assert.equal(chunkCaptionItems([1, 2, 3, 4, 5], 2).length, 3);

  const sampleResults: CaptionedImageResult[] = [
    {
      id: 'img_1',
      filename: 'a.jpg',
      relativePath: 'set/a.jpg',
      style: 'structured',
      caption: 'Portrait "A", outdoors',
      detailedDescription: 'A portrait taken outdoors in warm sun.',
      subjects: ['person'],
      tags: ['portrait', 'outdoor'],
      setting: 'park',
      durationMs: 412,
    },
  ];

  const csv = buildCaptionsCsv(sampleResults);
  assert.match(csv, /^filename,relative_path,style,caption,/);
  assert.match(csv, /"Portrait ""A"", outdoors"/);

  const json = JSON.parse(buildCaptionsJson(sampleResults, { model: 'Gemma 4 E2B', sourceLabel: './samples', style: 'structured' }));
  assert.equal(json.totalImages, 1);
  assert.equal(json.captionedCount, 1);

  const md = buildCaptionsMarkdown(sampleResults, { model: 'Gemma 4 E2B', sourceLabel: './samples' });
  assert.match(md, /## 1\. set\/a\.jpg/);
  assert.match(buildSidecarTextContent(sampleResults[0]), /Tags: portrait, outdoor/);
});
