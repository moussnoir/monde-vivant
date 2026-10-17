// Monde Vivant — conversion OpenStreetMap (Overpass) -> format compact du jeu (models/osm/<clé>.json)
//
// Format produit (identique aux fichiers déjà présents dans models/osm/) :
//   { city, lat, lon, R,
//     b:  [[cx, cz, w, d, angle, hauteur, type, remplissage, couleur], ...]   bâtiments (boîtes orientées)
//     r:  [[classe, largeur, indexNom, revêtement, [[x,z],...]], ...]        routes
//     n:  ["Nom de rue", ...]                                                noms référencés par r[i][2]
//     w:  [[[x,z],...], ...]                                                 plans d'eau
//     p:  [["park"|"garden"|..., [[x,z],...]], ...]                          espaces verts
//     rl: [[[x,z],...], ...]                                                 voies ferrées
//     am: [["school"|"hospital"|..., nom, x, z, ""], ...]                    équipements
//   }
// Repère : x = mètres vers l'est, z = mètres vers le sud (z négatif = nord), origine = centre de la ville.

const ENV_URLS = typeof process !== 'undefined' && process.env ? process.env.OVERPASS_URLS : '';
export const OVERPASS_URLS = (ENV_URLS || 'https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://overpass.kumi.systems/api/interpreter')
  .split(',').map(s => s.trim()).filter(Boolean);

// Clé de fichier, identique à osmKey() dans index.html pour les villes du monde
export const wNorm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const cityKey = (name, iso) => wNorm(name).replace(/[^a-z0-9]+/g, '_') + '_' + iso.toLowerCase();

const r1 = v => Math.round(v * 10) / 10;
const r3 = v => Math.round(v * 1000) / 1000;

// équipements repris dans le jeu (am) : centres commerciaux, commerces, services
const AMENITIES = 'school|university|college|hospital|clinic|pharmacy|marketplace|place_of_worship|fuel|restaurant|fast_food|cafe|bar|bank|atm|post_office|police|cinema|theatre|townhall|bus_station|library';
const SHOPS = 'mall|department_store|supermarket|convenience|bakery|butcher|clothes|shoes|hairdresser|beauty|electronics|mobile_phone|hardware|furniture|car|car_repair|tailor|books|jewelry|optician';
// type de point d'intérêt -> catégorie du jeu
export function poiType(t) {
  if (t.shop === 'mall' || t.shop === 'department_store') return 'mall';
  if (t.shop === 'supermarket') return 'supermarket';
  if (t.shop) return 'shop:' + t.shop;
  if (t.tourism) return t.tourism;
  if (t.leisure) return t.leisure;
  return t.amenity;
}

// zone : soit un cercle (around:R,lat,lon), soit un rectangle (s,w,n,e) pour les tuiles du monde ouvert
function query(lat, lon, R, box) {
  if (box) return queryArea(`(${box.join(',')})`, `(${box.join(',')})`);
  const RR = Math.round(R * 1.6);
  return queryArea(`(around:${R},${lat},${lon})`, `(around:${RR},${lat},${lon})`);
}
function queryArea(A, AR) {
  return `[out:json][timeout:180][maxsize:536870912];
(
  way["building"]${A};
  relation["building"]["type"="multipolygon"]${A};
)->.bld;
.bld out geom;
way["highway"]${AR};
out geom;
way["railway"~"^(rail|light_rail|subway|narrow_gauge)$"]["tunnel"!="yes"]${AR};
out geom;
(
  way["natural"="water"]${A};
  way["waterway"="riverbank"]${A};
  relation["natural"="water"]${A};
  way["leisure"~"^(park|garden|pitch|recreation_ground|dog_park|playground)$"]${A};
  way["landuse"~"^(grass|forest|recreation_ground|cemetery|meadow|village_green)$"]${A};
  way["natural"="wood"]${A};
);
out geom;
(
  nwr["amenity"~"^(${AMENITIES})$"]${A};
  nwr["shop"~"^(${SHOPS})$"]${A};
  nwr["tourism"~"^(hotel|museum|attraction)$"]${A};
  nwr["leisure"~"^(stadium|sports_centre)$"]${A};
);
out center tags;`;
}

export async function fetchOverpass(lat, lon, R, { log = () => {}, signal, box } = {}) {
  const body = 'data=' + encodeURIComponent(query(lat, lon, R, box));
  let lastErr;
  for (const url of OVERPASS_URLS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        log(`Overpass ${url} (essai ${attempt + 1})`);
        const res = await fetch(url, {
          method: 'POST', body,
          headers: typeof window === 'undefined' ? { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'MondeVivant-osm/1.0 (github.com)' } : { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: signal || AbortSignal.timeout(240000),
        });
        if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
        return await res.json();
      } catch (e) {
        lastErr = e; log('  échec : ' + e.message);
        if (signal && signal.aborted) throw e;
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
  }
  throw lastErr || new Error('Overpass indisponible');
}

// ---------- géométrie ----------
function projector(lat0, lon0) {
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), kz = 110540;
  return (lat, lon) => [(lon - lon0) * kx, -(lat - lat0) * kz];
}
function area(pts) { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % n]; a += x0 * z1 - x1 * z0; } return Math.abs(a) / 2; }

