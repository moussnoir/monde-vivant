#!/usr/bin/env node
// Génère les plans OpenStreetMap des villes pour le jeu, dans models/osm/, et met à jour models/osm/index.json.
//
// Exemples :
//   node tools/osm-build.mjs "Porto-Novo:BJ" "Parakou:BJ"        villes de models/world.json (nom:code ISO)
//   node tools/osm-build.mjs --top 50                              les 50 plus grandes villes pas encore générées
//   node tools/osm-build.mjs --country BJ                          toutes les villes d'un pays
//   node tools/osm-build.mjs --key ketou_bj --lat 7.36 --lon 2.6   point libre
//   node tools/osm-build.mjs --refresh                             régénère les plans existants (ajoute commerces et noms)
//   options : --radius 700   --force (régénère même si le fichier existe)
//             --max-minutes 300 (s'arrête proprement)   --max-total-mb 700 (plafond de taille du dossier models/osm)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCity, cityKey } from '../server/osm-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OSM_DIR = join(ROOT, 'models', 'osm');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = n => { const i = args.indexOf('--' + n); if (i < 0) return false; args.splice(i, 1); return true; };

const R = +opt('radius', 700), refresh = flag('refresh'), force = flag('force') || refresh, maxMin = +opt('max-minutes', 0), maxMB = +opt('max-total-mb', 0), top = +opt('top', 0), country = opt('country', ''), key = opt('key', ''), lat = opt('lat', ''), lon = opt('lon', '');
const world = JSON.parse(await readFile(join(ROOT, 'models', 'world.json'), 'utf8'));
const idxPath = join(OSM_DIR, 'index.json');
const index = existsSync(idxPath) ? JSON.parse(await readFile(idxPath, 'utf8')) : {};

const jobs = [];
if (key && lat && lon) jobs.push({ key, lat: +lat, lon: +lon, label: key });
for (const a of args) {
  const [name, iso] = a.split(':');
  const c = world.cities.find(c => c[1] === (iso || '').toUpperCase() && c[0].toLowerCase() === name.toLowerCase());
  if (!c) { console.error(`Ville introuvable dans world.json : ${a}`); continue; }
  jobs.push({ key: cityKey(c[0], c[1]), lat: c[2], lon: c[3], label: `${c[0]} (${c[1]})` });
}
if (country) for (const c of world.cities.filter(c => c[1] === country.toUpperCase())) jobs.push({ key: cityKey(c[0], c[1]), lat: c[2], lon: c[3], label: `${c[0]} (${c[1]})` });
if (top) for (const c of [...world.cities].sort((a, b) => b[4] - a[4]).filter(c => !index[cityKey(c[0], c[1])]).slice(0, top)) jobs.push({ key: cityKey(c[0], c[1]), lat: c[2], lon: c[3], label: `${c[0]} (${c[1]})` });
// les 4 villes détaillées du jeu ont une clé simple (même centre que REGIONS dans index.html)
const BASE = { cotonou: [6.3703, 2.3912], paris: [48.8566, 2.3522], newyork: [40.7128, -74.006], tokyo: [35.6762, 139.6503] };
if (refresh) {
  for (const [k, [la, lo]] of Object.entries(BASE)) jobs.push({ key: k, lat: la, lon: lo, label: `${k} [ville détaillée]` });
  for (const k of Object.keys(index)) { if (BASE[k]) continue; const c = world.cities.find(c => cityKey(c[0], c[1]) === k); if (c) jobs.push({ key: k, lat: c[2], lon: c[3], label: `${c[0]} (${c[1]}) [mise à jour]` }); }
}
if (!jobs.length) { console.log('Rien à faire. Voir les exemples en tête de tools/osm-build.mjs'); process.exit(0); }

await mkdir(OSM_DIR, { recursive: true });
let ok = 0, fail = 0;
const t0 = Date.now();
const { readdirSync, statSync } = await import('node:fs');
const dirMB = () => readdirSync(OSM_DIR).reduce((a, f) => a + statSync(join(OSM_DIR, f)).size, 0) / 1048576;
for (const j of jobs) {
  if (maxMin && (Date.now() - t0) / 60000 > maxMin) { console.log(`Temps écoulé (${maxMin} min) : arrêt, la suite au prochain passage.`); break; }
  if (maxMB && dirMB() > maxMB) { console.log(`Plafond de ${maxMB} Mo atteint : arrêt.`); break; }
  const file = join(OSM_DIR, j.key + '.json');
  if (!force && index[j.key] && existsSync(file)) { console.log(`= ${j.label} déjà présent`); continue; }
  try {
    console.log(`→ ${j.label} [${j.key}]`);
    const data = await buildCity({ ...j, R, log: m => console.log('   ' + m) });
    if (data.b.length + data.r.length < 20) throw new Error(`trop peu de données OSM (${data.b.length} bâtiments, ${data.r.length} routes)`);
    await writeFile(file, JSON.stringify(data));
    index[j.key] = (index[j.key] || 0) + 1; // numéro de version : invalide le cache navigateur
    await writeFile(idxPath, JSON.stringify(index));
    console.log(`  ✓ ${data.b.length} bâtiments, ${data.r.length} routes, ${data.n.length} noms de rue`);
    ok++;
  } catch (e) { console.error(`  ✗ ${j.label} : ${e.message}`); fail++; }
  await new Promise(r => setTimeout(r, 2000)); // politesse envers les serveurs Overpass
}
console.log(`Terminé : ${ok} généré(s), ${fail} échec(s).`);
process.exit(fail && !ok ? 1 : 0);
