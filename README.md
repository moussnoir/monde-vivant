# Monde Vivant

Jeu 3D de vie quotidienne dans des villes réelles, à l’heure locale : Cotonou, Paris, New York, Tokyo et plus de 7 200 villes du monde. Three.js (r128), sans build : un seul `index.html` et des ressources statiques.

- `index.html` : le jeu (v0.24 : toute la Terre en continu, relief réel, monuments à leur vraie place, architecture de chaque pays)
- `config.js` : configuration de déploiement (URL du serveur de cartes)
- `art/` : image d’accueil et textures
- `models/` : modèles 3D (personnages, créatures, meubles, véhicules, monuments) en JSON base64, `world.json` (villes et pays)
- `models/osm/` : plans OpenStreetMap pré-générés (~70 villes) + `index.json`
- `models/kenney/` : meubles et électroménager du Furniture Kit de Kenney (CC0, www.kenney.nl) : cuisine, salle d'eau, chambre, salon
- `vendor/three/` : three.js r128 et ses modules, servis en local (plus de dépendance aux CDN)
- `lib/osm-lib.mjs` : conversion OpenStreetMap → plan du jeu, partagée par le jeu, le script et le serveur
- `server/` : serveur de cartes OpenStreetMap à la demande (optionnel)
- `tools/osm-build.mjs` : génération de plans en ligne de commande

## Jouer en local

```bash
npx http-server -p 8080 -c-1 .
# puis http://localhost:8080
```

La sauvegarde est stockée dans le navigateur (`localStorage`).

## GitHub Pages

1. Pousser sur `main`.
2. Dans le dépôt : **Settings › Pages › Build and deployment › Source : GitHub Actions**.
3. Le workflow `.github/workflows/pages.yml` publie le site à chaque push sur `main` (ou à la main depuis l’onglet Actions).
4. Optionnel : **Settings › Secrets and variables › Actions › Variables**, créer `OSM_SERVER_URL` avec l’adresse du serveur de cartes (ex. `https://monde-vivant-osm.up.railway.app`). Elle est injectée dans `config.js` au déploiement.

## La Terre entière

- **Voyage continu** : on peut marcher ou rouler hors de la ville, de pays en pays. Le monde se « recentre » tous les 2,5 km : près d’une ville (moins de 6 km), on entre dans cette ville avec son quartier ; ailleurs, une région de passage (campagne, désert, montagne) charge OpenStreetMap et le relief autour du joueur. Un message signale chaque frontière franchie.
- **Relief réel** : altitudes des tuiles Terrarium (AWS Open Data, ~38 m par pixel au zoom 12). Montagnes, collines et vallées autour de la ville, sol coloré selon le climat (désert, savane, forêt, toundra), l’altitude et la pente, neige en haut des sommets. Le quartier de départ reste plat ; routes, bâtiments, passants et voitures suivent le terrain. `terrain:false` dans `config.js` le désactive.
- **Monuments à leur vraie place** : pyramides de Gizeh, tour Eiffel, Christ Rédempteur, Temple du Ciel… apparaissent à leurs coordonnées réelles quand on passe à moins de 6 km.
- **Architecture régionale** : façades, couleurs et toits selon la région du monde (maisons blanches à toits plats d’Afrique du Nord et du Moyen-Orient, tuiles méditerranéennes, barres soviétiques, couleurs vives d’Amérique latine, Inde, Chine, Asie du Sud-Est, toits à deux pentes en tôle, tuile ou ardoise…), pour les plans OpenStreetMap comme pour le quartier de départ.

## Plans OpenStreetMap

### Sources de données (contre la saturation d’Overpass)

Les données viennent toujours d’OpenStreetMap, par deux chemins :

1. **Tuiles vectorielles OpenFreeMap** (`lib/vt-source.mjs`, décodées avec `vendor/vt.mjs`) : servies par un CDN, sans clé ni limite de débit, rapides. Source utilisée en premier dans le navigateur.
2. **Overpass** : plus détaillé (types de bâtiments, étages, noms, commerces), mais les serveurs publics saturent souvent. Source utilisée en premier par le générateur nocturne, avec les tuiles en secours ; dans le navigateur, en secours des tuiles (miroirs compatibles seulement, 40 s max).

Les plans pré-générés dans le dépôt (chaque nuit) et le cache de l’appareil évitent de redemander une ville déjà vue.

Le jeu cherche d’abord `models/osm/<clé>.json` (clé = nom de ville normalisé + code pays, ex. `porto_novo_bj`). S’il n’existe pas :

- par défaut, le navigateur du joueur génère le plan lui-même, puis le garde en cache sur l’appareil : toutes les villes ont leur plan réel, sans serveur ;
- avec `osmServer` renseigné dans `config.js`, il le demande plutôt au serveur ;
- en cas d’échec (Overpass saturé, hors ligne), il construit le quartier procédural habituel.

Le monde est ouvert : au-delà du plan de départ, la ville réelle se charge par tuiles de 600 m autour du joueur (OpenStreetMap, gardées en cache), sur un sol sans limite. Les bâtiments non rectangulaires (L, U, cours, tours rondes) sont extrudés d’après leur contour réel ; la façade dépend de l’usage (bureaux et tours en verre, industrie en brique, sinon le style de la région) et les commerces ont une enseigne lumineuse.

Chaque nuit, le workflow « Générer des plans OpenStreetMap » complète le dépôt : la première nuit il met à jour les plans existants (ajout des commerces, centres commerciaux et noms de bâtiments, plus Tokyo), ensuite il ajoute les 400 plus grandes villes manquantes à chaque passage, dans la limite de 700 Mo.

### Option A : pré-générer dans le dépôt (gratuit, sans serveur)

```bash
node tools/osm-build.mjs "Porto-Novo:BJ" "Parakou:BJ"   # villes de world.json
node tools/osm-build.mjs --country BJ                     # tout un pays
node tools/osm-build.mjs --top 50                         # les 50 plus grandes villes manquantes
node tools/osm-build.mjs --refresh                        # régénère les plans existants
node tools/osm-build.mjs --key ketou_bj --lat 7.36 --lon 2.60   # point libre (hors world.json)
```

Ou depuis GitHub : **Actions › Générer des plans OpenStreetMap › Run workflow**. Les plans sont commités dans `models/osm/` et Pages se redéploie tout seul.

### Option B : serveur à la demande (toutes les villes)

```bash
npm start                      # http://localhost:8787
curl localhost:8787/osm/porto_novo_bj.json
```

Déploiement sur Railway : créer un projet depuis ce dépôt, `railway.json` utilise `server/Dockerfile`. Ajouter un volume monté sur `/data` pour garder le cache. Puis renseigner `OSM_SERVER_URL` (voir plus haut).

Avec Docker : `docker build -f server/Dockerfile -t monde-vivant-osm . && docker run -p 8787:8787 -v osm:/data monde-vivant-osm`

Variables : `PORT` (8787), `CACHE_DIR`, `RADIUS` (700 m), `ALLOW_ORIGIN` (`*`, à restreindre à l’URL Pages), `OVERPASS_URLS` (liste séparée par des virgules).

Données © contributeurs OpenStreetMap, licence ODbL. Les serveurs Overpass publics limitent le débit : le serveur traite une ville à la fois.
