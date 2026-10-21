#!/usr/bin/env bash
# Actualiza back y front en la VM con lo último de GitHub. Uso: ~/parqueo/backend/deploy.sh
# Espera los dos repos clonados lado a lado: ~/parqueo/backend y ~/parqueo/frontend
set -e
cd "$(dirname "$0")"
DOMINIO=${DOMINIO:-35-226-151-23.sslip.io}

git pull
npm install

cd ../frontend
git pull
npm install
VITE_API=https://$DOMINIO npm run build
sudo rm -rf /var/www/parqueo && sudo mkdir -p /var/www/parqueo
sudo cp -r dist/* /var/www/parqueo/

sudo systemctl restart parqueo
echo "Listo: https://$DOMINIO"
