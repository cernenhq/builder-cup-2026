#!/usr/bin/env bash
# One-time setup: APIs, Firestore, a private photo bucket, TTL clean-up, secrets and a service account
# with only what the service needs. The deployer runs it with their own gcloud account.
# Dry run by default (prints every command, changes nothing); execute with:  APPLY=1 bash deploy/setup.sh
# Safe to re-run: each create step first checks whether the resource exists and skips it if so; any
# other failure stops the script.
set -euo pipefail
cd "$(dirname "$0")"; . ./config.sh
check_account

run gcloud services enable firestore.googleapis.com secretmanager.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
    artifactregistry.googleapis.com aiplatform.googleapis.com storage.googleapis.com logging.googleapis.com --project "$PROJECT"

# Firestore in Native mode, Singapore.
create_if_missing "Firestore database (default)" \
  gcloud firestore databases describe --database="(default)" --project "$PROJECT" -- \
  gcloud firestore databases create --location="$REGION" --type=firestore-native --project "$PROJECT"

# Visitor copies of the demo, the per-visitor caches and the workspace records carry expireAt; these
# TTL policies delete them after it passes (Google: typically within 24 hours after expiry).
for c in $COLLECTIONS; do
  run gcloud firestore fields ttls update expireAt --collection-group="$c" --enable-ttl --async --project "$PROJECT"
done

# Private photo bucket; visitors' uploads (under ws/) are deleted after 2 days.
create_if_missing "bucket gs://$BUCKET" \
  gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" -- \
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention --project "$PROJECT"
LIFECYCLE='{"rule":[{"action":{"type":"Delete"},"condition":{"age":2,"matchesPrefix":["ws/"]}}]}'
if applying; then
  LIFECYCLE_FILE="$(mktemp)"
  trap 'rm -f "$LIFECYCLE_FILE"' EXIT
  printf '%s\n' "$LIFECYCLE" > "$LIFECYCLE_FILE"
else
  LIFECYCLE_FILE="<temporary file containing $LIFECYCLE>"
fi
run gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="$LIFECYCLE_FILE" --project "$PROJECT"
if applying; then rm -f "$LIFECYCLE_FILE"; trap - EXIT; fi

# Secrets: the session secret is random; the judge access code is typed in (never written to a file).
if applying; then
  if gcloud secrets describe pop-session-secret --project "$PROJECT" >/dev/null 2>&1; then echo "  pop-session-secret exists, kept."
  else openssl rand -hex 32 | tr -d '\n' | gcloud secrets create pop-session-secret --data-file=- --project "$PROJECT"; fi
  if gcloud secrets describe pop-judge-code --project "$PROJECT" >/dev/null 2>&1; then echo "  pop-judge-code exists, kept."
  else
    printf 'Type the judge access code (nothing shows while you type; never written to a file): '
    read -rs JC; echo
    printf '%s' "$JC" | gcloud secrets create pop-judge-code --data-file=- --project "$PROJECT"; unset JC
  fi
else
  echo "+ (APPLY=1) create secrets pop-session-secret (random) and pop-judge-code (typed in), unless they exist"
fi

# Service account: Firestore, Vertex AI, its own bucket, its two secrets, logging.
create_if_missing "service account $SA" \
  gcloud iam service-accounts describe "$SA" --project "$PROJECT" -- \
  gcloud iam service-accounts create "$SA_NAME" --display-name="PoP demo service" --project "$PROJECT"
if applying; then sleep 15; fi   # let a new service account become visible to IAM
for role in roles/datastore.user roles/aiplatform.user roles/logging.logWriter; do
  run gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$role" --condition=None --quiet
done
run gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.objectAdmin --project "$PROJECT"
for s in pop-session-secret pop-judge-code; do
  run gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --project "$PROJECT"
done
echo "Setup done (APPLY=${APPLY:-0}). Also set a budget alert in the Google Cloud console."
