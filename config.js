// Configuration de déploiement de Monde Vivant (modifiable sans toucher à index.html).
window.MV_CONFIG = {
  // URL du serveur de cartes OpenStreetMap (dossier server/), sans « / » final.
  // Vide = les villes absentes de models/osm/ sont générées directement dans le navigateur du joueur
  // (requête OpenStreetMap/Overpass, puis gardées en cache sur l'appareil).
  // Exemple : 'https://monde-vivant-osm.up.railway.app'
  osmServer: '',
  // false = ne jamais générer de plan dans le navigateur (quartier procédural pour les villes absentes).
  osmBrowser: true,
  // Délai max (ms) d'attente de génération d'un plan avant de basculer sur le quartier procédural.
  osmTimeout: 90000
};
