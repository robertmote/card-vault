// Page-wide wiring (tabs, keyboard, broken images, sort/range, backups) and start-up. Loaded last.
// --- Misc wiring ---
// A card picture that fails to load (the image sites hiccup now and then) shows the card's name instead of a
// broken-image icon; the editor just drops its top-loader. Image errors don't bubble, so listen in the capture phase.
document.addEventListener('error', e => {
  const img = e.target;
  if (img.id === 'dImg') return img.getAttribute('src') && $('#dLoader').classList.add('hidden');
  if (img.dataset?.name != null) img.replaceWith(Object.assign(document.createElement('span'), { className: 'noimg', textContent: img.dataset.name }));
}, true);

// Pockets, result cards and file-picker labels act as buttons for keyboard users too.
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button]')) { e.preventDefault(); e.target.click(); }
});
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(x => { x.classList.toggle('on', x === b); x.toggleAttribute('aria-current', x === b); });
  for (const id of ['portfolio', 'search', 'profile']) $('#' + id).classList.toggle('hidden', b.dataset.tab !== id);
  if (b.dataset.tab === 'portfolio' && cur !== 'All') renderPages(); // re-align the page after the tab was hidden
});
$('#ranges').onclick = e => { if (e.target.dataset.r) { range = +e.target.dataset.r; renderChart(T); } };
$('#sort').onchange = () => renderPages(true);
$('#refresh').onclick = refresh;
$('#export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ cards, history, collections, colors, profile })], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: `card-vault-${new Date().toISOString().slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // release the in-memory copy of the backup
};
$('#import').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; // reset first, or picking the same file again after Cancel does nothing
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.cards) || d.cards.some(c => !c || typeof c !== 'object')) throw new Error('not a Card Vault backup');
    if (!await ask(`Replace your current collection with ${d.cards.length} cards from this backup?`)) return;
    collections = Array.isArray(d.collections) && d.collections.length ? d.collections.map(String) : ['Main'];
    cards = d.cards; cards.forEach(migrate);
    colors = d.colors && typeof d.colors === 'object' ? d.colors : {};
    history = Array.isArray(d.history) ? d.history : []; profile = d.profile ?? profile; cur = 'All'; page = 0;
    save(); render(); renderProfile();
  } catch (err) { tell('Import failed: ' + err.message); }
};
// Page offsets are in screen widths, so re-align after the window changes size.
addEventListener('resize', () => { if (cur !== 'All') $('#pages').scrollLeft = page * $('#pages').clientWidth; });

if (oldFormat) save('cards', 'collections'); // persist the slimmer format once
render(); renderProfile();
