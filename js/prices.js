// --- Price sources: TCGdex (Pokémon), Scryfall (MTG), YGOPRODeck (Yu-Gi-Oh!). All free, no key, TCGplayer USD prices. ---
async function getJSON(url, opts) { const r = await fetch(url, opts); if (!r.ok) throw new Error(r.status); return r.json(); }
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const pause = ms => new Promise(r => setTimeout(r, ms));

const pkPrices = d => {
  const p = {};
  for (const [k, v] of Object.entries(d.pricing?.tcgplayer || {})) if (v?.marketPrice != null) p[k] = v.marketPrice;
  return p;
};
const mtgPrices = c => {
  const p = {};
  if (c.prices.usd) p.normal = +c.prices.usd;
  if (c.prices.usd_foil) p.foil = +c.prices.usd_foil;
  if (c.prices.usd_etched) p.etched = +c.prices.usd_etched;
  return p;
};
const ygoPrices = c => {
  const p = {}, any = +c.card_prices?.[0]?.tcgplayer_price;
  if (any) p['Cheapest printing'] = any;
  for (const s of c.card_sets || []) if (+s.set_price) p[`${s.set_code} ${s.set_rarity}`] = +s.set_price;
  return p;
};
const mtgImg = (c, size) => (c.image_uris || c.card_faces?.[0]?.image_uris || {})[size] || '';

// get(id) → one card's details. getMany(ids, onProgress) → Map(id → prices) for a price refresh.
const sources = {
  pokemon: {
    async search(q, signal) {
      const list = await getJSON(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(q)}&pagination:itemsPerPage=60`, { signal });
      return list.filter(c => c.image).map(c => ({ id: c.id, name: c.name, img: c.image + '/low.webp', sub: c.id }));
    },
    async get(id) {
      const d = await getJSON(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`);
      return { name: d.name, set: `${d.set?.name ?? ''} · ${d.localId}`, img: d.image ? d.image + '/high.webp' : '',
               thumb: d.image ? d.image + '/low.webp' : '', prices: pkPrices(d) };
    },
    // TCGdex has no batch endpoint, so run 6 requests at a time instead of one after another.
    async getMany(ids, onProgress) {
      const out = new Map();
      let next = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        for (let id; (id = ids[next++]) != null; onProgress(1)) {
          try { out.set(id, (await this.get(id)).prices); } catch (e) { console.warn('TCGdex price fetch failed', id, e); }
        }
      }));
      return out;
    },
  },
  mtg: {
    async search(q, signal) {
      const r = await fetch(`https://api.scryfall.com/cards/search?unique=prints&q=${encodeURIComponent(q)}`, { signal });
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(r.status);
      return (await r.json()).data.map(c => ({ id: c.id, name: c.name, img: mtgImg(c, 'small'), sub: `${c.set.toUpperCase()} #${c.collector_number}` }));
    },
    async get(id) {
      const c = await getJSON(`https://api.scryfall.com/cards/${encodeURIComponent(id)}`);
      return { name: c.name, set: `${c.set_name} · #${c.collector_number}`, img: mtgImg(c, 'normal'), thumb: mtgImg(c, 'small'), prices: mtgPrices(c) };
    },
    // Scryfall's /cards/collection returns up to 75 cards per request.
    async getMany(ids, onProgress) {
      const out = new Map();
      for (const part of chunk(ids, 75)) {
        try {
          const r = await getJSON('https://api.scryfall.com/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifiers: part.map(id => ({ id })) }) });
          for (const c of r.data) out.set(c.id, mtgPrices(c));
        } catch (e) { console.warn('Scryfall batch failed', e); }
        onProgress(part.length);
        await pause(100); // Scryfall asks for 50–100 ms between requests
      }
      return out;
    },
  },
  ygo: {
    async search(q, signal) {
      const r = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(q)}&num=60&offset=0`, { signal });
      if (r.status === 400) return []; // YGOPRODeck answers "no match" with a 400
      if (!r.ok) throw new Error(r.status);
      return (await r.json()).data.map(c => ({ id: c.id, name: c.name, img: c.card_images?.[0]?.image_url_small, sub: c.type }));
    },
    async get(id) {
      const c = (await getJSON(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${encodeURIComponent(id)}`)).data[0];
      return { name: c.name, set: c.type, img: c.card_images?.[0]?.image_url, thumb: c.card_images?.[0]?.image_url_small, prices: ygoPrices(c) };
    },
    // YGOPRODeck accepts a comma-separated id list.
    async getMany(ids, onProgress) {
      const out = new Map();
      for (const part of chunk(ids, 50)) {
        try {
          const r = await getJSON(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${part.map(encodeURIComponent).join(',')}`);
          for (const c of r.data) out.set(String(c.id), ygoPrices(c));
        } catch (e) { console.warn('YGOPRODeck batch failed', e); }
        onProgress(part.length);
        await pause(60); // stays under their 20 requests/second limit
      }
      return out;
    },
  },
};
