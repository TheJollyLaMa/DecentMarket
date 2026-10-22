export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function externalLink(label, value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const link = element('a', label);
    link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    return link;
  } catch { return null; }
}

export function openMarketDialog(id, title) {
  document.getElementById(id)?.close();
  const dialog = element('dialog', undefined, 'market-dialog');
  dialog.id = id;
  const heading = element('h2', title);
  heading.id = `${id}-heading`;
  dialog.setAttribute('aria-labelledby', heading.id);
  const header = element('header');
  const close = element('button', '×');
  close.type = 'button'; close.setAttribute('aria-label', `Close ${title}`);
  close.id = id === 'nft-detail-modal' ? 'nft-detail-close' : `${id}-close`;
  close.onclick = () => dialog.close();
  header.append(heading, close);
  const body = element('div', undefined, 'market-dialog-body');
  dialog.append(header, body);
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  } });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, body };
}
