import { listingPrices } from './market-listings.mjs';
import { collectibleFaces } from './supporter-display.mjs';
import { COIN_RADIUS } from './market-flight.mjs';

function lines(context, text, x, y, width, max = 2, step = 40) {
  let line = '', count = 0;
  for (const word of String(text || '').split(/\s+/)) {
    if (context.measureText(`${line} ${word}`).width > width && line) {
      context.fillText(line, x, y + step * count++);
      if (count >= max) return;
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (count < max) context.fillText(line, x, y + step * count);
}

export function coinCaption(product) {
  const offers = product.listings || [];
  const live = offers.filter(l => l.purchasable);
  return live.length ? listingPrices(live[0]).map(p => p.label).join(' or ')
    : offers[0]?.status || 'Explore this DNFT';
}

export function starPoints(radius = COIN_RADIUS) {
  return Array.from({ length: 10 }, (_, index) => {
    const angle = Math.PI / 2 + index * Math.PI / 5;
    const length = index % 2 ? radius * .52 : radius;
    return { x: Math.cos(angle) * length, y: Math.sin(angle) * length };
  });
}

export function createStarGeometry(THREE) {
  const shape = new THREE.Shape();
  starPoints().forEach(({ x, y }, index) => {
    if (index) shape.lineTo(x, y); else shape.moveTo(x, y);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .22, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geometry.translate(0, 0, -.11);
  const positions = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
  geometry.clearGroups();
  for (let index = 0; index < positions.count; index += 3) {
    const normal = normals.getZ(index), face = normal > .9 ? 1 : normal < -.9 ? 2 : 0;
    geometry.addGroup(index, 3, face);
    if (!face) continue;
    for (let vertex = index; vertex < index + 3; vertex++) {
      uv.setXY(vertex, .5 + positions.getX(vertex) / (COIN_RADIUS * 2) * (face === 2 ? -1 : 1),
        .5 + positions.getY(vertex) / (COIN_RADIUS * 2));
    }
  }
  return geometry;
}

export function createMarketCoin(THREE, product, { onError = console.warn } = {}) {
  const metadata = product.metadata || {}, faces = collectibleFaces(metadata);
  const textures = [];
  let disposed = false;
  const draw = (image, back) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
    const c = canvas.getContext('2d');
    c.fillStyle = '#07182a'; c.fillRect(0, 0, 1024, 1024);
    c.beginPath();
    starPoints(480).forEach(({ x, y }, index) => {
      if (index) c.lineTo(512 + x, 512 - y); else c.moveTo(512 + x, 512 - y);
    });
    c.closePath(); c.strokeStyle = '#a9ffe0'; c.lineWidth = 8; c.stroke();
    c.save(); c.translate(512 * .4, 512 * .4); c.scale(.6, .6);
    c.textAlign = 'center'; c.fillStyle = '#eefff8'; c.font = 'bold 34px sans-serif';
    lines(c, metadata.name || `DNFT #${product.tokenId}`, 512, 150, 570, 2, 40);
    if (image) {
      const width = 620, height = back ? 410 : 520;
      const scale = Math.min(width / image.width, height / image.height);
      c.drawImage(image, 512 - image.width * scale / 2, 240, image.width * scale, image.height * scale);
    } else {
      c.fillStyle = '#a99aff'; c.font = '100px sans-serif'; c.fillText('✦', 512, 370);
      c.font = '28px sans-serif';
      lines(c, back ? metadata.description || 'A Decent digital keepsake.' : 'Decent digital artifact', 512, 470, 630, 3);
    }
    if (back && image) {
      c.fillStyle = '#eefff8'; c.font = '26px sans-serif';
      lines(c, metadata.description, 512, 665, 640, 2, 32);
    }
    c.fillStyle = '#b4ffe0'; c.font = 'bold 34px sans-serif';
    lines(c, coinCaption(product), 512, 795, 640, 2);
    c.fillStyle = '#d6cfff'; c.font = '26px sans-serif';
    c.fillText(`Base · #${product.tokenId}`, 512, 885);
    c.font = '22px sans-serif';
    lines(c, back ? 'Click / tap to explore & purchase' : 'Flip below · tap to explore', 512, 920, 400, 1);
    c.restore();
    const texture = new THREE.CanvasTexture(canvas);
    texture.center.set(.5, .5);
    return texture;
  };
  textures.push(draw(null, false), draw(null, true));
  const geometry = createStarGeometry(THREE);
  const materials = [new THREE.MeshBasicMaterial({ color: '#a89aef' }),
    new THREE.MeshBasicMaterial({ map: textures[0] }), new THREE.MeshBasicMaterial({ map: textures[1] })];
  const coin = new THREE.Mesh(geometry, materials);
  coin.userData.twoSided = true;
  coin.userData.coin = true;
  coin.userData.star = true;
  coin.userData.hovered = false;
  coin.userData.dispose = () => { disposed = true; };
  for (const [index, url] of [faces.front, faces.back].entries()) {
    if (!url) continue;
    const image = new Image(); image.crossOrigin = 'anonymous'; image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      if (disposed) return;
      try {
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('Image has no usable dimensions');
        const next = draw(image, index === 1);
        materials[index + 1].map.dispose(); materials[index + 1].map = next;
        materials[index + 1].needsUpdate = true;
      } catch (error) { onError(`Cannot render artwork for DNFT #${product.tokenId}: ${error.message}`); }
    };
    image.onerror = () => { if (!disposed) onError(`Artwork unavailable for DNFT #${product.tokenId}: ${url}`); };
    image.src = url;
  }
  return coin;
}
