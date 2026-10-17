# Image du serveur de cartes OSM. Construire depuis la racine du dépôt :
#   docker build -f server/Dockerfile -t monde-vivant-osm .
FROM node:22-alpine
WORKDIR /app
COPY server/osm-lib.mjs server/server.mjs ./
COPY models/world.json ./world.json
ENV PORT=8787 CACHE_DIR=/data
VOLUME /data
EXPOSE 8787
CMD ["node", "server.mjs"]
