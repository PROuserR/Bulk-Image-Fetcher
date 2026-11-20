import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import JSZip from 'jszip';
import {
  analyzeHumanImageBatch,
  buildClassifiedDiskZip,
  buildDiskImageThumbnail,
  clusterHumanProfilesOffline,
  mapClassifierError,
  OfflineClassifierError,
  OfflineRunnerLike,
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

test('mapClassifierError classifies missing runtime/model and timeout errors clearly', () => {
  const errMissing = mapClassifierError(new Error('Offline InsightFace models missing'));
  assert.equal(errMissing.status, 500);
  assert.match(errMissing.message, /Offline Python AI runtime or model missing/i);

  const errTimeout = mapClassifierError(new Error('Worker timed out after 180s'));
  assert.equal(errTimeout.status, 504);

  const passthrough = new OfflineClassifierError('Custom error', 400);
  assert.equal(mapClassifierError(passthrough), passthrough);
});

test('analyzeHumanImageBatch & clusterHumanProfilesOffline work cleanly with offline runner interface', async () => {
  const mockWorker: OfflineRunnerLike = {
    runCommand: async (cmd) => {
      if (cmd === 'analyze-batch') {
        return {
          profiles: [
            sampleProfile('img_1', 'a1.jpg', 'oval'),
            sampleProfile('img_2', 'a2.jpg', 'oval'),
          ],
        } as any;
      }
      return {
        clusters: [
          {
            displayName: 'Person (oval, mesomorph)',
            dominantFaceShape: 'oval',
            dominantSomatotype: 'mesomorph',
            matchRationale: 'Matched offline via ArcFace embedding',
            confidence: 0.95,
            imageIds: ['img_1', 'img_2'],
          },
        ],
      } as any;
    },
  };

  const profs = await analyzeHumanImageBatch(
    [
      { imageId: 'img_1', filename: 'a1.jpg', mimeType: 'image/jpeg', base64Data: 'AAAA' },
      { imageId: 'img_2', filename: 'a2.jpg', mimeType: 'image/jpeg', base64Data: 'AAAA' },
    ],
    mockWorker
  );
  assert.equal(profs.length, 2);
  assert.equal(profs[0].facialStructure.faceShape, 'oval');

  const clustered = await clusterHumanProfilesOffline(profs, 'indexed', mockWorker);
  assert.equal(clustered.clusters.length, 1);
  assert.equal(clustered.clusters[0].folderName, 'person_01');
  assert.equal(clustered.manifest.uniqueHumansCount, 1);
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
