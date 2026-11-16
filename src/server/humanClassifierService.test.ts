import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import JSZip from 'jszip';
import {
  buildClassifiedDiskZip,
  buildDiskImageThumbnail,
  mapGeminiError,
  writeClassifiedDiskFolders,
} from './humanClassifierService.ts';
import {
  HumanImageBiometricProfile,
  normalizeClusterAssignments,
} from '../utils/humanClassifierLogic.ts';

function sampleProfile(id: string, filename: string, shape: string): HumanImageBiometricProfile {
  return {
    imageId: id,
    filename,
    hasHuman: true,
    faceCount: 1,
    visibility: 'upper_body',
    apparentPresentation: 'adult',
    estimatedAgeRange: '25-35',
    facialStructure: {
      faceShape: shape,
      jawline: 'angular',
      cheekbones: 'high_prominent',
      foreheadHeight: 'medium',
      browAndEyes: 'straight brows',
      noseStructure: 'straight bridge',
      facialHairOrMarks: 'none',
    },
    bodyProportions: {
      somatotype: 'mesomorph',
      shoulderToHipRatio: 'broad_tapered',
      statureAndLimbRatio: 'medium_proportioned',
      buildSummary: 'Balanced athletic frame',
    },
    biometricSignature: `${shape} face, mesomorph frame`,
    confidence: 0.9,
  };
}

test('mapGeminiError classifies auth, quota, and 404 errors clearly', () => {
  const err403 = mapGeminiError(new Error('PERMISSION_DENIED: invalid key'));
  assert.equal(err403.status, 403);
  assert.match(err403.message, /Settings > Secrets/i);

  const err429 = mapGeminiError(new Error('RESOURCE_EXHAUSTED: 429 quota exceeded'));
  assert.equal(err429.status, 429);

  const err404 = mapGeminiError(new Error('404 NOT_FOUND'));
  assert.equal(err404.status, 404);
});

test('writeClassifiedDiskFolders and buildClassifiedDiskZip organize each human into separate folders cleanly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullres-humans-'));
  const srcDir = path.join(tmpDir, 'source');
  const outDir = path.join(tmpDir, 'output');
  fs.mkdirSync(srcDir, { recursive: true });

  try {
    const imgABuf = await sharp({
      create: { width: 120, height: 160, channels: 3, background: { r: 40, g: 80, b: 140 } },
    })
      .jpeg()
      .toBuffer();
    const imgBBuf = await sharp({
      create: { width: 120, height: 160, channels: 3, background: { r: 160, g: 70, b: 50 } },
    })
      .jpeg()
      .toBuffer();

    fs.writeFileSync(path.join(srcDir, 'photo_a1.jpg'), imgABuf);
    fs.writeFileSync(path.join(srcDir, 'photo_a2.jpg'), imgABuf);
    fs.writeFileSync(path.join(srcDir, 'photo_b1.jpg'), imgBBuf);

    const thumb = await buildDiskImageThumbnail(path.join(srcDir, 'photo_a1.jpg'));
    assert.equal(thumb.mimeType, 'image/jpeg');
    assert.ok(thumb.base64Data.length > 50);

    const p1 = sampleProfile('id_a1', 'photo_a1.jpg', 'square');
    const p2 = sampleProfile('id_a2', 'photo_a2.jpg', 'square');
    const p3 = sampleProfile('id_b1', 'photo_b1.jpg', 'oval');
    const clusters = normalizeClusterAssignments(
      [p1, p2, p3],
      [
        { imageIds: ['id_a1', 'id_a2'], dominantFaceShape: 'square', dominantSomatotype: 'mesomorph' },
        { imageIds: ['id_b1'], dominantFaceShape: 'oval', dominantSomatotype: 'ectomorph' },
      ],
      'indexed'
    );

    const imageRelativePaths = {
      id_a1: 'photo_a1.jpg',
      id_a2: 'photo_a2.jpg',
      id_b1: 'photo_b1.jpg',
    };

    const writeRes = await writeClassifiedDiskFolders({
      sourceDir: srcDir,
      outputDir: outDir,
      clusters,
      profiles: [p1, p2, p3],
      imageRelativePaths,
    });

    assert.equal(writeRes.writtenFilesCount, 3);
    assert.equal(fs.existsSync(path.join(outDir, 'person_01', 'photo_a1.jpg')), true);
    assert.equal(fs.existsSync(path.join(outDir, 'person_01', 'photo_a2.jpg')), true);
    assert.equal(fs.existsSync(path.join(outDir, 'person_02', 'photo_b1.jpg')), true);
    assert.equal(fs.existsSync(path.join(outDir, 'classification_manifest.json')), true);

    const zipBuf = await buildClassifiedDiskZip({
      sourceDir: srcDir,
      clusters,
      profiles: [p1, p2, p3],
      imageRelativePaths,
    });
    const loadedZip = await JSZip.loadAsync(zipBuf);
    assert.ok(loadedZip.file('person_01/photo_a1.jpg'));
    assert.ok(loadedZip.file('person_01/photo_a2.jpg'));
    assert.ok(loadedZip.file('person_02/photo_b1.jpg'));
    assert.ok(loadedZip.file('classification_manifest.json'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
