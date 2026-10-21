import { mountSupporterStudio } from './supporter-studio.mjs';
import { mountMusicSubmission } from './market-music.mjs';

export function mountMintLanes(panel) {
  const [heading, wallet, content] = [...panel.children];
  const defaults = document.createElement('details');
  defaults.name = 'mint-lane'; defaults.open = true; defaults.dataset.lane = 'regular';
  const title = document.createElement('summary'); title.textContent = 'Regular DNFT · default minting';
  defaults.append(title, wallet, content);
  const supporter = document.createElement('details');
  supporter.name = 'mint-lane'; supporter.dataset.lane = 'supporter';
  const label = document.createElement('summary'); label.textContent = 'Supporter DNFT · prepared release';
  const studio = document.createElement('div'); studio.className = 'supporter-studio-embed';
  supporter.append(label, studio);
  const music = document.createElement('details');
  music.name = 'mint-lane'; music.dataset.lane = 'music';
  const musicTitle = document.createElement('summary'); musicTitle.textContent = 'Music DNFT · DecentBusking';
  const musicBody = document.createElement('div'); musicBody.className = 'music-submission';
  music.append(musicTitle, musicBody);
  panel.replaceChildren(heading, defaults, supporter, music);
  mountMusicSubmission(musicBody);
  let disposeStudio, loaded = false, loading = false;
  supporter.addEventListener('toggle', async () => {
    if (!supporter.open || loaded || loading) return;
    loading = true;
    studio.textContent = 'Loading prepared-release studio…';
    try {
      const response = await fetch(new URL('../supporter.html', import.meta.url), { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Studio HTTP ${response.status}`);
      const template = new DOMParser().parseFromString(await response.text(), 'text/html');
      const main = template.querySelector('main[data-supporter-studio]');
      if (!main) throw new Error('Studio template is missing');
      if (!panel.isConnected) return;
      main.querySelector('header')?.remove();
      studio.replaceChildren(...main.children);
      disposeStudio = mountSupporterStudio(studio);
      loaded = true;
    } catch (error) {
      studio.textContent = `Could not load studio: ${error.message}. Close and reopen this section to retry.`;
      console.error('[Market mint studio]', error);
    } finally { loading = false; }
  });
  const observer = new MutationObserver(() => {
    if (!panel.isConnected) { disposeStudio?.(); observer.disconnect(); document.removeEventListener('keydown', escape); }
  });
  const escape = event => { if (event.key === 'Escape') panel.remove(); };
  document.addEventListener('keydown', escape);
  observer.observe(panel.parentNode, { childList: true });
}
