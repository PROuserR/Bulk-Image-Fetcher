import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  captionSingleImageWithGemma,
  normalizeBufferToJpegDataUrl,
  runGemmaChatTurn,
  type CompletionOptions,
} from './gemmaChatService.ts';

async function makeTinyTestImageDataUrl(): Promise<string> {
  const png = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: { r: 24, g: 110, b: 220 },
    },
  })
    .png()
    .toBuffer();
  return normalizeBufferToJpegDataUrl(png, 640);
}

test('runGemmaChatTurn attaches multiple images and streams clean assistant reply', async () => {
  const sampleUrl = await makeTinyTestImageDataUrl();
  let capturedOpts: CompletionOptions | null = null;

  const result = await runGemmaChatTurn(
    {
      history: [{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Hello!' }],
      userText: 'Describe both attached swatches.',
      userImages: [
        { id: '1', filename: 'swatch1.jpg', dataUrl: sampleUrl },
        { id: '2', filename: 'swatch2.jpg', dataUrl: sampleUrl },
      ],
    },
    async (opts) => {
      capturedOpts = opts;
      opts.onDelta?.('Blue ');
      opts.onDelta?.('swatch.');
      return '<|channel>thought\nchecking pixels<channel|>Blue swatch.';
    }
  );

  assert.ok(capturedOpts);
  const lastMsg = capturedOpts!.messages[capturedOpts!.messages.length - 1];
  assert.equal(lastMsg.role, 'user');
  assert.ok(Array.isArray(lastMsg.content));
  assert.equal(lastMsg.content.length, 3);
  assert.equal(result.reply, 'Blue swatch.');
});

test('captionSingleImageWithGemma parses structured output and isolates failures safely', async () => {
  const sampleUrl = await makeTinyTestImageDataUrl();

  let captionRunnerOpts: CompletionOptions | null = null;
  const okItem = await captionSingleImageWithGemma(
    {
      id: 'c1',
      filename: 'blue.jpg',
      relativePath: 'folder/blue.jpg',
      dataUrl: sampleUrl,
      style: 'structured',
    },
    async (opts) => {
      captionRunnerOpts = opts;
      return JSON.stringify({
        caption: 'Solid azure background swatch.',
        detailedDescription: 'A uniform vivid blue square graphic.',
        subjects: ['blue swatch'],
        tags: ['blue', 'solid', 'minimal'],
        setting: 'digital canvas',
      });
    }
  );

  assert.equal(captionRunnerOpts?.enableThinking, false);
  assert.equal(okItem.error, undefined);
  assert.equal(okItem.caption, 'Solid azure background swatch.');
  assert.deepEqual(okItem.tags, ['blue', 'solid', 'minimal']);
  assert.equal(okItem.setting, 'digital canvas');

  const failedItem = await captionSingleImageWithGemma(
    {
      id: 'c2',
      filename: 'broken.jpg',
      relativePath: 'folder/broken.jpg',
      dataUrl: sampleUrl,
      style: 'concise',
    },
    async () => {
      throw new Error('Synthetic runner error');
    }
  );

  assert.equal(failedItem.error, 'Synthetic runner error');
  assert.equal(failedItem.caption, '');
});
