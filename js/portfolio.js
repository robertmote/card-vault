// Totals, history snapshots, rendering of the header/chart/profile figures, and price refresh.
// --- Portfolio ---
const value = c => (c.price || 0) * c.qty;
const GAMES = { pokemon: 'Pokémon', mtg: 'Magic', ygo: 'Yu-Gi-Oh!', custom: 'Sports / Other' };

// One pass over the cards gives every total the UI needs.
function tally() {
  const blank = () => ({ qty: 0, val: 0, cost: 0 });
  const t = { all: blank(), view: blank(), col: Object.fromEntries(collections.map(n => [n, blank()])), game: {} };
  const add = (b, c, v, k) => { b.qty += c.qty; b.val += v; b.cost += k; };
  for (const c of cards) {
    const v = value(c), k = (c.cost || 0) * c.qty;
    add(t.all, c, v, k); add(t.col[c.col] ??= blank(), c, v, k); add(t.game[c.game] ??= blank(), c, v, k);
    if (cur === 'All' || c.col === cur) add(t.view, c, v, k);
  }
  return t;
}

function snapshot(t) {
  const now = Date.now(), last = history.at(-1);
  const pt = { t: now, v: +t.all.val.toFixed(2), by: Object.fromEntries(collections.map(n => [n, +t.col[n].val.toFixed(2)])) };
  // ponytail: one point per hour max, keeps localStorage small
  if (last && now - last.t < 36e5) Object.assign(last, pt); else history.push(pt);
  save('cards', 'history');
}
// Every change to cards ends the same way: total once, record the history point, redraw.
function commit() { const t = tally(); snapshot(t); render(t); if ($('#scan').open && scanMode === 'add') renderTray(); } // the scan tray follows edits too

// Rendering is split so a sort change only redraws the pages, and a range change only the chart.
function render(t = tally()) { T = t; renderSummary(t); renderChart(t); cur === 'All' ? renderShelf(t) : renderPages(); }

function renderSummary(t) {
  const shelf = cur === 'All';
  for (const id of ['#back', '#menu', '#binder', '#sort', '#scanBinder']) $(id).classList.toggle('hidden', shelf);
  $('#shelves').classList.toggle('hidden', !shelf);
  $('#head').classList.toggle('cover', !shelf);
  $('#head').style.setProperty('--c', colorOf(cur)[0]);
  $('#headLbl').textContent = shelf ? 'Your collection' : cur;

  // Profile always covers every binder, whatever is open on the Binders tab.
  $('#pCount').textContent = t.all.qty;
  $('#pValue').textContent = usd(t.all.val);
  breakdown('#pByCol', collections.map(n => [n, t.col[n], colorOf(n)[1]]), t.all.val);
  breakdown('#pByGame', Object.entries(GAMES).filter(([g]) => t.game[g]).map(([g, label]) => [label, t.game[g], 'var(--cream)']), t.all.val);

  const g = t.view.val - t.view.cost;
  $('#total').textContent = usd(t.view.val);
  $('#count').textContent = t.view.qty;
  $('#cost').textContent = usd(t.view.cost);
  $('#gain').textContent = usd(g); $('#gain').className = g >= 0 ? 'up' : 'down';
}

function breakdown(el, groups, all) {
  $(el).innerHTML = groups.map(([label, b, color]) => {
    const pct = all ? b.val / all * 100 : 0;
    return `<div class="brk"><div class="top"><div>${esc(label)}<div class="sub">${b.qty} cards</div></div>
      <div class="right"><b>${usd(b.val)}</b><div class="sub">${pct.toFixed(1)}%</div></div></div>
      <div class="meter"><div style="width:${pct}%;background:${color}"></div></div></div>`;
  }).join('') || '<p class="sub">No cards yet.</p>';
}

function renderChart(t) {
  const total = t.view.val, since = range ? Date.now() - range * 864e5 : 0, pts = [];
  for (const h of history) { const v = cur === 'All' ? h.v : h.by?.[cur]; if (h.t >= since && v != null) pts.push({ t: h.t, v }); }
  const first = pts[0]?.v ?? total, diff = total - first;
  $('#chart').setAttribute('aria-label', pts.length > 1 ? `Value chart: ${diff >= 0 ? 'up' : 'down'} ${usd(Math.abs(diff))} over ${range ? range + ' days' : 'all time'}` : 'Value chart: not enough history yet');
  $('#change').innerHTML = pts.length > 1
    ? `<span class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${usd(Math.abs(diff))} (${first ? (diff / first * 100).toFixed(2) : '0.00'}%)</span> <span class="sub">${range ? range + 'D' : 'all time'}</span>`
    : '<span class="sub">Refresh prices over time to build your chart</span>';
  drawChart(pts, diff >= 0);
  $('#ranges').innerHTML = [[7, '7D'], [30, '1M'], [90, '3M'], [365, '1Y'], [0, 'ALL']]
    .map(([d, l]) => `<button data-r="${d}" class="${d === range ? 'on' : ''}" aria-pressed="${d === range}">${l}</button>`).join('');
}

function drawChart(pts, up) {
  const svg = $('#chart');
  if (pts.length < 2) return svg.innerHTML = '';
  // ponytail: stride-sample to ~the chart's 300 px width; a year of hourly points was 8,000+ SVG vertices
  const step = Math.ceil(pts.length / 300);
  if (step > 1) pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  let lo = Infinity, hi = -Infinity; // a loop, since Math.min(...bigArray) can overflow the call stack
  for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
  const t0 = pts[0].t, t1 = pts.at(-1).t;
  const xy = pts.map(p => `${((p.t - t0) / (t1 - t0 || 1) * 300).toFixed(1)},${(95 - (p.v - lo) / (hi - lo || 1) * 90).toFixed(1)}`).join(' ');
  const col = up ? 'var(--up)' : 'var(--down)';
  svg.innerHTML = `<polygon points="0,100 ${xy} 300,100" fill="${col}" opacity=".12"/><polyline points="${xy}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
}


async function refresh() {
  const btn = $('#refresh'), groups = {};
  for (const c of cards) if (sources[c.game]) (groups[c.game] ??= new Set()).add(String(c.id));
  const total = Object.values(groups).reduce((s, g) => s + g.size, 0);
  if (!total) return $('#status').textContent = 'Nothing to refresh: sports and custom cards use your own value.';
  let done = 0;
  const tick = n => { done += n; btn.textContent = `Refreshing ${done}/${total}…`; };
  btn.disabled = true; details.clear();
  try {
    const prices = Object.fromEntries(await Promise.all(Object.entries(groups).map(async ([g, ids]) => [g, await sources[g].getMany([...ids], tick)])));
    for (const c of cards) {
      const m = prices[c.game]?.get(String(c.id))?.[c.variant];
      if (m == null) continue;
      c.market = m; c.prevPrice = c.price; c.price = unitPrice(c);
    }
    commit();
    const got = Object.values(prices).reduce((s, m) => s + m.size, 0);
    $('#status').textContent = got === total ? `Updated ${total} cards.`
      : got ? `Updated ${got} of ${total} cards. The rest couldn't be reached; try again later.`
      : "Couldn't reach the price sites. Check your connection and try again.";
  } finally { btn.disabled = false; btn.textContent = 'Refresh prices'; }
}
