#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="jzirqfzzvlbxwfzndaer"
SHA=$(git rev-parse --short HEAD)

echo "==> Setting DEPLOY_GIT_SHA=$SHA"
npx supabase secrets set DEPLOY_GIT_SHA="$SHA" --project-ref "$PROJECT_REF"

FUNCTIONS="${@:-worker admin-actions}"
for fn in $FUNCTIONS; do
  echo "==> Deploying $fn"
  npx supabase functions deploy "$fn" --project-ref "$PROJECT_REF" --no-verify-jwt
done

echo "==> All done. SHA=$SHA"
