(() => {
  if (!new URLSearchParams(location.search).has('supporters')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'market-arrival-loading';
  dialog.className = 'market-dialog market-arrival-loading';
  dialog.setAttribute('aria-labelledby', 'market-arrival-loading-title');
  dialog.setAttribute('aria-busy', 'true');
  const header = document.createElement('header');
  const title = document.createElement('h2');
  title.id = 'market-arrival-loading-title';
  title.textContent = 'Loading your Supporter DNFT';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close loading panel');
  close.onclick = () => dialog.close();
  header.append(title, close);
  const body = document.createElement('div');
  body.className = 'market-dialog-body';
  const progress = document.createElement('progress');
  progress.setAttribute('aria-label', 'Loading Supporter edition');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Opening DecentMarket. Please wait…';
  const note = document.createElement('p');
  note.textContent = 'We check Base prices, available editions and artwork before showing your NFT.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Try again';
  retry.hidden = true;
  let ready = false, timer;
  const waiting = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      note.textContent = 'This is taking longer than usual. Base or IPFS may be busy; we’re still checking. No wallet action has been requested.';
    }, 12000);
  };
  retry.onclick = () => {
    if (!ready) { location.reload(); return; }
    retry.hidden = true;
    progress.hidden = false;
    progress.removeAttribute('value');
    dialog.setAttribute('aria-busy', 'true');
    title.textContent = 'Loading your Supporter DNFT';
    status.textContent = 'Retrying Base verification…';
    note.textContent = 'We check Base prices, available editions and artwork before showing your NFT.';
    waiting();
    document.dispatchEvent(new CustomEvent('market:refresh-listings'));
  };
  body.append(progress, status, note, retry);
  dialog.append(header, body);
  document.body.append(dialog);
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => clearTimeout(timer));
  document.addEventListener('market:arrival-loading', event => {
    const detail = event.detail || {};
    if (detail.ready) ready = true;
    if (detail.done) { clearTimeout(timer); dialog.close(); dialog.remove(); return; }
    if (detail.error) {
      clearTimeout(timer);
      dialog.setAttribute('aria-busy', 'false');
      progress.hidden = true;
      title.textContent = 'Supporter loading interrupted';
      status.textContent = detail.error;
      note.textContent = 'No purchase was made. Try again, or close this panel to browse.';
      retry.hidden = false;
    } else if (detail.text) {
      status.textContent = detail.text;
      if (Number.isFinite(detail.total) && detail.total > 0) {
        progress.max = detail.total;
        progress.value = detail.checked;
      } else progress.removeAttribute('value');
    }
  });
  window.addEventListener('error', event => {
    if (!(event.target instanceof HTMLScriptElement)) return;
    document.dispatchEvent(new CustomEvent('market:arrival-loading', { detail: { error: 'A marketplace script could not load. Check your connection and retry.' } }));
  }, true);
  dialog.showModal();
  waiting();
})();
