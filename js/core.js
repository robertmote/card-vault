// Shared helpers, saved data (cards, binders, history, profile), price rules and the in-page message dialog.
// Loaded first: the other scripts use what is defined here.
const $ = s => document.querySelector(s);
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }); // one shared formatter; toLocaleString built a new one per call
const usd = n => n == null ? '—' : USD.format(n);
const SHORT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const tagUsd = n => n == null ? '—' : n < 100 ? USD.format(n) : SHORT.format(n); // price stickers: $8.40, $477, $1.3K
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ESC[ch]);
const byName = new Intl.Collator().compare; // much faster than localeCompare inside a sort
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

let cards = load('cards', []);      // {key, game, id, name, set, img, thumb, variant, market, col, qty, cond, grader, grade, manual, cost, price, prevPrice, added}
let history = load('history', []);  // {t, v: all-binders total, by: {binder: total}}
let collections = load('collections', ['Main']); // binder names, in shelf order
let colors = load('colors', {});    // {binder: colour name from COLORS}
let profile = load('profile', {});  // {name, email, photo (small JPEG data URL)}
// cur is the open binder's name, or 'All' while looking at the shelf.
let game = 'pokemon', range = 30, editing = null, editPrices = {}, cur = 'All', page = 0, view = [], T = null, searchCtl = null;

// Binder nylon colours: [cover/spine, lighter shade for meters and swatch rings].
const COLORS = { Black: ['#1a1a1c', '#8d8a84'], Navy: ['#1d2a44', '#6f8fc9'], Red: ['#3a1717', '#c9706a'], Green: ['#1f3324', '#6fae7f'], Tan: ['#4a3d28', '#c8ab72'] };
const colorOf = n => COLORS[colors[n]] ?? COLORS.Black;

// Older saves kept every printing's price on every card (~1 KB each, enough to fill browser storage at a few
// thousand cards). Now a card stores only its chosen printing's market price; the full list is fetched when editing.
const THUMB = { pokemon: u => u.replace('/high.webp', '/low.webp'), mtg: u => u.replace('/normal/', '/small/'), ygo: u => u.replace('/cards/', '/cards_small/') };
function migrate(c) {
  c.col ??= collections[0]; c.cond ??= 'Near Mint';
  c.key ??= crypto.randomUUID(); c.qty = Math.max(1, Math.round(+c.qty) || 1); // hand-edited backups: missing key, "2" as text
  if (!collections.includes(c.col)) collections.push(c.col); // otherwise its cards could never be selected
  if (c.prices) { c.market ??= c.prices[c.variant] ?? null; delete c.prices; }
  c.thumb ??= THUMB[c.game]?.(c.img || '') ?? c.img;
}
const oldFormat = cards.some(c => c.prices || c.thumb === undefined);
cards.forEach(migrate);

// Writes only the keys that changed; re-serializing everything (photo included) on every edit was wasted work.
function save(...keys) {
  const all = { cards, history, collections, colors, profile };
  try { for (const k of keys.length ? keys : Object.keys(all)) localStorage.setItem(k, JSON.stringify(all[k])); }
  catch (e) { tell(`Couldn't save (${e.name}). Browser storage may be full, so export a backup now.`); }
}
navigator.storage?.persist?.(); // ask the browser not to clear this site's storage when disk runs low
// Another open tab saved: reload, so this tab's stale copy can't overwrite those changes on its next save.
const DATA = ['cards', 'history', 'collections', 'colors', 'profile'];
addEventListener('storage', e => e.storageArea === localStorage && (e.key === null || DATA.includes(e.key)) && location.reload());

// Network errors surface as a bare TypeError ("Failed to fetch"); say what it means.
const why = e => e.name === 'TypeError' ? "couldn't reach the site, check your connection" : 'error ' + e.message;
// Small session cache so reopening a card shows every printing at once. Cleared on refresh.
const cached = (map, k, f) => { if (!map.has(k)) map.set(k, f().catch(e => { map.delete(k); throw e; })); return map.get(k); };
const details = new Map();
const getCard = (g, id) => cached(details, g + ':' + id, () => sources[g].get(id));

// ponytail: flat condition discounts off the Near Mint market price, roughly TCGplayer's typical spread.
// Real per-condition prices need a paid API; use "Your value" when it matters.
const COND = { 'Near Mint': 1, 'Lightly Played': 0.85, 'Moderately Played': 0.7, 'Heavily Played': 0.5, 'Damaged': 0.35 };
$('#dCond').innerHTML = Object.keys(COND).map(k => `<option>${k}</option>`).join('');
$('#askColors').innerHTML = Object.entries(COLORS).map(([k, [c, l]]) =>
  `<label style="--c:${c};--l:${l}" title="${k}"><input type="radio" name="bc" value="${k}" aria-label="${k}"></label>`).join('');

// Each card's price per copy: your own value wins, then market × condition (graded cards skip the condition discount).
const unitPrice = c => c.manual != null ? c.manual
  : c.market == null ? null : +(c.market * (c.grader ? 1 : COND[c.cond] ?? 1)).toFixed(2);


// Built-in prompt()/confirm()/alert() are silently blocked in some viewers, so use an in-page dialog.
// Resolves to the typed text (input mode), true (OK) or null (cancelled). With color, a binder colour
// picker shows too; read the choice with pickedColor().
function ask(msg, { input = false, value = '', cancel = true, color = null } = {}) {
  const d = $('#ask');
  $('#askMsg').textContent = msg;
  $('#askIn').classList.toggle('hidden', !input); $('#askIn').required = input; $('#askIn').value = value;
  $('#askColors').classList.toggle('hidden', !color);
  if (color) $(`#askColors input[value="${color}"]`).checked = true;
  $('#askCancel').classList.toggle('hidden', !cancel);
  d.returnValue = ''; d.showModal();
  return new Promise(res => d.addEventListener('close', () =>
    res(d.returnValue !== 'ok' ? null : input ? $('#askIn').value.trim() : true), { once: true }));
}
const tell = msg => ask(msg, { cancel: false });
const pickedColor = () => $('#askColors input:checked').value;
const nameProblem = n => !n ? 'empty' : n === 'All' ? `"${n}" is reserved` : collections.includes(n) ? `"${n}" already exists` : null;
