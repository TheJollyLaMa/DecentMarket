export const COIN_RADIUS = 5.5;
export const SPIRAL_RADIUS = 28;

export function timelinePosition(index) {
  const angle = index * Math.PI / 2.5;
  return { x: Math.sin(angle) * SPIRAL_RADIUS, y: Math.cos(angle) * SPIRAL_RADIUS, z: -4 - index * 12 };
}

export function nearbyFlipKeys(entries, camera, selectedKey) {
  return entries.filter(([, entry]) => {
    const distance = Math.hypot(entry.x - camera.x, entry.y - camera.y, entry.z - camera.z);
    return distance <= COIN_RADIUS * 7;
  }).sort(([a, first], [b, second]) =>
    (a === selectedKey ? -1 : b === selectedKey ? 1 : 0)
    || Math.hypot(first.x - camera.x, first.y - camera.y, first.z - camera.z)
      - Math.hypot(second.x - camera.x, second.y - camera.y, second.z - camera.z))
    .slice(0, 2).map(([key]) => key);
}

export function viewingDistance(aspect, fov = 75) {
  return Math.max(16, COIN_RADIUS * 1.5 / (Math.tan(fov * Math.PI / 360) * Math.min(1, aspect)));
}

export function advanceStarDepth(depth, delta) {
  return -120 + ((depth + 120 + delta * 2.5) % 118);
}