// boîte orientée de surface minimale (on teste l'orientation de chaque arête)
function obb(pts) {
  let best = null;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % n];
    const L = Math.hypot(x1 - x0, z1 - z0); if (L < 0.3) continue;
    const a = Math.atan2(z1 - z0, x1 - x0), c = Math.cos(a), s = Math.sin(a);
    let mnu = 1e9, mxu = -1e9, mnv = 1e9, mxv = -1e9;
    for (const [x, z] of pts) { const u = x * c + z * s, v = -x * s + z * c; if (u < mnu) mnu = u; if (u > mxu) mxu = u; if (v < mnv) mnv = v; if (v > mxv) mxv = v; }
    const w = mxu - mnu, d = mxv - mnv, A = w * d;
    if (!best || A < best.A) { const cu = (mnu + mxu) / 2, cv = (mnv + mxv) / 2; best = { A, w, d, a, cx: cu * c - cv * s, cz: cu * s + cv * c }; }
  }
  return best;
}

// ---------- classification ----------
function buildingKind(t) {
  const b = t.building || 'yes';
  if (t.shop || t.amenity === 'marketplace' || /^(commercial|retail|supermarket|kiosk|shop|mall|hotel|department_store)$/.test(b)) return 3;
  if (/^(apartments|residential|dormitory|flats)$/.test(b)) return 2;
  if (/^(house|detached|semidetached_house|terrace|bungalow|villa|farm)$/.test(b)) return 1;
  if (/^(office|bank)$/.test(b)) return 4;
  if (/^(industrial|warehouse|factory|manufacture|hangar|service)$/.test(b)) return 5;
  if (/^(school|university|college|hospital|church|mosque|cathedral|chapel|temple|shrine|synagogue|public|civic|government|train_station|transportation|kindergarten|stadium|sports_hall)$/.test(b)) return 6;
  if (/^(hut|shed|cabin|garage|garages|roof|carport|kiosk|toilets)$/.test(b)) return 7;
  if (/^(construction|ruins|container|greenhouse)$/.test(b)) return 8;
  return 0;
}
function buildingHeight(t) {
  const num = v => { const m = /^\s*([\d.]+)/.exec(v || ''); return m ? parseFloat(m[1]) : NaN; };
  const h = num(t.height); if (h > 0) return r1(h);
  const lv = num(t['building:levels']); if (lv > 0) return r1(lv * 3.1 + 1);
  return 0;
}
const ROAD = {
  motorway: [0, 14], motorway_link: [0, 12], trunk: [1, 11], trunk_link: [1, 9], primary: [1, 9], primary_link: [2, 8],
  secondary: [2, 8], secondary_link: [3, 6], tertiary: [3, 6], tertiary_link: [3, 6], residential: [3, 6], living_street: [3, 5],
  unclassified: [3, 5], road: [3, 5], service: [4, 4], track: [5, 5], pedestrian: [5, 5], busway: [4, 4],
  footway: [6, 2], path: [6, 2], bridleway: [6, 2], corridor: [6, 1.5], steps: [6, 1.5], cycleway: [7, 3],
};

function ringsOf(el, P) {
  if (el.type === 'way' && el.geometry) return [el.geometry.map(g => P(g.lat, g.lon))];
  if (el.type === 'relation' && el.members) return el.members.filter(m => m.role === 'outer' && m.geometry).map(m => m.geometry.map(g => P(g.lat, g.lon)));
  return [];
}
const closed = pts => pts.length >= 4 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 0.5;
const rnd = pts => pts.map(([x, z]) => [r1(x), r1(z)]);

