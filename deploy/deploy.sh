#!/usr/bin/env bash
# Build from source with Cloud Build and deploy to Cloud Run. The judge link needs no sign-in, so the
# service allows unauthenticated requests; live model calls still need the judge access code and stay
# under the daily cap. The deployer runs it with their own gcloud account. Dry run by default (prints
# every command, changes nothing); execute with:  APPLY=1 bash deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"; . ./config.sh
check_account
# max-instances 1: the daily cap, the access-code rate limit and first-start seeding stay in one place.
run gcloud run deploy "$SERVICE" --quiet --project "$PROJECT" --region "$REGION" --source .. \
    --service-account "$SA" --allow-unauthenticated \
    --min-instances 0 --max-instances 1 --concurrency 40 --cpu 1 --memory 1Gi --timeout 300 \
    --set-env-vars "NODE_ENV=production,STORE=firestore,PHOTO_BUCKET=$BUCKET,SEED=demo,WORKSPACES=1,LIVE_AI=1,GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=global,GEMINI_MODEL=$MODEL,DAILY_CAP_USD=$DAILY_CAP_USD,IMAGE_MODEL=${IMAGE_MODEL:-gemini-3.1-flash-image},VISION=${VISION:-1},TRANSLATE=${TRANSLATE:-1},BQ_DATASET=${BQ_DATASET:-pop_analytics}" \
    --set-secrets "SESSION_SECRET=pop-session-secret:latest,JUDGE_CODE=pop-judge-code:latest"
echo "Deployed (APPLY=${APPLY:-0}). URL:"
run gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)'
