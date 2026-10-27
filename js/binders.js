// The shelf of binders, the swipeable 9-pocket binder pages, and the binder menu (new, rename, colour, delete).
// --- The shelf: one spine per binder, 6 slots to a shelf ---
const hash = s => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
function renderShelf(t) {
  const spines = collections.map(n => {
    const b = t.col[n], [c] = colorOf(n);
    // height varies a little per binder (stable, from its name) so the row doesn't look machine-made
    return `<button class="spine nylon" data-bind="${esc(n)}" style="--c:${c};height:${146 + hash(n) % 20}px" aria-label="Open ${esc(n)}: ${b.qty} cards, ${usd(b.val)}">
      <span class="t">${esc(n)}</span><span class="v">${tagUsd(b.val)}</span></button>`;
  });
  spines.push('<button class="spine add" id="addBinder" aria-label="New binder">+</button>');
  $('#shelves').innerHTML = chunk(spines, 6).map(row => `<div class="shelf">${row.join('')}</div>`).join('');
}
$('#shelves').onclick = e => {
  if (e.target.closest('#addBinder')) return newBinder();
  const b = e.target.closest('[data-bind]');
  if (b) openBinder(b);
};


// --- Binder pages: 9 pockets each; only the page on screen and its neighbours hold images ---
const gainOf = c => ((c.price || 0) - (c.cost ?? c.price ?? 0)) * c.qty;
const SORTS = { value: (a, b) => value(b) - value(a), gain: (a, b) => gainOf(b) - gainOf(a),
                name: (a, b) => byName(a.name, b.name), added: (a, b) => b.added - a.added };
const HOLES = '<div class="holes" aria-hidden="true"><i></i><i></i><i></i></div>';
const pageCount = () => Math.max(1, Math.ceil(view.length / 9));

function renderPages(reset) {
  view = cards.filter(c => c.col === cur).sort(SORTS[$('#sort').value]);
  if (reset) page = 0;
  page = Math.min(page, pageCount() - 1);
  const el = $('#pages');
  el.innerHTML = Array.from({ length: pageCount() }, (_, i) => `<div class="sheet" data-p="${i}">${HOLES}</div>`).join('');
  fillAround();
  el.scrollLeft = page * el.clientWidth;
  syncPager();
}
function pocketHTML(c) {
  if (!c) return '<div class="pocket empty" aria-hidden="true"></div>';
  const ch = c.prevPrice && c.price ? (c.price - c.prevPrice) / c.prevPrice * 100 : 0;
  const info = [c.name, c.set, c.variant !== 'none' && c.variant, c.grader ? `${c.grader} ${c.grade ?? ''}` : c.cond,
                c.qty > 1 && `${c.qty} copies`, usd(c.price) + ' each', ch && `${ch > 0 ? '+' : ''}${ch.toFixed(1)}% since last refresh`,
                c.manual != null && 'your value'].filter(Boolean).join(' · ');
  return `<div class="pocket" role="button" tabindex="0" data-key="${esc(c.key)}" title="${esc(info)}" aria-label="${esc(info)}">
    ${c.thumb ? `<img src="${esc(c.thumb)}" alt="" data-name="${esc(c.name)}" loading="lazy" decoding="async">` : `<span class="noimg">${esc(c.name)}</span>`}
    ${c.qty > 1 ? `<span class="qty">×${c.qty}</span>` : ''}${c.grader ? `<span class="slab">${esc(c.grader)} ${esc(c.grade ?? '')}</span>` : ''}
    <span class="tag">${tagUsd(c.price)}${ch ? `<i class="${ch > 0 ? 'up' : 'down'}">${ch > 0 ? '▲' : '▼'}</i>` : ''}</span></div>`;
}
// ponytail: a 5,000-card binder is ~560 sheets; empty sheets are tiny, so only ±1 page gets pockets and far ones are emptied.
function fillAround() {
  for (const s of $('#pages').children) {
    const i = +s.dataset.p, near = Math.abs(i - page) <= 1;
    if (near && !s.dataset.full) {
      s.innerHTML = HOLES + `<div class="grid9">${Array.from({ length: 9 }, (_, j) => pocketHTML(view[i * 9 + j])).join('')}</div>`;
      s.dataset.full = 1;
    } else if (!near && s.dataset.full && Math.abs(i - page) > 2) { s.innerHTML = HOLES; delete s.dataset.full; }
  }
}
function syncPager() {
  const n = pageCount();
  $('#pg').textContent = view.length ? `Page ${page + 1} of ${n}` : 'Empty binder · add cards from Search';
  $('#prev').disabled = page === 0; $('#next').disabled = page >= n - 1;
}
$('#pages').onscroll = () => {
  const el = $('#pages'), i = Math.round(el.scrollLeft / el.clientWidth);
  if (i !== page && i >= 0) { page = i; fillAround(); syncPager(); }
};
const smooth = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
const flip = d => { const el = $('#pages'); el.scrollTo({ left: (page + d) * el.clientWidth, behavior: smooth() }); };
$('#prev').onclick = () => flip(-1);
$('#next').onclick = () => flip(1);
$('#pages').onclick = e => { const p = e.target.closest('[data-key]'); if (p) openCard(null, null, cards.find(c => c.key === p.dataset.key)); };


// --- Binders ---
async function newBinder() {
  const n = await ask('Name your new binder', { input: true, color: 'Black' });
  if (n == null) return;
  if (nameProblem(n)) return tell(`Can't create binder: ${nameProblem(n)}.`);
  collections.push(n); colors[n] = pickedColor(); save('collections', 'colors'); render();
}
const ACTS = {
  async rename() {
    const n = await ask('Rename binder', { input: true, value: cur });
    if (n == null || n === cur) return;
    if (nameProblem(n)) return tell(`Can't rename: ${nameProblem(n)}.`);
    collections[collections.indexOf(cur)] = n;
    cards.forEach(c => { if (c.col === cur) c.col = n; });
    history.forEach(h => { if (h.by && cur in h.by) { h.by[n] = h.by[cur]; delete h.by[cur]; } });
    if (colors[cur]) { colors[n] = colors[cur]; delete colors[cur]; }
    cur = n; save('collections', 'cards', 'history', 'colors'); render();
  },
  async color() {
    if (!await ask(`Colour for ${cur}`, { color: colors[cur] ?? 'Black' })) return;
    colors[cur] = pickedColor(); save('colors'); render();
  },
  async delete() {
    let mine = 0; for (const c of cards) if (c.col === cur) mine++;
    if (collections.length === 1) return tell('You need at least one binder.');
    if (!await ask(`Delete "${cur}"${mine ? ` and its ${mine} card(s)` : ''}? Export a backup first if unsure.`)) return;
    cards = cards.filter(c => c.col !== cur); collections = collections.filter(n => n !== cur); delete colors[cur];
    cur = 'All'; save('collections', 'colors');
    commit();
  },
};
$('#menu').onclick = e => { const a = e.target.dataset.act; if (a) { $('#menu').open = false; ACTS[a](); } };
