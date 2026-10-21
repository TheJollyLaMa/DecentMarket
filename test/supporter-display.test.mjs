import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectibleFaces, resolveCollectibleAsset, createCollectibleDisplay, disposeCollectible } from '../js/supporter-display.mjs';

test('standard front/back resolve IPFS through a non-retired gateway; unsafe images are rejected', () => {
  assert.deepEqual(collectibleFaces({ image: 'ipfs://bafabc/front.png', properties: { back_image: 'ipfs://bafabc/back.png' } }), {
    front: 'https://ipfs.io/ipfs/bafabc/front.png', back: 'https://ipfs.io/ipfs/bafabc/back.png',
  });
  assert.equal(collectibleFaces({ image: 'https://example.com/front.png' }).back, '');
  for (const value of [null, {}, 'javascript:alert(1)', 'data:text/html,evil', 'ipfs://?invalid']) assert.equal(resolveCollectibleAsset(value), '');
});

const THREE = {
  SpriteMaterial: class { constructor(options) { Object.assign(this, options); } dispose() { this.disposed = true; } },
  MeshBasicMaterial: class { constructor(options) { Object.assign(this, options); } dispose() { this.disposed = true; } },
  Sprite: class { constructor(material) { this.material = material; this.scale = { set: (...values) => { this.size = values; } }; } },
  Mesh: class { constructor(geometry, material) { Object.assign(this, { geometry, material, userData: {} }); } },
  BoxGeometry: class { constructor(...size) { this.size = size; } dispose() { this.disposed = true; } },
};

test('two-sided supporters are real box meshes with independently mapped front/back faces', () => {
  const front = { dispose() { this.disposed = true; } }, back = { dispose() { this.disposed = true; } };
  const display = createCollectibleDisplay(THREE, front, back);
  assert.deepEqual(display.geometry.size, [3, 3, .06]);
  assert.equal(display.material[4].map, front);
  assert.equal(display.material[5].map, back);
  assert.equal(display.userData.twoSided, true);
  disposeCollectible(display);
  assert.equal(display.geometry.disposed, true);
  assert.equal(front.disposed && back.disposed, true);
  assert.ok(display.material.every(material => material.disposed));
});

test('single-image legacy tokens retain their sprite presentation', () => {
  const display = createCollectibleDisplay(THREE, {});
  assert.ok(display instanceof THREE.Sprite);
  assert.deepEqual(display.size, [3, 3, 1]);
});
