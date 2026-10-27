// --- Scanner: the camera reads a card's printed name and number, then the same price sites look it up ---
// ponytail: reads printed text (free) rather than recognising the artwork (paid services); glare or sleeves can
// defeat it, and Magic is matched by name so it lands on the default printing. Upgrade path: an image-match API.
const TESS = { src: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
               integrity: 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F' };
// Strips of the card the reader looks at, as fractions of its height: the name along the top, the Yu-Gi-Oh! set code
// just under the art, and the number/set line along the bottom.
const BANDS = { top: [.02, .14], mid: [.69, .8], bottom: [.86, 1] };
let ocr = null, stream = null, scanRun = 0, scanMode = 'check', paused = false, lastKey = null, armed = true, agree = null, session = [];
const lookups = new Map(); // text already looked up this session, so a card held still isn't re-fetched every frame
const norm = s => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
const textLines = t => t.split('\n').map(l => l.replace(/[^\p{L}\p{N} ,'’&-]/gu, ' ').replace(/\s+/g, ' ').trim()).filter(l => (l.match(/\p{L}/gu) || []).length >= 4);
const say = msg => $('#readout').textContent = msg;
const orNull = p => p.catch(() => null); // "no such card" answers come back as errors; remember them as misses

// The free text reader (Tesseract) downloads the first time the scanner opens (a few MB, then the browser caches it).
function reader() {
  ocr ??= (window.Tesseract ? Promise.resolve() : new Promise((ok, fail) => document.head.append(Object.assign(document.createElement('script'),
      { ...TESS, crossOrigin: 'anonymous', onload: ok, onerror: () => fail(new Error("couldn't download the text reader")) }))))
    .then(() => Tesseract.createWorker('eng'))
    .then(async w => { await w.setParameters({ tessedit_pageseg_mode: '6' }); return w; }); // 6 = read each strip as one block of text
  return ocr.catch(e => { ocr = null; throw e; });
}

// Each game turns the text read off a card ({ top, mid, bottom, all }) into candidate cards, best first: [{ game, id, variant? }].
const pkSets = () => cached(lookups, 'pk:sets', () => getJSON('https://api.tcgdex.net/v2/en/sets'));
const pkSet = id => cached(lookups, 'pk:' + id, () => getJSON(`https://api.tcgdex.net/v2/en/sets/${id}`));
// How alike two strings are, 0–1 (shared letter pairs), to rank names despite reader typos like "UmbreonVamax".
function alike(a, b) {
  const pairs = s => Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2));
  const x = pairs(a), y = pairs(b);
  let hit = 0; for (const p of x) { const i = y.indexOf(p); if (i >= 0) { hit++; y.splice(i, 1); } }
  return x.length + y.length + hit ? 2 * hit / (x.length + hit + y.length) : 0;
}
// Likely name words on a card's top line: drop "Evolves from X" and stage labels, split run-together words.
const STOP = new Set(['stage', 'basic', 'pokemon', 'evolves', 'trainer', 'restored', 'level']);
const nameWords = top => [...new Set(top.replace(/evolves from \S+/gi, ' ').split(/[^\p{L}]+|(?<=\p{Ll})(?=\p{Lu})/u)
  .filter(w => w.length >= 4 && !STOP.has(norm(w))))].sort((a, b) => b.length - a.length).slice(0, 2);
const best4 = list => list.sort((a, b) => b.score - a.score).slice(0, 4);

const MATCH = {
  async pokemon(t) {
    const sets = await pkSets(), out = [];
    const add = (c, score) => { const o = out.find(o => o.id === c.id); o ? o.score = Math.max(o.score, score) : out.push({ game: 'pokemon', id: c.id, score }); };
    // 1. "215/203" printed at the bottom: card 215 in a set of 203 cards (the set size narrows it to one or two sets)
    for (const [, n, of] of t.bottom.matchAll(/(\d{1,3})\s*[\/|\\]\s*(\d{2,3})/g))
      for (const set of sets.filter(s => s.cardCount?.official === +of)) {
        const c = (await pkSet(set.id)).cards.find(c => +c.localId === +n);
        if (c) add(c, 10 + alike(norm(c.name), norm(t.top)));
      }
    if (out.length) return best4(out);
    // 2. otherwise the name along the top; any numbers half-read at the bottom (a set size, a card number) pick the printing
    // The set size is the steadier clue (a bare card number like 91 turns up in many sets), so it counts for more.
    // (years such as "©1995-2000" are dropped first: they aren't clues)
    const nums = new Set((t.bottom.replace(/\b(19|20)\d\d\b/g, '').match(/\d{2,3}/g) || []).map(Number)), letters = s => norm(s).replace(/\d/g, '');
    for (const word of nameWords(t.top)) {
      // A misread name ("Chatizatd") finds nothing, so fall back to every card starting with its first three letters
      // and let the scoring below pick the closest name.
      const named = q => cached(lookups, 'pk:name:' + norm(q), () => getJSON(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(q)}`));
      let list = await named(word);
      if (!list.length) list = (await named(word.slice(0, 3))).filter(c => alike(norm(c.name).slice(0, word.length), norm(word)) > .5);
      // The name as read: its run of characters plus a short suffix word ("ex", "V", "GX") if one follows. Extra letters
      // like "UmbreonWaaxae" then favour "Umbreon VMAX" over plain "Umbreon".
      const [run = '', next = ''] = t.top.slice(Math.max(0, t.top.toLowerCase().indexOf(word.toLowerCase()))).split(/\s+/);
      const token = letters(run) + (letters(next).length <= 4 ? letters(next) : '');
      for (const c of list) {
        const name = norm(c.name), set = sets.find(s => s.id === c.id.slice(0, c.id.lastIndexOf('-')));
        const score = 3 * alike(name, token) - .1 * Math.abs(token.length - name.length) + 2.5 * nums.has(set?.cardCount?.official) + 1.5 * nums.has(+c.localId);
        if (score >= 1.5) add(c, score);
      }
    }
    return best4(out);
  },
  async ygo(t) {
    const out = [];
    // 1. a set code under the art (LOB-EN001) names the exact printing; readers often see O for 0 and I/L for 1
    for (const [, set, lang, num] of t.all.toUpperCase().matchAll(/\b([A-Z0-9]{2,5})-([A-Z]{0,2})([0-9OIL]{3})\b/g)) {
      const code = `${set}-${lang}${num.replace(/O/g, '0').replace(/[IL]/g, '1')}`;
      const r = await cached(lookups, 'ygo:' + code, () => orNull(getJSON(`https://db.ygoprodeck.com/api/v7/cardsetsinfo.php?setcode=${encodeURIComponent(code)}`)));
      if (r?.id && !out.some(o => o.variant === `${r.set_code} ${r.set_rarity}`)) out.push({ game: 'ygo', id: String(r.id), variant: `${r.set_code} ${r.set_rarity}` });
    }
    if (out.length) return out;
    // 2. otherwise the name along the top, trimming stray characters off the end until the lookup finds it
    for (const line of textLines(t.top).slice(0, 2)) {
      const words = line.split(' ').filter(w => /\p{L}{2}/u.test(w));
      for (let n = words.length; n >= Math.min(2, words.length) && n > 0; n--) {
        const q = words.slice(0, n).join(' ');
        const r = await cached(lookups, 'ygo:name:' + norm(q), () => orNull(getJSON(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(q)}`)));
        if (r?.data?.length) return best4(r.data.map(c => ({ game: 'ygo', id: String(c.id), score: alike(norm(c.name), norm(q)) })).filter(c => c.score > .6));
      }
    }
    return [];
  },
  async mtg(t) {
    // 1. "107/281 M" and "DMU • EN" along the bottom name the exact printing (the dot often reads as « or *)
    const set = t.bottom.toUpperCase().match(/\b([A-Z0-9]{3,5})\s*\W{0,3}\s*EN\b/);
    // older cards print "107/281"; newer ones just a zero-padded "0806"
    for (const [, a, b] of set ? t.bottom.matchAll(/\b(\d{1,4})\s*\/\s*\d{2,4}\b|\b(0\d{2,3})\b/g) : []) {
      const n = +(a ?? b);
      const c = await cached(lookups, `mtg:${set[1]}/${n}`, () => orNull(getJSON(`https://api.scryfall.com/cards/${set[1].toLowerCase()}/${n}`)));
      if (c) return [{ game: 'mtg', id: c.id }];
    }
    // 2. otherwise Scryfall's misspelling-tolerant name lookup on the top line, kept only if the name really resembles what was read
    for (const line of textLines(t.top).slice(0, 2)) {
      const c = await cached(lookups, 'mtg:' + norm(line), () => orNull(getJSON(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(line)}`)));
      if (c && alike(norm(c.name), norm(line)) > .5) return [{ game: 'mtg', id: c.id }];
    }
    return [];
  },
};
const pickVariant = p => ['holofoil', 'normal', '1stEditionHolofoil'].find(k => k in p) ?? Object.keys(p)[0] ?? 'none';

// Cut the strips this game needs out of the card, enlarged and in grey, and read each as a block of text.
// (Reading small print like "215/203" needs it several times bigger than a camera frame shows it.)
const NEED = { pokemon: ['top', 'bottom'], mtg: ['top', 'bottom'], ygo: ['top', 'mid'], custom: ['top', 'bottom'] };
const strip = document.createElement('canvas');
async function readStrips(src, sx, sy, sw, sh) {
  const w = await reader(), t = { top: '', mid: '', bottom: '' };
  for (const band of NEED[$('#scanGame').value]) {
    const [a, z] = BANDS[band], h = (z - a) * sh, W = 2000;
    strip.width = W; strip.height = Math.round(h * W / sw);
    const ctx = strip.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.4)';
    ctx.drawImage(src, sx, sy + a * sh, sw, h, 0, 0, W, strip.height);
    t[band] = (await w.recognize(strip)).data.text;
  }
  t.all = [t.top, t.mid, t.bottom].join('\n');
  return t;
}
// The camera picture is cropped to fill the screen, so map the on-screen corner guides back to the video's own pixels.
function grab() {
  const v = $('#scanVid'), g = $('.scan .guide').getBoundingClientRect(), b = v.getBoundingClientRect();
  const k = Math.max(b.width / v.videoWidth, b.height / v.videoHeight);
  return readStrips(v, (g.left - b.left - (b.width - v.videoWidth * k) / 2) / k, (g.top - b.top - (b.height - v.videoHeight * k) / 2) / k, g.width / k, g.height / k);
}

async function identify(t) {
  const g = $('#scanGame').value;
  if (g === 'custom') { const l = textLines(t.all); return l.length ? { custom: l.slice(0, 2).join(' ') } : null; }
  const [best, ...rest] = await MATCH[g](t);
  return best && { best, rest };
}

// The live loop: read the card in the corners about once a second, until the scanner closes.
async function scanLoop(run) {
  while (run === scanRun) {
    const v = $('#scanVid');
    if (!paused && !$('#dlg').open && !$('#ask').open && v.readyState >= 2) {
      try { await found(await identify(await grab())); }
      catch (e) { if (run === scanRun) { say(`Couldn't read that: ${why(e)}`); await pause(2000); } }
    }
    await pause(150);
  }
}

// deliberate = a photo the person chose, so skip the "two reads agree" and "same card still in view" guards.
async function found(r, deliberate = false) {
  if (!r) { armed = true; agree = null; return deliberate || say('Hold a card inside the corners'); }
  if (r.custom) { paused = true; return showSports(r.custom); }
  const key = `${r.best.game}:${r.best.id}:${r.best.variant ?? ''}`;
  if (!deliberate && key === lastKey && !armed) return; // the card just handled is still in view
  if (!deliberate && scanMode === 'add' && key !== agree) { agree = key; return say('Reading…'); } // auto-add waits for two matching reads
  agree = null; lastKey = key; armed = false;
  const d = await getCard(r.best.game, r.best.id), variant = r.best.variant in d.prices ? r.best.variant : pickVariant(d.prices);
  say(`✓ Read: ${d.name} · ${d.set}`);
  scanMode === 'add' ? addScanned(r.best, d, variant) : showCheck(r, d, variant);
}

// Price check: show the match, its price, and the next-best guesses. Nothing is saved from here.
let checkAlts = [];
async function showCheck(r, d, variant) {
  paused = true;
  const others = await Promise.all(r.rest.slice(0, 3).map(c => getCard(c.game, c.id).then(o => ({ c, o })).catch(() => null)));
  // other printings (a Yu-Gi-Oh! card can have dozens, so just the six priciest), then other likely cards
  const printings = Object.entries(d.prices).filter(([k]) => k !== variant).sort((a, b) => b[1] - a[1]).slice(0, 6);
  checkAlts = [...printings.map(([k]) => ({ label: k, go: () => showCheck(r, d, k) })),
               ...others.filter(Boolean).map(({ c, o }) => ({ label: `${o.name} · ${o.set}`, go: () => showCheck({ ...r, best: c, rest: [r.best] }, o, c.variant in o.prices ? c.variant : pickVariant(o.prices)) }))];
  $('#sheetBody').innerHTML = `<div class="res">${d.thumb ? `<img src="${esc(d.thumb)}" alt="" data-name="${esc(d.name)}">` : ''}
      <div><div class="nm">${esc(d.name)}</div><div class="sub">${esc(d.set)}${variant !== 'none' ? ' · ' + esc(variant) : ''}</div><div class="px">${usd(d.prices[variant])}</div></div></div>
    <div class="btns"><button type="button" class="btn ghost" data-act="again">Scan another</button><button type="button" class="btn" data-act="add">Add to a binder…</button></div>
    <div class="alts">Not this one? ${checkAlts.map((a, i) => `<button type="button" data-alt="${i}">${esc(a.label)}</button>`).join('')}<button type="button" data-act="search">Search instead</button></div>`;
  $('#scanSheet').classList.add('open');
  checkAlts.card = { game: r.best.game, id: r.best.id, name: d.name, variant };
}

// Sports and other cards have no price feed: start a card from the text that was read, to finish with your own value.
function showSports(text) {
  $('#sheetBody').innerHTML = `<div class="sub">Read from the card</div><div class="nm">${esc(text)}</div>
    <div class="btns"><button type="button" class="btn ghost" data-act="again">Scan again</button><button type="button" class="btn" data-act="sports">Start a card with this</button></div>`;
  $('#scanSheet').classList.add('open');
  checkAlts.card = { name: text };
}

// Add to binder: each recognised card goes straight in, with an undo and a running tray for this session.
function addScanned(best, d, variant) {
  const c = { key: crypto.randomUUID(), game: best.game, id: best.id, name: d.name, set: d.set, img: d.img, thumb: d.thumb, variant,
              market: d.prices[variant] ?? null, col: $('#scanCol').value, qty: 1, cond: $('#scanCond').value, grader: null, grade: null,
              manual: null, cost: null, prevPrice: null, added: Date.now() };
  c.price = unitPrice(c);
  cards.push(c); session.push(c); commit();
  note(`Added ${d.name} · ${usd(c.price)}`, () => { cards = cards.filter(x => x !== c); commit(); });
}
function renderTray() {
  session = session.filter(c => cards.includes(c)); // drops undone or removed cards
  $('#sheetBody').innerHTML = `<div class="tray">${session.map(c => `<button type="button" data-key="${esc(c.key)}" aria-label="Edit ${esc(c.name)}, ${usd(c.price)}">
      ${c.thumb ? `<img src="${esc(c.thumb)}" alt="" data-name="${esc(c.name)}">` : `<span class="noimg">${esc(c.name)}</span>`}<b>${tagUsd(c.price)}</b></button>`).join('')
      || '<p class="sub">Cards you scan appear here.</p>'}</div>
    <div class="tot"><div><div class="sub">${session.length} card${session.length === 1 ? '' : 's'} this session</div><div class="nm">${usd(session.reduce((s, c) => s + value(c), 0))}</div></div>
      <button type="button" class="btn" data-act="done">Done</button></div>`;
  $('.tray').scrollLeft = 1e6; // newest at the right, in view
}
let noteTimer;
function note(msg, undo) {
  const el = $('#note');
  el.innerHTML = `<span>${esc(msg)}</span><button type="button">Undo</button>`;
  el.querySelector('button').onclick = () => { undo(); el.classList.add('hidden'); say('Removed. Take that card away, then hold the next one in the corners'); }; // stays disarmed so it isn't re-added while still in view
  el.classList.remove('hidden');
  clearTimeout(noteTimer); noteTimer = setTimeout(() => el.classList.add('hidden'), 6000);
}

function setScanMode(m) {
  scanMode = m; paused = false; lastKey = null; armed = true; agree = null;
  document.querySelectorAll('[data-mode]').forEach(b => b.ariaPressed = b.dataset.mode === m);
  $('#scanCol').classList.toggle('hidden', m !== 'add'); $('#scanCond').classList.toggle('hidden', m !== 'add');
  $('#note').classList.add('hidden');
  if (m === 'add') { renderTray(); $('#scanSheet').classList.add('open'); } else { $('#scanSheet').classList.remove('open'); $('#sheetBody').innerHTML = ''; }
}

async function openScanner(mode) {
  $('#scanCol').innerHTML = collections.map(n => `<option>${esc(n)}</option>`).join('');
  $('#scanCol').value = cur === 'All' ? collections[0] : cur;
  $('#scanCond').innerHTML = Object.keys(COND).map(k => `<option>${k}</option>`).join('');
  // Game: inside a binder, whichever game it mostly holds; otherwise the last one used here.
  const held = {}; for (const c of cards) if (c.col === cur) held[c.game] = (held[c.game] ?? 0) + 1;
  let remembered = null; try { remembered = localStorage.getItem('scanGame'); } catch {}
  $('#scanGame').value = Object.entries(held).sort((a, b) => b[1] - a[1])[0]?.[0] ?? remembered ?? (game === 'custom' ? 'pokemon' : game);
  session = []; setScanMode(mode);
  $('#scan').showModal();
  const run = ++scanRun;
  say('Getting the text reader ready… (first time takes a moment)');
  // (only once the camera is running, so a "camera isn't available" message stays up)
  reader().then(() => run === scanRun && stream && say('Hold a card inside the corners'), e => run === scanRun && say(`${why(e)}. Check your connection.`));
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera access');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    if (run !== scanRun) return stream.getTracks().forEach(t => t.stop()); // closed while the permission prompt was up
    $('#scanVid').srcObject = stream; await $('#scanVid').play();
    $('#torch').classList.toggle('hidden', !stream.getVideoTracks()[0].getCapabilities?.().torch);
  } catch {
    say("The live camera isn't available here (it needs permission, and on phones an https address). Use a photo instead.");
  }
  scanLoop(run);
}
// Leaving the scanner (✕, Esc, Done, or switching away from the app) always turns the camera off and frees the reader.
$('#scan').addEventListener('close', () => {
  scanRun++; paused = false;
  stream?.getTracks().forEach(t => t.stop()); stream = null; $('#scanVid').srcObject = null;
  $('#torch').classList.add('hidden'); $('#torch').ariaPressed = 'false';
  const old = ocr; ocr = null; // ~tens of MB while loaded; reloads from the browser's cache next time
  setTimeout(() => old?.then(w => w.terminate()).catch(() => {}), 3000); // after any read in progress has finished
});
document.addEventListener('visibilitychange', () => document.hidden && $('#scan').open && $('#scan').close());

$('#scanOpen').onclick = () => openScanner('check');
$('#scanBinder').onclick = () => openScanner('add');
document.querySelector('#scan .seg').onclick = e => { const m = e.target.dataset.mode; if (m) setScanMode(m); };
$('#scanGame').onchange = e => { try { localStorage.setItem('scanGame', e.target.value); } catch {} lastKey = null; armed = true; };
$('#torch').onclick = async e => {
  const on = e.currentTarget.ariaPressed !== 'true';
  try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: on }] }); e.currentTarget.ariaPressed = on; } catch {}
};
$('#scanPhoto').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  paused = true; say('Reading the photo…');
  try {
    const img = await createImageBitmap(f); // treated as the card itself, so crop the photo to the card for best results
    const r = await identify(await readStrips(img, 0, 0, img.width, img.height));
    img.close();
    if (!r) say("Couldn't find a card in that photo. Crop it to just the card, straight on, or use Search.");
    await found(r, true);
  } catch (err) { say(`Couldn't read that photo: ${why(err)}`); }
  if (!(scanMode === 'check' && $('#scanSheet').classList.contains('open'))) paused = false; // keep the live camera going unless a result is showing
};
$('#scanSheet').onclick = async e => {
  const alt = e.target.closest('[data-alt]'), act = e.target.closest('[data-act]')?.dataset.act, tray = e.target.closest('.tray [data-key]');
  if (alt) return checkAlts[+alt.dataset.alt].go();
  if (tray) return openCard(null, null, cards.find(c => c.key === tray.dataset.key));
  const c = checkAlts.card;
  if (act === 'again') { scanMode === 'add' ? renderTray() : $('#scanSheet').classList.remove('open'); paused = false; armed = false; say('Hold a card inside the corners'); }
  if (act === 'done') $('#scan').close();
  if (act === 'add') { await openCard(c.game, c.id); if (c.variant in editPrices) { $('#dVariant').value = c.variant; syncManual(); } }
  if (act === 'sports') { $('#q').value = c.name; openCard('custom'); }
  if (act === 'search') {
    const g = $('#scanGame').value;
    $('#scan').close();
    document.querySelector('[data-tab=search]').click(); document.querySelector(`[data-game="${g}"]`).click();
    $('#q').value = c.name ?? ''; $('#searchForm').requestSubmit();
  }
};
