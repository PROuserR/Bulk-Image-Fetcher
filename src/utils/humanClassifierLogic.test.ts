import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClassificationManifest,
  chunkItemsForAnalysis,
  HumanImageBiometricProfile,
  mergeClusters,
  moveImageBetweenClusters,
  normalizeClusterAssignments,
  renameClusterFolder,
  resolveUniqueFilenames,
  sanitizeFolderName,
} from './humanClassifierLogic';

function makeProfile(
  id: string,
  filename: string,
  opts?: Partial<HumanImageBiometricProfile>
): HumanImageBiometricProfile {
  return {
    imageId: id,
    filename,
    hasHuman: true,
    faceCount: 1,
    visibility: 'upper_body',
    apparentPresentation: 'adult male',
    estimatedAgeRange: '25-32',
    facialStructure: {
      faceShape: 'square',
      jawline: 'angular',
      cheekbones: 'high_prominent',
      foreheadHeight: 'medium',
      browAndEyes: 'straight thick brows',
      noseStructure: 'straight bridge',
      facialHairOrMarks: 'clean-shaven',
    },
    bodyProportions: {
      somatotype: 'mesomorph',
      shoulderToHipRatio: 'broad_tapered',
      statureAndLimbRatio: 'medium_proportioned',
      buildSummary: 'Broad shoulders with athletic torso',
    },
    biometricSignature: 'Square angular jaw, high cheekbones, broad-shouldered mesomorph',
    confidence: 0.92,
    ...opts,
  };
}

test('chunkItemsForAnalysis splits 100 images cleanly into fixed-size batches', () => {
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
  const batches = chunkItemsForAnalysis(hundred, 5);
  assert.equal(batches.length, 20);
  assert.equal(batches[0].length, 5);
  assert.equal(batches[19][4], 100);
});

test('sanitizeFolderName removes path traversal and unsafe characters', () => {
  assert.equal(sanitizeFolderName('../etc/passwd'), 'etc_passwd');
  assert.equal(sanitizeFolderName('Person 01 / Studio!'), 'Person_01_Studio');
  assert.equal(sanitizeFolderName('...'), 'person_01');
});

test('normalizeClusterAssignments places every unique human in a distinct folder and isolates non-humans', () => {
  const profiles = [
    makeProfile('img1', 'a.jpg'),
    makeProfile('img2', 'b.jpg'),
    makeProfile('img3', 'c.jpg', {
      facialStructure: {
        faceShape: 'oval',
        jawline: 'tapered',
        cheekbones: 'balanced',
        foreheadHeight: 'high',
        browAndEyes: 'arched brows',
        noseStructure: 'narrow',
        facialHairOrMarks: 'none',
      },
      bodyProportions: {
        somatotype: 'ectomorph',
        shoulderToHipRatio: 'narrow_shoulder',
        statureAndLimbRatio: 'tall_long_limbed',
        buildSummary: 'Slender long-limbed ectomorph',
      },
    }),
    makeProfile('img4', 'd.jpg'), // omitted by AI raw output intentionally to verify fallback assignment
    makeProfile('img5', 'landscape.jpg', { hasHuman: false, faceCount: 0, visibility: 'no_human' }),
  ];

  const clusters = normalizeClusterAssignments(
    profiles,
    [
      { imageIds: ['img1', 'img2', 'img5'], dominantFaceShape: 'square', dominantSomatotype: 'mesomorph' },
      { imageIds: ['img3', 'img1'], dominantFaceShape: 'oval', dominantSomatotype: 'ectomorph' }, // img1 duplicated
    ],
    'indexed'
  );

  // Expect 3 human clusters (person_01 -> img1+img2, person_02 -> img3, person_03 -> img4 fallback) + 1 non_human
  const humanClusters = clusters.filter((c) => !c.isNonHuman);
  const nonHuman = clusters.find((c) => c.isNonHuman);
  assert.equal(humanClusters.length, 3);
  assert.deepEqual(humanClusters[0].imageIds, ['img1', 'img2']);
  assert.equal(humanClusters[0].folderName, 'person_01');
  assert.deepEqual(humanClusters[1].imageIds, ['img3']);
  assert.equal(humanClusters[1].folderName, 'person_02');
  assert.deepEqual(humanClusters[2].imageIds, ['img4']);
  assert.equal(humanClusters[2].folderName, 'person_03');
  assert.ok(nonHuman);
  assert.deepEqual(nonHuman.imageIds, ['img5']);
});

test('normalizeClusterAssignments supports descriptive folder names without collisions', () => {
  const profiles = [
    makeProfile('i1', '1.jpg'),
    makeProfile('i2', '2.jpg'),
  ];
  const clusters = normalizeClusterAssignments(
    profiles,
    [{ imageIds: ['i1'] }, { imageIds: ['i2'] }],
    'descriptive'
  );
  assert.equal(clusters[0].folderName, 'person_01_square_mesomorph');
  assert.equal(clusters[1].folderName, 'person_02_square_mesomorph');
});

test('renameClusterFolder, mergeClusters, and moveImageBetweenClusters preserve invariants', () => {
  const profiles = [makeProfile('i1', '1.jpg'), makeProfile('i2', '2.jpg'), makeProfile('i3', '3.jpg')];
  let clusters = normalizeClusterAssignments(
    profiles,
    [{ imageIds: ['i1'] }, { imageIds: ['i2', 'i3'] }],
    'indexed'
  );

  clusters = renameClusterFolder(clusters, clusters[0].clusterId, 'Alex Studio');
  assert.equal(clusters[0].folderName, 'Alex_Studio');

  // Split i3 into a brand new folder
  clusters = moveImageBetweenClusters(clusters, 'i3', '__new__', profiles[2]);
  assert.equal(clusters.length, 3);

  // Merge newest folder back into Alex Studio
  const newestId = clusters[2].clusterId;
  clusters = mergeClusters(clusters, newestId, clusters[0].clusterId);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].imageIds.length, 2);
});

test('resolveUniqueFilenames and buildClassificationManifest avoid path collisions inside folders', () => {
  const deduped = resolveUniqueFilenames([
    { filename: 'portrait.jpg' },
    { filename: 'portrait.jpg' },
    { filename: '../evil/portrait.jpg' },
  ]);
  assert.deepEqual(
    deduped.map((d) => d.safeFilename),
    ['portrait.jpg', 'portrait_1.jpg', 'portrait_2.jpg']
  );

  const p1 = makeProfile('i1', 'portrait.jpg');
  const p2 = makeProfile('i2', 'portrait.jpg');
  const clusters = normalizeClusterAssignments([p1, p2], [{ imageIds: ['i1', 'i2'] }], 'indexed');
  const manifest = buildClassificationManifest(clusters, new Map([['i1', p1], ['i2', p2]]));
  assert.equal(manifest.totalImages, 2);
  assert.equal(manifest.uniqueHumansCount, 1);
  assert.deepEqual(
    manifest.folders[0].files.map((f) => f.archivedPath),
    ['person_01/portrait.jpg', 'person_01/portrait_1.jpg']
  );
});
