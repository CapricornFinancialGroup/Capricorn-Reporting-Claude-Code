#!/usr/bin/env bash
# Manual zip deploy for Capricorn Growth OS (until CI is wired to the repo host).
#
#   ./scripts/deployment/deploy-manual.sh [resource-group] [app-name]
#
# Builds server + SPA, stages a production bundle (dist + prod node_modules), zips and deploys.

set -euo pipefail

RG="${1:-smt-rg-capgrowth-prod}"
APP="${2:-smt-capgrowth-app-prod}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "==> Build + test"
cd "$ROOT"
npm ci
npm run lint
npm test
npm run build
npm run build:web

echo "==> Stage production bundle"
cp -R dist "$STAGE/dist"
cp package.json package-lock.json "$STAGE/"
(cd "$STAGE" && npm ci --omit=dev --ignore-scripts)

echo "==> Zip"
(cd "$STAGE" && zip -qr app.zip dist node_modules package.json package-lock.json)

echo "==> Deploy to $APP ($RG)"
az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$STAGE/app.zip"

echo "==> Smoke"
sleep 8
curl -fsS "https://$APP.azurewebsites.net/healthz" && echo
curl -fsS "https://$APP.azurewebsites.net/healthz/lake" && echo
echo "Deployed."
