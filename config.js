// Configuration de déploiement de Monde Vivant (modifiable sans toucher à index.html).
window.MV_CONFIG = {
  // URL du serveur de cartes OpenStreetMap (dossier server/), sans « / » final.
  // Vide = seules les ~70 villes pré-générées dans models/osm/ ont leur plan réel ;
  // les autres villes utilisent le quartier procédural.
  // Exemple : 'https://monde-vivant-osm.up.railway.app'
  osmServer: '',
  // Délai max (ms) d'attente de génération d'un plan avant de basculer sur le quartier procédural.
  osmTimeout: 90000
};
