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
npm run stamp

EXPECTED_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "!! WARNING: deploying from a DIRTY tree — the bundle matches no commit."
fi

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
HEALTH="$(curl -fsS "https://$APP.azurewebsites.net/healthz")"
echo "$HEALTH"
curl -fsS "https://$APP.azurewebsites.net/healthz/lake" && echo

# Fail the deploy if the app is not serving the commit we just built. Silent no-op deploys are how
# Capricorn ended up looking at a two-day-old board while being told it was fixed (2026-07-30).
LIVE_SHA="$(printf '%s' "$HEALTH" | sed -n 's/.*"shortSha":"\([^"]*\)".*/\1/p')"
if [ "$EXPECTED_SHA" != "unknown" ] && [ "$LIVE_SHA" != "$EXPECTED_SHA" ]; then
  echo "!! FAILED: live build is '$LIVE_SHA', expected '$EXPECTED_SHA'. The deploy did not take." >&2
  exit 1
fi
echo "Deployed and verified: $LIVE_SHA"
