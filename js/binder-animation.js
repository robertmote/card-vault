// Opening a binder: the spine slides up off the shelf, turns face-on as it grows to full size, then the cover
// swings open on its left edge to show the pages. Going back plays the same steps in reverse. Only transform
// and opacity animate, so it stays smooth on phones.
const MS = { pull: 220, turn: 380, open: 480 }; // tune the feel here
const EASE = 'cubic-bezier(.2,.8,.2,1)', SWING = 'cubic-bezier(.5,0,.3,1)';
const LIFT = 'translateY(-30px) scale(1.06)'; // a spine pulled partway out of the shelf
const OPENED = 'rotateY(-115deg)';             // the cover swung open toward you
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const spineOf = n => document.querySelector(`#shelves [data-bind="${CSS.escape(n)}"]`);
let shelfY = 0; // how far the shelf was scrolled when a binder came off it, to return to the same spot

// The layer the animation plays on: it dims the page behind and blocks taps until the animation ends.
function fxLayer() {
  const fx = Object.assign(document.createElement('div'), { className: 'fx' });
  fx.innerHTML = '<div class="fx-bg"></div>';
  document.body.append(fx);
  return fx;
}
const dim = (fx, on, ms, easing = 'linear') =>
  fx.firstChild.animate([{ opacity: on ? 0 : 1 }, { opacity: on ? 1 : 0 }], { duration: ms, easing, fill: 'forwards' }).finished;
// A copy of a spine placed exactly over the real one (which is hidden meanwhile).
function spineCopy(fx, spine) {
  // a leaning spine: measure it upright, then give the copy the same lean so nothing snaps at the end
  const m = new DOMMatrix(getComputedStyle(spine).transform), lean = Math.atan2(m.b, m.a) * 180 / Math.PI;
  spine.style.transform = 'none';
  const r = spine.getBoundingClientRect(), copy = spine.cloneNode(true);
  spine.style.transform = '';
  Object.assign(copy.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', visibility: '', transform: '',
                              rotate: lean + 'deg', transformOrigin: 'bottom left' });
  spine.style.visibility = 'hidden';
  fx.append(copy);
  return copy;
}
// A full-size binder cover laid over the open binder (its header down to the page arrows).
function coverOver(fx, name) {
  const head = $('#head').getBoundingClientRect();
  const r = { left: head.left, top: head.top, width: head.width, height: Math.min($('#binder').getBoundingClientRect().bottom, innerHeight - 80) - head.top };
  const book = Object.assign(document.createElement('div'), { className: 'fx-book cover' });
  book.style.cssText = `--c:${colorOf(name)[0]};left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  book.innerHTML = `<span class="t">${esc(name)}</span><span class="zip"></span>`;
  fx.append(book);
  return { book, r };
}
// The transform that squeezes the cover (at rect r) down onto a lifted spine (at rect s), turned edge-on.
const ontoSpine = (r, s) => `translate(${s.left - r.left}px,${s.top - r.top}px) scale(${s.width / r.width},${s.height / r.height}) rotateY(60deg)`;

async function openBinder(spine) {
  if ($('.fx')) return; // one at a time
  const name = spine.dataset.bind;
  const show = () => { cur = name; page = 0; render(); scrollTo(0, 0); };
  shelfY = scrollY;
  if (!still()) {
    const fx = fxLayer();
    try {
      // 1. pull: the spine rises out of the shelf while the room dims
      const copy = spineCopy(fx, spine);
      await Promise.all([copy.animate([{ transform: 'none' }, { transform: LIFT }], { duration: MS.pull, easing: EASE, fill: 'forwards' }).finished, dim(fx, true, MS.pull)]);
      // 2. turn: swap the binder in underneath, then grow it from the lifted spine to full size
      const s = copy.getBoundingClientRect();
      copy.remove(); show();
      const { book, r } = coverOver(fx, name);
      book.style.transformOrigin = 'top left';
      await book.animate([{ transform: ontoSpine(r, s) }, { transform: 'none' }], { duration: MS.turn, easing: EASE }).finished;
      // 3. open: the cover swings toward you on its left edge and the pages show through
      book.style.transformOrigin = 'left center';
      await Promise.all([book.animate([{ transform: 'none', opacity: 1 }, { transform: OPENED, opacity: 0 }], { duration: MS.open, easing: SWING }).finished,
                         dim(fx, false, MS.open, 'ease-in')]);
    } finally { fx.remove(); } // never leave the tap-blocking layer up, even if a step fails
  }
  if (cur !== name) show();
  $('#back').focus({ preventScroll: true }); // keyboard users land inside the binder, on its way back out
}

async function closeBinder() {
  if ($('.fx')) return;
  const name = cur;
  const back = () => { cur = 'All'; render(); scrollTo(0, shelfY); spineOf(name)?.scrollIntoView({ block: 'nearest' }); };
  if (!still()) {
    const fx = fxLayer();
    try {
      // 1. close: the cover swings shut over the pages while the room dims
      const { book, r } = coverOver(fx, name);
      book.style.transformOrigin = 'left center';
      await Promise.all([book.animate([{ transform: OPENED, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: MS.open, easing: SWING }).finished,
                         dim(fx, true, MS.open, 'ease-out')]);
      // 2. turn: swap the shelf in underneath, then shrink the binder down onto its spine, held just above its slot
      back();
      const spine = spineOf(name), copy = spineCopy(fx, spine);
      copy.style.transform = LIFT; copy.style.visibility = 'hidden';
      const s = copy.getBoundingClientRect();
      book.style.transformOrigin = 'top left';
      await book.animate([{ transform: 'none' }, { transform: ontoSpine(r, s) }], { duration: MS.turn, easing: EASE, fill: 'forwards' }).finished;
      // 3. slide: the spine drops back into its slot as the room brightens
      book.remove(); copy.style.visibility = '';
      await Promise.all([copy.animate([{ transform: LIFT }, { transform: 'none' }], { duration: MS.pull, easing: EASE, fill: 'forwards' }).finished,
                         dim(fx, false, MS.pull)]);
    } finally { fx.remove(); }
  }
  if (cur !== 'All') back();
  const spine = spineOf(name);
  if (spine) { spine.style.visibility = ''; spine.focus({ preventScroll: true }); } // focus returns to the binder you came from
}
$('#back').onclick = closeBinder;
