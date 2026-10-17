#!/usr/bin/env node
// Monde Vivant — serveur de cartes OpenStreetMap à la demande.
//
// Le jeu (GitHub Pages) a déjà ~70 villes pré-générées dans models/osm/. Pour les ~7 100 autres,
// il interroge ce serveur : GET /osm/<clé>.json  → plan généré depuis Overpass puis mis en cache disque.
//
//   GET /health                 état du serveur
//   GET /osm/index.json         clés déjà en cache
//   GET /osm/<clé>.json         plan d'une ville de models/world.json (ex. porto_novo_bj)
//   GET /osm/<clé>.json?lat=..&lon=..   point libre (clé au choix, [a-z0-9_]+)
//   GET /tile/<clé>/<i>_<j>.json?lat=..&lon=..   tuile de 600 m du monde ouvert autour de la ville
//
// Variables : PORT (8787), CACHE_DIR (./cache), OVERPASS_URLS, ALLOW_ORIGIN (*), RADIUS (700)
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCity, buildTile, cityKey } from './osm-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 8787;
const CACHE = process.env.CACHE_DIR || join(HERE, 'cache');
const ORIGIN = process.env.ALLOW_ORIGIN || '*';
const RADIUS = +process.env.RADIUS || 700;
await mkdir(CACHE, { recursive: true });

// villes connues : models/world.json (copié à côté du serveur, ou lu depuis le dépôt)
const worldPath = [join(HERE, 'world.json'), join(HERE, '..', 'models', 'world.json')].find(existsSync);
const CITIES = new Map();
if (worldPath) for (const c of JSON.parse(await readFile(worldPath, 'utf8')).cities) CITIES.set(cityKey(c[0], c[1]), { lat: c[2], lon: c[3], name: c[0] });
console.log(`${CITIES.size} villes connues, cache : ${CACHE}`);

// une seule requête Overpass à la fois (les serveurs publics limitent le débit)
let chain = Promise.resolve();
const pending = new Map();
function generate(key, lat, lon, make) {
  if (pending.has(key)) return pending.get(key);
  const p = chain.then(async () => {
    const file = join(CACHE, key + '.json');
    if (existsSync(file)) return readFile(file, 'utf8');
    const t0 = Date.now();
    const data = make ? await make() : await buildCity({ key, lat, lon, R: RADIUS, log: m => console.log(`[${key}] ${m}`) });
    const txt = JSON.stringify(data);
    await writeFile(file, txt);
    console.log(`[${key}] ✓ ${data.b.length} bâtiments, ${data.r.length} routes en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return txt;
  }).finally(() => pending.delete(key));
  chain = p.catch(() => {});
  pending.set(key, p);
  return p;
}

const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'GET, OPTIONS', ...extra });
  res.end(body);
};

createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.method !== 'GET') return send(res, 405, '{"error":"GET seulement"}');
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/' || u.pathname === '/health') return send(res, 200, JSON.stringify({ ok: true, villes: CITIES.size, enCours: [...pending.keys()] }));
    if (u.pathname === '/osm/index.json') {
      const idx = {}; for (const f of await readdir(CACHE)) if (f.endsWith('.json') && !f.startsWith('tile_')) idx[f.slice(0, -5)] = 1;
      return send(res, 200, JSON.stringify(idx), undefined, { 'Cache-Control': 'no-cache' });
    }
    const t = /^\/tile\/([a-z0-9_]{2,80})\/(-?\d{1,4})_(-?\d{1,4})\.json$/.exec(u.pathname);
    if (t) {
      const [, city, i, j] = t, known = CITIES.get(city);
      const lat = known ? known.lat : parseFloat(u.searchParams.get('lat')), lon = known ? known.lon : parseFloat(u.searchParams.get('lon'));
      if (!(Math.abs(lat) <= 85 && Math.abs(lon) <= 180)) return send(res, 404, '{"error":"fournir ?lat=&lon="}');
      const T = 600, x0 = +i * T - T / 2, z0 = +j * T - T / 2, key = `tile_${city}_${i}_${j}`;
      const txt = await generate(key, lat, lon, () => buildTile({ key: `${i},${j}`, lat, lon, x0, z0, x1: x0 + T, z1: z0 + T, skipR: 735 }));
      return send(res, 200, txt, undefined, { 'Cache-Control': 'public, max-age=604800' });
    }
    const m = /^\/osm\/([a-z0-9_]{2,80})\.json$/.exec(u.pathname);
    if (!m) return send(res, 404, '{"error":"introuvable"}');
    const key = m[1];
    let lat = parseFloat(u.searchParams.get('lat')), lon = parseFloat(u.searchParams.get('lon'));
    const known = CITIES.get(key);
    if (known) { lat = known.lat; lon = known.lon; } // les villes connues ignorent lat/lon fournis
    else if (!(Math.abs(lat) <= 85 && Math.abs(lon) <= 180)) return send(res, 404, '{"error":"ville inconnue : fournir ?lat=&lon="}');
    const txt = await generate(key, lat, lon);
    send(res, 200, txt, undefined, { 'Cache-Control': 'public, max-age=604800' });
  } catch (e) {
    console.error(e);
    send(res, 502, JSON.stringify({ error: 'Overpass indisponible, réessayez plus tard', detail: String(e.message || e) }));
  }
}).listen(PORT, () => console.log(`Serveur de cartes OSM sur http://localhost:${PORT}`));
