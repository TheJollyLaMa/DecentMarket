export function resolveCollectibleAsset(uri) {
  if (typeof uri !== 'string' || !uri) return '';
  if (uri.startsWith('ipfs://')) {
    const path = uri.slice(7).replace(/^ipfs\//, '');
    if (!/^[a-zA-Z0-9]+(?:\/[^?#]*)?$/.test(path)) return '';
    return `https://ipfs.io/ipfs/${path}`;
  }
  try {
    const url = new URL(uri);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

export function collectibleFaces(metadata) {
  return {
    front: resolveCollectibleAsset(metadata?.image),
    back: resolveCollectibleAsset(metadata?.properties?.back_image),
  };
}

export function createCollectibleDisplay(THREE, front, back) {
  if (!back) {
    const display = new THREE.Sprite(new THREE.SpriteMaterial({ map: front, transparent: true }));
    display.scale.set(3, 3, 1);
    return display;
  }
  const edges = Array.from({ length: 4 }, () => new THREE.MeshBasicMaterial({ color: 0x80edd2 }));
  const display = new THREE.Mesh(new THREE.BoxGeometry(3, 3, .06), [
    ...edges,
    new THREE.MeshBasicMaterial({ map: front }),
    new THREE.MeshBasicMaterial({ map: back }),
  ]);
  display.userData.twoSided = true;
  return display;
}

export function disposeCollectible(display) {
  display.geometry?.dispose();
  const materials = Array.isArray(display.material) ? display.material : [display.material];
  const textures = new Set();
  for (const material of materials) {
    if (material?.map) textures.add(material.map);
    material?.dispose();
  }
  textures.forEach(texture => texture.dispose());
}