// simplification Douglas-Peucker légère (réduit la taille des fichiers)
function simplify(pts, eps = 0.6) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [i, j] = st.pop(); const [ax, az] = pts[i], [bx, bz] = pts[j]; const L = Math.hypot(bx - ax, bz - az) || 1e-9;
    let md = -1, mk = -1;
    for (let k = i + 1; k < j; k++) { const d = Math.abs((bx - ax) * (az - pts[k][1]) - (ax - pts[k][0]) * (bz - az)) / L; if (d > md) { md = d; mk = k; } }
    if (md > eps) { keep[mk] = 1; st.push([i, mk], [mk, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

// anneau fermé : on coupe en deux moitiés pour que Douglas-Peucker ne l'écrase pas
function simplifyRing(pts, eps) {
  if (pts.length < 8) return pts;
  const m = pts.length >> 1;
  return simplify(pts.slice(0, m + 1), eps).concat(simplify(pts.slice(m), eps).slice(1));
}

export function convert(osm, { key, lat, lon, R, keep }) {
  const inside = keep || ((x, z) => Math.hypot(x, z) <= R * 1.05);
  const P = projector(lat, lon);
  const out = { city: key, lat: r3(lat), lon: r3(lon), R, b: [], r: [], n: [], w: [], p: [], rl: [], am: [] };
  const names = new Map();
  const nameIdx = s => { if (!s) return -1; if (!names.has(s)) { names.set(s, out.n.length); out.n.push(s); } return names.get(s); };
  const seen = new Set();

  for (const el of osm.elements || []) {
    const id = el.type + el.id; if (seen.has(id)) continue; seen.add(id);
    const t = el.tags || {};

    if (t.building && t.building !== 'no' && el.type !== 'node') {
      for (let ring of ringsOf(el, P)) {
        if (ring.length < 4) continue; ring = ring.slice(0, -1);
        const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
        if (!inside(c[0], c[1])) continue;
        const o = obb(ring); if (!o || o.w < 1.5 || o.d < 1.5) continue;
        let { w, d, a } = o; if (d > w) { [w, d] = [d, w]; a += Math.PI / 2; }
        a = Math.atan2(Math.sin(a), Math.cos(a));
        const fill = Math.min(1, area(ring) / (w * d));
        const row = [r1(o.cx), r1(o.cz), r1(w), r1(d), r3(a), buildingHeight(t), buildingKind(t), Math.round(fill * 100) / 100, t['building:colour'] || ''];
        // contour réel (repère local du bâtiment) pour les formes non rectangulaires : L, U, cours, tours rondes
        const shape = fill < 0.9 && ring.length >= 5 ? simplifyRing(ring.concat([ring[0]]), 0.5).slice(0, -1) : null;
        if (t.name || (shape && shape.length >= 5 && shape.length <= 40)) row.push(t.name || '');
        if (shape && shape.length >= 5 && shape.length <= 40) row.push(shape.map(([x, z]) => [r1(x - o.cx), r1(z - o.cz)]));
        out.b.push(row);
        if ((t.amenity || t.shop || t.tourism) && !t._poi) { t._poi = 1; out.am.push([poiType(t), t.name || t.brand || '', Math.round(o.cx), Math.round(o.cz), t['addr:street'] ? ((t['addr:housenumber'] || '') + ' ' + t['addr:street']).trim() : '']); }
      }
      continue;
    }
    if (t.highway && el.type === 'way' && el.geometry) {
      const rc = Object.hasOwn(ROAD, t.highway) ? ROAD[t.highway] : null; if (!rc) continue;
      if (t.tunnel === 'yes' || t.area === 'yes') continue;
      const pts = rnd(simplify(el.geometry.map(g => P(g.lat, g.lon))));
      if (pts.length < 2) continue;
      out.r.push([rc[0], rc[1], nameIdx(t.name), t.surface || '', pts]);
      continue;
    }
    if (t.railway && el.type === 'way' && el.geometry) { out.rl.push(rnd(simplify(el.geometry.map(g => P(g.lat, g.lon)), 1))); continue; }
    if (t.natural === 'water' || t.waterway === 'riverbank') { for (const ring of ringsOf(el, P)) if (closed(ring)) out.w.push(rnd(simplifyRing(ring, 1))); continue; }
    const green = t.leisure || (t.landuse && t.landuse) || (t.natural === 'wood' ? 'forest' : null);
    if (green && el.type !== 'node' && !t.amenity) { for (const ring of ringsOf(el, P)) if (closed(ring)) out.p.push([green, rnd(simplifyRing(ring, 0.8))]); continue; }
    if (t.amenity || t.shop || t.tourism || (t.leisure && /^(stadium|sports_centre)$/.test(t.leisure))) {
      const g = el.type === 'node' ? el : (el.center || (el.geometry && el.geometry[0])); if (!g) continue;
      const [x, z] = P(g.lat, g.lon); if (!inside(x, z)) continue;
      out.am.push([poiType(t), t.name || t.brand || '', Math.round(x), Math.round(z), t['addr:street'] ? ((t['addr:housenumber'] || '') + ' ' + t['addr:street']).trim() : '']);
    }
  }
  return out;
}

export async function buildCity({ key, lat, lon, R = 700, log, signal }) {
  const osm = await fetchOverpass(lat, lon, R, { log, signal });
  const data = convert(osm, { key, lat, lon, R });
  // quartier trop dense : on réduit le rayon (fichiers plus légers, chargement plus rapide)
  if (data.b.length > 12000 && R > 450) {
    log && log(`${data.b.length} bâtiments : rayon réduit à 450 m`);
    return convert(osm, { key, lat, lon, R: 450 });
  }
  return data;
}

// tuile du monde ouvert : rectangle [x0,x1]×[z0,z1] en mètres autour de l'origine de la ville (lat0, lon0).
// Les bâtiments déjà couverts par le plan de départ (cercle de rayon skipR) sont ignorés.
export async function buildTile({ key, lat, lon, x0, z0, x1, z1, skipR = 0, log, signal }) {
  const kx = 111320 * Math.cos(lat * Math.PI / 180), kz = 110540;
  const box = [lat - z1 / kz, lon + x0 / kx, lat - z0 / kz, lon + x1 / kx].map(v => +v.toFixed(6)); // s, w, n, e
  const osm = await fetchOverpass(lat, lon, 0, { log, signal, box });
  const keep = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1 && Math.hypot(x, z) > skipR;
  const out = convert(osm, { key, lat, lon, R: 0, keep });
  out.tile = key; return out;
}
