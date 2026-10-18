#!/usr/bin/env bash
# Serve the app at cernen.com/builderscup. Deploys this code with BASE_PATH=/builderscup and the proxy
# secret, so the service answers under /builderscup (for the cernen.com proxy) and still at its own
# root. Dry run by default (prints every command, changes nothing); execute with:
#   APPLY=1 bash deploy/cernen-path.sh
#
# Which service:
#   SERVICE=proof-of-progress-cernen (default): a second Cloud Run service on the same project, data,
#     bucket, secrets and daily cap. The judged service (proof-of-progress) is not touched.
#   SERVICE=proof-of-progress: the judged service itself, once changing it is cleared.
# Both must run the same seed files (src/seed/*): they share the seeded demo copy.
set -euo pipefail
# Set before config.sh, which would otherwise default SERVICE to the judged service.
SERVICE="${SERVICE:-proof-of-progress-cernen}"
cd "$(dirname "$0")"; . ./config.sh
BASE_PATH="${BASE_PATH:-/builderscup}"
check_account

# The proxy secret: random, kept in Secret Manager. The cernen.com proxy gets the same value as an
# encrypted environment variable (see the site repo's README); the service reads it from here.
if applying; then
  if gcloud secrets describe pop-proxy-secret --project "$PROJECT" >/dev/null 2>&1; then echo "  pop-proxy-secret exists, kept."
  else openssl rand -hex 32 | tr -d '\n' | gcloud secrets create pop-proxy-secret --data-file=- --project "$PROJECT"; fi
else
  echo "+ (APPLY=1) create secret pop-proxy-secret (random), unless it exists"
fi
run gcloud secrets add-iam-policy-binding pop-proxy-secret --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --project "$PROJECT"

# Same settings as deploy/deploy.sh, plus BASE_PATH and PROXY_SECRET.
run gcloud run deploy "$SERVICE" --quiet --project "$PROJECT" --region "$REGION" --source .. \
    --service-account "$SA" --allow-unauthenticated \
    --min-instances 0 --max-instances 1 --concurrency 40 --cpu 1 --memory 1Gi --timeout 300 \
    --set-env-vars "NODE_ENV=production,STORE=firestore,PHOTO_BUCKET=$BUCKET,SEED=demo,WORKSPACES=1,LIVE_AI=1,GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=global,GEMINI_MODEL=$MODEL,DAILY_CAP_USD=$DAILY_CAP_USD,VISION=${VISION:-1},TRANSLATE=${TRANSLATE:-1},BQ_DATASET=${BQ_DATASET:-pop_analytics},BASE_PATH=$BASE_PATH" \
    --set-secrets "SESSION_SECRET=pop-session-secret:latest,JUDGE_CODE=pop-judge-code:latest,PROXY_SECRET=pop-proxy-secret:latest"
echo "Deployed (APPLY=${APPLY:-0}). URL (the cernen.com proxy's UPSTREAM):"
run gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)'
echo "Proxy secret for the DigitalOcean app (copies it; nothing is printed):"
echo "  gcloud secrets versions access latest --secret pop-proxy-secret --project \"\$PROJECT\" | pbcopy"
