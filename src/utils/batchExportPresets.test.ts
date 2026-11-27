import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATCH_EXPORT_PRESETS_EVENT,
  DEFAULT_EXPORT_PRESETS,
  deleteBatchExportPreset,
  exportPresetToOutputConfig,
  formatPresetSummary,
  getActiveExportPreset,
  loadBatchExportPresets,
  previewPresetFilename,
  sanitizeBatchExportPreset,
  setActiveExportPresetId,
  upsertBatchExportPreset,
} from './batchExportPresets';

function withMockBrowserStorage(fn: (events: string[]) => void): void {
  const prevWindow = (globalThis as any).window;
  const prevCustomEvent = (globalThis as any).CustomEvent;
  const store = new Map<string, string>();
  const events: string[] = [];
  try {
    (globalThis as any).CustomEvent = class MockCustomEvent {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
    (globalThis as any).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
      dispatchEvent: (ev: { type: string }) => {
        events.push(ev.type);
        return true;
      },
    };
    fn(events);
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = prevWindow;
    }
    if (prevCustomEvent === undefined) {
      delete (globalThis as any).CustomEvent;
    } else {
      (globalThis as any).CustomEvent = prevCustomEvent;
    }
  }
}

test('sanitizeBatchExportPreset clamps quality, resize dimensions, and naming template safely', () => {
  const clean = sanitizeBatchExportPreset({
    name: '  ',
    outputFormat: 'webp',
    quality: 140,
    archiveFormat: 'zip',
    resize: {
      mode: 'exact',
      width: 99999,
      height: 0,
      maxEdge: 12,
      percent: 800,
      lockAspect: false,
      fit: 'cover',
    },
    namingTemplate: '   ',
  });

  assert.equal(clean.name, 'Untitled Preset');
  assert.equal(clean.quality, 100);
  assert.equal(clean.resize.width, 12000);
  assert.equal(clean.resize.height, 1080);
  assert.equal(clean.resize.maxEdge, 32);
  assert.equal(clean.resize.percent, 400);
  assert.equal(clean.namingTemplate, '{name}');
});

test('upsert, activate, delete, and event dispatch manage Batch Export Presets cleanly', () => {
  withMockBrowserStorage((events) => {
    const initial = loadBatchExportPresets();
    assert.equal(initial.length, DEFAULT_EXPORT_PRESETS.length);
    assert.equal(getActiveExportPreset(), null);

    const { presets, saved } = upsertBatchExportPreset(
      {
        name: 'Client Delivery 2K',
        outputFormat: 'jpeg',
        quality: 88,
        archiveFormat: '7z',
        resize: {
          mode: 'maxEdge',
          width: 2048,
          height: 2048,
          maxEdge: 2048,
          percent: 100,
          lockAspect: true,
          fit: 'contain',
        },
        namingTemplate: '{index3}_{name}_{w}x{h}',
        preserveSubfolders: true,
      },
      true
    );

    assert.equal(presets.length, DEFAULT_EXPORT_PRESETS.length + 1);
    assert.equal(getActiveExportPreset()?.id, saved.id);
    assert.equal(events.filter((e) => e === BATCH_EXPORT_PRESETS_EVENT).length, 1);

    const outCfg = exportPresetToOutputConfig(saved);
    assert.equal(outCfg.format, 'jpeg');
    assert.equal(outCfg.quality, 88);
    assert.equal(outCfg.namingTemplate, '{index3}_{name}_{w}x{h}');

    const activated = setActiveExportPresetId('preset-web-webp-1600');
    assert.equal(activated?.id, 'preset-web-webp-1600');
    assert.equal(getActiveExportPreset()?.id, 'preset-web-webp-1600');

    const afterDelete = deleteBatchExportPreset(saved.id);
    assert.equal(afterDelete.presets.length, DEFAULT_EXPORT_PRESETS.length);
    assert.equal(afterDelete.activePreset?.id, 'preset-web-webp-1600');

    const cleared = setActiveExportPresetId(null);
    assert.equal(cleared, null);
    assert.equal(getActiveExportPreset(), null);
  });
});

test('formatPresetSummary and previewPresetFilename render accurate summaries and previews', () => {
  const preset = DEFAULT_EXPORT_PRESETS[1]; // Web Gallery WebP 1600px
  assert.equal(formatPresetSummary(preset), 'WEBP 86% · Max 1600px · .ZIP');
  assert.equal(previewPresetFilename(preset, 'album/DSC_0412.JPG'), '001_DSC_0412_1600x1067.webp');
});
