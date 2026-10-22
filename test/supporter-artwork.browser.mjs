import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderSupporterArtwork } from '../scripts/render-supporter-artwork.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = mkdtempSync(join(tmpdir(), 'market-artwork-test-'));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.setContent('<body style="background:#07182a;color:#a9ffe0"><h1>Storefront screenshot fixture</h1></body>');
  const screenshotPath = join(directory, 'storefront.png');
  await page.screenshot({ path: screenshotPath });
  const terms = { screenshotPath, outputDirectory: directory, tag: 'v0.3.0', commit: '114aa646cb8ee14135ad5732d44b36b7fbf108d8',
    releaseDate: '2026-10-22T01:56:36.000Z', creatorAddress: '0x807061DF657A7697c04045dA7d16D941861cAABc' };
  const files = await renderSupporterArtwork(page, terms);
  assert.equal(await page.locator('body').isVisible(), true, 'Back selector must not hide body');
  assert.equal(await page.locator('section.back').isVisible(), true);
  assert.equal(await page.locator('img.front').isVisible(), false);
  assert.match(await page.locator('section.back').innerText(), new RegExp(terms.commit));
  assert.match(await page.locator('main').innerText(), /1,000 editions.*10 USDC/);
  assert.match(await page.locator('main').innerText(), new RegExp(terms.creatorAddress));
  assert.equal(await page.locator('h1').isVisible(), true);
  assert.equal(await page.locator('h1').innerText(), 'Decent Market');
  assert.equal(await page.locator('.version').innerText(), 'v0.3.0 · $10 USDC');
  const style = await page.locator('h1').evaluate(element => getComputedStyle(element).textShadow);
  assert.notEqual(style, 'none', 'Back title keeps the Head Supporter glow');
  assert.ok((await page.locator('main').innerText()).includes(terms.releaseDate));
  assert.notDeepEqual(readFileSync(files.front), readFileSync(files.back), 'Faces must differ');
  for (const [face, path] of Object.entries(files)) {
    const pixels = await page.evaluate(async src => {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height).data;
      let dark = 0, light = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 80 && data[i + 1] < 100 && data[i + 2] < 100) dark++;
        if (data[i] > 180 && data[i + 1] > 180 && data[i + 2] > 180) light++;
      }
      return { width: image.width, height: image.height, dark, light };
    }, `data:image/png;base64,${readFileSync(path).toString('base64')}`);
    assert.equal(pixels.width, 1200); assert.equal(pixels.height, 1200);
    assert.ok(pixels.dark > 500000, `${face} must render the background, not a blank screenshot`);
    assert.ok(pixels.light > 10000, `${face} must render visible title and terms`);
  }
  await assert.rejects(renderSupporterArtwork(page, { ...terms, releaseDate: 'OVERFLOW '.repeat(1000) }), /clips outside/);
  console.log('PASS: actual PNG pixels, visible distinct front/back, complete provenance/terms and clipping rejection; no pinning, upload or signing.');
} finally {
  await browser.close();
  rmSync(directory, { recursive: true });
}
