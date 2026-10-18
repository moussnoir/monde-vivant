// Monde Vivant — source de secours (et source rapide dans le navigateur) : tuiles vectorielles OpenFreeMap.
// Ce sont les mêmes données OpenStreetMap, découpées et servies par un CDN sans limite de débit ni clé :
// pas de saturation comme avec Overpass. On les convertit en « éléments » au format Overpass, puis convert()
// (lib/osm-lib.mjs) produit le plan du jeu exactement comme d'habitude.
import { VectorTile, Pbf } from '../vendor/vt.mjs';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const Z = 14;
let TPL = null;
async function template(signal) {
  if (TPL) return TPL;
  const r = await fetch(TILEJSON, { signal });
  if (!r.ok) throw new Error('OpenFreeMap HTTP ' + r.status);
  return (TPL = (await r.json()).tiles[0]);
}
const tx = (lon) => (lon + 180) / 360 * 2 ** Z;
const ty = (lat) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** Z; };
const toLon = (x) => x / 2 ** Z * 360 - 180;
const toLat = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** Z))) * 180 / Math.PI;

// classes OpenMapTiles -> étiquettes OSM utilisées par convert()
const ROAD = { motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', minor: 'residential', service: 'service', track: 'track', path: 'footway', raceway: 'service', busway: 'busway' };
const RAIL = /^(rail|transit)$/;
const SHOP = new Set(['mall', 'department_store', 'supermarket', 'convenience', 'bakery', 'butcher', 'clothes', 'shoes', 'hairdresser', 'beauty', 'electronics', 'mobile_phone', 'hardware', 'furniture', 'car', 'car_repair', 'tailor', 'books', 'jewelry', 'optician']);
const AMEN = new Set(['school', 'university', 'college', 'hospital', 'clinic', 'pharmacy', 'marketplace', 'place_of_worship', 'fuel', 'restaurant', 'fast_food', 'cafe', 'bar', 'bank', 'atm', 'post_office', 'police', 'cinema', 'theatre', 'townhall', 'bus_station', 'library']);
function poiTags(p) {
  const sub = p.subclass || '', cls = p.class || '', t = { name: p['name:latin'] || p.name || '' };
  if (SHOP.has(sub)) t.shop = sub;
  else if (AMEN.has(sub)) t.amenity = sub;
  else if (cls === 'lodging') t.tourism = 'hotel';
  else if (cls === 'stadium') t.leisure = 'stadium';
  else if (cls === 'shop' || cls === 'grocery') t.shop = cls === 'grocery' ? 'convenience' : 'convenience';
  else if (AMEN.has(cls)) t.amenity = cls;
  else if (cls === 'museum' || cls === 'attraction') t.tourism = cls;
  else return null;
  return t;
}

// rectangle box = [s, w, n, e] en degrés
export async function fetchTilesAsOverpass(box, { signal, log = () => {} } = {}) {
  const tpl = await template(signal);
  const [s, w, n, e] = box, x0 = Math.floor(tx(w)), x1 = Math.floor(tx(e)), y0 = Math.floor(ty(n)), y1 = Math.floor(ty(s));
  const list = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) list.push([x, y]);
  if (list.length > 64) throw new Error('zone trop grande');
  log(`OpenFreeMap : ${list.length} tuiles`);
  const elements = []; let id = 1;
  const fetchOne = async ([x, y]) => {
    const r = await fetch(tpl.replace('{z}', Z).replace('{x}', x).replace('{y}', y), { signal });
    if (r.status === 204 || r.status === 404) return;
    if (!r.ok) throw new Error('tuile HTTP ' + r.status);
    const vt = new VectorTile(new Pbf(new Uint8Array(await r.arrayBuffer())));
    const L = vt.layers;
    const geo = (f) => { const ext = f.extent; return f.loadGeometry().map(ring => ring.map(p => ({ lat: toLat(y + p.y / ext), lon: toLon(x + p.x / ext) }))); };
    const inTile = (f, ring) => { const ext = f.extent; let cx = 0, cy = 0; for (const p of ring) { cx += p.x; cy += p.y } cx /= ring.length; cy /= ring.length; return cx >= 0 && cx < ext && cy >= 0 && cy < ext; };
    const outer = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p.x * q.y - q.x * p.y; } return a > 0; };
    if (L.building) for (let i = 0; i < L.building.length; i++) {
      const f = L.building.feature(i), pr = f.properties; if (pr.hide_3d) continue;
      const raw = f.loadGeometry(), G = geo(f);
      raw.forEach((ring, k) => {
        if (ring.length < 4 || !outer(ring) || !inTile(f, ring)) return; // une seule fois par bâtiment, dans la tuile de son centre
        const g = G[k]; if (g.length && (g[0].lat !== g.at(-1).lat || g[0].lon !== g.at(-1).lon)) g.push(g[0]);
        const tags = { building: 'yes' }; if (pr.render_height) tags.height = String(pr.render_height); if (pr.colour) tags['building:colour'] = pr.colour;
        elements.push({ type: 'way', id: id++, tags, geometry: g });
      });
    }
    if (L.transportation) for (let i = 0; i < L.transportation.length; i++) {
      const f = L.transportation.feature(i), pr = f.properties; if (f.type !== 2 || pr.brunnel === 'tunnel') continue;
      if (RAIL.test(pr.class)) { for (const g of geo(f)) elements.push({ type: 'way', id: id++, tags: { railway: 'rail' }, geometry: g }); continue; }
      let hw = ROAD[pr.class]; if (!hw) continue;
      if (pr.class === 'path' && pr.subclass) hw = pr.subclass === 'steps' ? 'steps' : pr.subclass === 'cycleway' ? 'cycleway' : 'footway';
      if (pr.ramp) hw = hw + '_link';
      for (const g of geo(f)) elements.push({ type: 'way', id: id++, tags: { highway: hw, surface: pr.surface || '' }, geometry: g });
    }
    if (L.transportation_name) for (let i = 0; i < L.transportation_name.length; i++) {
      const f = L.transportation_name.feature(i), pr = f.properties, hw = ROAD[pr.class]; if (f.type !== 2 || !hw) continue;
      const name = pr['name:latin'] || pr.name; if (!name) continue;
      for (const g of geo(f)) elements.push({ type: 'way', id: id++, tags: { highway: hw, name }, geometry: g });
    }
    if (L.water) for (let i = 0; i < L.water.length; i++) { const f = L.water.feature(i); if (f.type !== 3) continue; for (const g of geo(f)) if (g.length > 3) { g.push(g[0]); elements.push({ type: 'way', id: id++, tags: { natural: 'water' }, geometry: g }); } }
    for (const ln of ['park', 'landcover']) if (L[ln]) for (let i = 0; i < L[ln].length; i++) {
      const f = L[ln].feature(i), c = f.properties.class; if (f.type !== 3) continue;
      const tags = ln === 'park' ? { leisure: 'park' } : c === 'wood' ? { natural: 'wood' } : c === 'grass' ? { landuse: 'grass' } : null; if (!tags) continue;
      for (const g of geo(f)) if (g.length > 3) { g.push(g[0]); elements.push({ type: 'way', id: id++, tags, geometry: g }); }
    }
    if (L.poi) for (let i = 0; i < L.poi.length; i++) {
      const f = L.poi.feature(i), t = poiTags(f.properties); if (!t || f.type !== 1) continue;
      const p = geo(f)[0][0]; elements.push({ type: 'node', id: id++, lat: p.lat, lon: p.lon, tags: t });
    }
  };
  for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(fetchOne));
  log(`OpenFreeMap : ${elements.length} éléments`);
  return { elements };
}

