#!/usr/bin/env bash
# Manual zip deploy for Capricorn Growth OS (until CI is wired to the repo host).
#
#   ./scripts/deployment/deploy-manual.sh [resource-group] [app-name]
#
# Builds server + SPA, stages a production bundle (dist + prod node_modules), zips and deploys.

set -euo pipefail

RG="${1:-smt-rg-capgrowth-prod}"
APP="${2:-smt-capgrowth-app-prod}"
# The resource group lives in the Production subscription, which is not the az CLI default. Passed
# per command rather than via `az account set`, which would flip the default for every other shell.
SUBSCRIPTION="${AZ_SUBSCRIPTION:-Production}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cd "$ROOT"

# ONLY MAIN GOES TO PRODUCTION. Prod used to run whichever branch was deployed last, so parallel
# sessions overwrote each other's work and main lagged what was live (offices fixes on
# kyle-2026-10-12-offices-live, then feat/office-self-service on 2026-11-04). Merge the PR first,
# then deploy main. There is deliberately no override flag: a hotfix goes through a PR too.
echo "==> Check: deploying exactly origin/main from a clean tree"
git fetch --quiet origin main
if [ -n "$(git status --porcelain)" ]; then
  echo "!! REFUSED: the working tree has uncommitted changes, so the bundle would match no commit." >&2
  git status --short >&2
  exit 1
fi
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "!! REFUSED: HEAD is $(git rev-parse --short HEAD) on '$(git rev-parse --abbrev-ref HEAD)', not origin/main ($(git rev-parse --short origin/main))." >&2
  echo "   Merge your pull request, then: git switch main && git pull --ff-only, and deploy again." >&2
  exit 1
fi

echo "==> Build + test"
npm ci
npm run lint
npm test
npm run build
npm run build:web
npm run stamp

EXPECTED_SHA="$(git rev-parse --short HEAD)"

echo "==> Stage production bundle"
cp -R dist "$STAGE/dist"
cp package.json package-lock.json "$STAGE/"
(cd "$STAGE" && npm ci --omit=dev --ignore-scripts)

echo "==> Zip"
(cd "$STAGE" && zip -qr app.zip dist node_modules package.json package-lock.json)

echo "==> Deploy to $APP ($RG)"
az webapp deploy --subscription "$SUBSCRIPTION" -g "$RG" -n "$APP" --type zip --src-path "$STAGE/app.zip"

echo "==> Smoke"
sleep 8
HEALTH="$(curl -fsS "https://$APP.azurewebsites.net/healthz")"
echo "$HEALTH"
curl -fsS "https://$APP.azurewebsites.net/healthz/lake" && echo

# Fail the deploy if the app is not serving the commit we just built. Silent no-op deploys are how
# Capricorn ended up looking at a two-day-old board while being told it was fixed (2026-07-30).
LIVE_SHA="$(printf '%s' "$HEALTH" | sed -n 's/.*"shortSha":"\([^"]*\)".*/\1/p')"
if [ "$LIVE_SHA" != "$EXPECTED_SHA" ]; then
  echo "!! FAILED: live build is '$LIVE_SHA', expected '$EXPECTED_SHA'. The deploy did not take." >&2
  exit 1
fi
echo "Deployed and verified: $LIVE_SHA"
