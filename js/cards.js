// The card editor dialog (add, edit, remove) and the Search tab.
// --- Add / edit dialog ---
async function openCard(g, id, existing) {
  let d = existing;
  if (d) editPrices = d.market != null ? { [d.variant]: d.market } : {};
  else if (g === 'custom') { d = { game: g, name: $('#q').value.trim(), set: '', img: '', thumb: '' }; editPrices = {}; }
  else { const { prices, ...info } = await getCard(g, id); d = { game: g, id, ...info }; editPrices = prices; }
  editing = d;
  const custom = d.game === 'custom';
  $('#dImg').src = d.img || ''; $('#dLoader').classList.toggle('hidden', !d.img);
  $('#dName').textContent = d.name; $('#dSet').textContent = d.set;
  $('#dTitle').classList.toggle('hidden', custom); $('#dCustom').classList.toggle('hidden', !custom);
  $('#cName').required = custom; $('#cName').value = d.name; $('#cSet').value = d.set; $('#cImg').value = d.img;
  $('#dVariantWrap').classList.toggle('hidden', custom);
  fillVariants(existing?.variant);
  $('#dCol').innerHTML = collections.map(n => `<option>${esc(n)}</option>`).join('');
  $('#dCol').value = existing?.col ?? (cur === 'All' ? collections[0] : cur);
  $('#dQty').value = existing?.qty ?? 1;
  $('#dCond').value = existing?.cond ?? 'Near Mint';
  $('#dGrader').value = existing?.grader ?? ''; $('#dGrade').value = existing?.grade ?? '';
  $('#dManual').value = existing?.manual ?? '';
  $('#dCost').value = existing?.cost ?? '';
  $('#dDelete').classList.toggle('hidden', !existing);
  syncManual();
  $('#dlg').returnValue = ''; // Esc keeps the old returnValue otherwise
  $('#dlg').showModal();
  // Editing opens instantly with the stored price; the other printings load in behind it.
  if (existing && sources[d.game]) getCard(d.game, d.id).then(r => {
    if (editing !== d || !$('#dlg').open) return;
    editPrices = { ...r.prices, ...(r.prices[d.variant] == null && d.market != null && { [d.variant]: d.market }) };
    fillVariants($('#dVariant').value); syncManual();
  }).catch(e => console.warn('Could not load printings', e));
}
function fillVariants(selected) {
  const vs = Object.entries(editPrices);
  $('#dVariant').innerHTML = vs.length ? vs.map(([k, v]) => `<option value="${esc(k)}">${esc(k)} — ${usd(v)}</option>`).join('') : '<option value="none">No market price</option>';
  if (selected && editPrices[selected] != null) $('#dVariant').value = selected;
}
// No free source has graded or sports prices, so those need your own value.
function syncManual() {
  const need = editing?.game === 'custom' || !Object.keys(editPrices).length;
  $('#dManual').required = need;
  $('#manualHint').textContent = need ? '— required, no market price available' : $('#dGrader').value ? '— recommended: market price is for raw copies' : '';
}
$('#dGrader').onchange = syncManual;

const num = el => el.value === '' ? null : +el.value;
$('#dlg').addEventListener('close', async () => {
  const act = $('#dlg').returnValue, c = editing, prices = editPrices;
  editPrices = {};
  if (act === 'delete') {
    if (!await ask(`Remove ${c.name} from your collection?`)) return; // was one tap, no undo
    cards = cards.filter(x => x !== c);
  }
  if (act === 'save') {
    if (c.game === 'custom') { const img = $('#cImg').value.trim(); Object.assign(c, { name: $('#cName').value.trim(), set: $('#cSet').value.trim(), img, thumb: img }); }
    Object.assign(c, { variant: c.game === 'custom' ? 'none' : $('#dVariant').value, col: $('#dCol').value,
      qty: Math.max(1, Math.round(+$('#dQty').value) || 1), cond: $('#dCond').value, grader: $('#dGrader').value || null,
      grade: $('#dGrader').value ? num($('#dGrade')) : null, manual: num($('#dManual')), cost: num($('#dCost')) });
    c.market = prices[c.variant] ?? null;
    const p = unitPrice(c);
    if (p !== c.price) c.prevPrice = null; // a condition/value edit isn't a market move; don't show it as a % change
    c.price = p;
    if (!c.key) { c.key = crypto.randomUUID(); c.added = Date.now(); cards.push(c); }
  }
  if (act === 'save' || act === 'delete') commit();
});

// --- Search ---
$('#searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (game === 'custom') return openCard('custom');
  const q = $('#q').value.trim(); if (!q) return;
  searchCtl?.abort(); // a newer search cancels the one in flight, so a slow old answer can't overwrite it
  const ctl = searchCtl = new AbortController();
  $('#searchMsg').textContent = 'Searching…'; $('#results').innerHTML = '';
  try {
    const res = await sources[game].search(q, ctl.signal);
    $('#searchMsg').textContent = res.length ? `${res.length} results — tap a card to add it` : 'No results';
    $('#results').innerHTML = res.map(r => `<div data-id="${esc(r.id)}" role="button" tabindex="0"><img src="${esc(r.img)}" alt="" data-name="${esc(r.name)}" loading="lazy" decoding="async">${esc(r.name)}<br>${esc(r.sub)}</div>`).join('');
  } catch (err) { if (err.name !== 'AbortError') $('#searchMsg').textContent = `Search failed: ${why(err)}.`; }
});
$('#results').addEventListener('click', async e => {
  const el = e.target.closest('[data-id]');
  if (!el || $('#results').ariaBusy === 'true') return; // a second tap while loading used to open the dialog twice
  el.classList.add('busy'); $('#results').ariaBusy = 'true';
  try { await openCard(game, el.dataset.id); }
  catch (err) { tell(`Could not load card: ${why(err)}.`); }
  finally { el.classList.remove('busy'); $('#results').ariaBusy = 'false'; }
});
document.querySelectorAll('[data-game]').forEach(b => b.onclick = () => {
  game = b.dataset.game; searchCtl?.abort();
  document.querySelectorAll('[data-game]').forEach(x => { x.classList.toggle('on', x === b); x.ariaPressed = x === b; });
  $('#results').innerHTML = '';
  $('#searchMsg').textContent = game === 'custom' ? 'Sports, graded or any other card: type a name and press Enter to add it with your own value.' : '';
  $('#q').placeholder = game === 'custom' ? 'Card name…' : 'Search cards by name…';
});