// Occupation du sol (forêts, champs, sable, roche, glace, zones humides, villes, eau) d'une tuile de basse résolution,
// pour colorer le relief et y planter la végétation réelle. Renvoie les polygones en pixels de tuile (0..256).
// classes : 1 forêt, 2 prairie/parc, 3 champs, 4 sable, 5 roche, 6 glace, 7 zone humide, 8 ville, 9 eau, 10 broussailles
const LC_CLASS = { wood: 1, forest: 1, grass: 2, farmland: 3, sand: 4, rock: 5, ice: 6, wetland: 7 };
export async function fetchLandcover(z, x, y, { signal } = {}) {
  const tpl = await template(signal);
  const r = await fetch(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal });
  if (r.status === 204 || r.status === 404) return { polys: [] };
  if (!r.ok) throw new Error('tuile HTTP ' + r.status);
  const vt = new VectorTile(new Pbf(new Uint8Array(await r.arrayBuffer())));
  const L = vt.layers, polys = [];
  const take = (layer, cls) => { if (!L[layer]) return; for (let i = 0; i < L[layer].length; i++) {
    const f = L[layer].feature(i); if (f.type !== 3) continue; const c = cls(f.properties); if (!c) continue;
    const k = 256 / f.extent; polys.push({ c, rings: f.loadGeometry().map(ring => ring.map(p => [p.x * k, p.y * k])) }); } };
  take('landuse', p => /^(residential|commercial|industrial|retail|railway|garages)$/.test(p.class) ? 8 : null);
  take('park', () => 2);
  take('landcover', p => p.subclass === 'scrub' || p.subclass === 'heath' ? 10 : LC_CLASS[p.class] || null);
  take('water', () => 9);
  return { polys };
}
