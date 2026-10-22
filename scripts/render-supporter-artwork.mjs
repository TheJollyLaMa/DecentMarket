import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function renderSupporterArtwork(page, { screenshotPath, outputDirectory = '.', tag, commit, releaseDate, creatorAddress }) {
  const screenshot = readFileSync(screenshotPath).toString('base64');
  await page.setViewportSize({ width: 1200, height: 1200 });
  await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><style>
    body{margin:0;width:1200px;height:1200px;background:linear-gradient(150deg,#050b20,#143a34);color:#edfff8;font:26px system-ui}
    main{padding:48px;display:flex;flex-direction:column;align-items:center;gap:26px;box-sizing:border-box;height:1200px;border:12px solid #7af0c6}
    h1{font-size:66px;margin:0;color:#baffe2}p{margin:0;text-align:center;overflow-wrap:anywhere}
    img.front{width:1056px;border:2px solid #a78cff;border-radius:20px}
    section.back{display:none}body.show-back .front{display:none}body.show-back section.back{display:block}
    section.back{max-width:1056px;text-align:center}section.back p{margin:24px 0}
    small{font-size:21px}strong{color:#baffe2}
    body.show-back{background:#060b14;color:#eef8ff;font-family:'Avenir Next','Trebuchet MS',system-ui,sans-serif}
    body.show-back main{position:relative;isolation:isolate;border:0;padding:64px 60px 60px;justify-content:space-between;gap:14px;
      background:radial-gradient(ellipse at 50% 38%,#8d7cf733,transparent 55%),radial-gradient(circle at 50% 52%,#7af0c61f,transparent 46%),linear-gradient(160deg,#0a1220,#10202a 52%,#12302c)}
    body.show-back main::before{content:'';position:absolute;inset:0;z-index:-1;opacity:.8;
      background-image:radial-gradient(1.5px 1.5px at 7% 12%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 21% 33%,#cfe 50%,transparent 51%),radial-gradient(1.8px 1.8px at 33% 8%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 46% 27%,#dcf 50%,transparent 51%),radial-gradient(1.4px 1.4px at 61% 14%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 72% 36%,#cfe 50%,transparent 51%),radial-gradient(1.6px 1.6px at 88% 9%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 94% 31%,#dcf 50%,transparent 51%);background-size:600px 400px}
    body.show-back main::after{content:'';position:absolute;inset:22px;border-radius:44px;z-index:-1;border:2px solid #7af0c655;box-shadow:0 0 40px #7af0c633,inset 0 0 60px #8d7cf722}
    body.show-back .kicker{font:700 26px ui-monospace,Menlo,monospace;letter-spacing:.32em;color:#7af0c6;text-shadow:0 0 14px #7af0c6}
    body.show-back h1{font:800 94px/1.1 'Avenir Next','Trebuchet MS',system-ui,sans-serif;color:#e9fff7;text-shadow:0 0 6px #fff8,0 0 22px #7af0c6,0 0 50px #7af0c6,0 0 90px #8d7cf7b3}
    body.show-back .version{display:block;font:700 40px ui-monospace,Menlo,monospace;color:#b9a9ff;letter-spacing:.12em;text-shadow:0 0 16px #8d7cf7}
    body.show-back section.back{font:500 26px/1.55 system-ui;max-width:960px}
    body.show-back section.back p{margin:14px 0}
    body.show-back .provenance{font:500 20px/1.6 ui-monospace,monospace;color:#9fb6c8}
    body.show-back .terms strong{font:600 22px system-ui;padding:10px 22px;border-radius:999px;border:1px solid #7af0c677;background:#10202acc;color:#eef8ff}
    body.show-back .identity{font:600 20px/1.6 ui-monospace,monospace}
    body.show-back .release-date{font:600 20px system-ui;color:#9fb6c8}
    .version{display:none}
    </style>
    <main><p class="kicker">::- SUPPORTER DNFT -::</p><h1>Decent Market<span class="front"> ${tag}</span></h1>
    <p class="version">${tag} · $10 USDC</p>
    <img class="front" alt="Actual release storefront" src="data:image/png;base64,${screenshot}">
    <section class="back"><h2>Another Decent Frankenstein</h2><p>Base marketplace · two-sided DNFT stars · spiral flight · ENS portals · resumable Supporter studio</p>
    <p class="provenance">Exact source commit<br>${commit}<br>github.com/TheJollyLaMa/DecentMarket/releases/tag/${tag}</p>
    <p>Apache-2.0 + NOTICE · original artwork/docs CC BY 4.0</p><p>Clone the tagged source to customize. Preserve attribution and review contract/identity configuration.</p>
    <p>No product ownership or financial return promised. Royalties are not universally enforced.</p></section>
    <p class="terms"><strong>1,000 editions · $10 / 10 USDC each · Base</strong></p>
    <p class="identity">thejollylama.eth<br><small>${creatorAddress}</small></p><p class="release-date">Release ${releaseDate}</p></main></html>`);
  await page.locator('img.front').evaluate(image => image.decode());
  await page.evaluate(() => document.fonts.ready);
  const files = {};
  for (const face of ['front', 'back']) {
    await page.locator('body').evaluate((body, back) => body.classList.toggle('show-back', back), face === 'back');
    await page.locator(face === 'front' ? 'img.front' : 'section.back').waitFor({ state: 'visible' });
    const valid = await page.evaluate(() => [...document.querySelectorAll('main, main p, main h1, main h2, main .version, img.front, section.back')]
      .filter(element => element.getClientRects().length)
      .every(element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= 1200 && box.bottom <= 1200;
      }));
    if (!valid) throw new Error(`Supporter ${face} artwork is hidden or clips outside its 1200px canvas`);
    files[face] = join(outputDirectory, `supporter-${face}.png`);
    await page.screenshot({ path: files[face] });
  }
  return files;
}
