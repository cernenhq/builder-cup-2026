#!/usr/bin/env bash
# One-time setup for the optional Google Cloud features: Cloud Vision (web detection), Cloud Translation
# (public note in Filipino) and BigQuery (portfolio analytics). Run after deploy/setup.sh.
# Dry run by default; execute with:  APPLY=1 bash deploy/setup-extra.sh
set -euo pipefail
cd "$(dirname "$0")"; . ./config.sh
check_account
DATASET="${BQ_DATASET:-pop_analytics}"

run gcloud services enable vision.googleapis.com translate.googleapis.com bigquery.googleapis.com --project "$PROJECT"

# Expiry for the two new per-visitor caches (same TTL field as the other visitor collections).
for c in visioncache translatecache; do
  run gcloud firestore fields ttls update expireAt --collection-group="$c" --enable-ttl --async --project "$PROJECT"
done

# BigQuery: a dataset in Singapore and one day-partitioned events table (counts only: no names or free text).
create_if_missing "BigQuery dataset $DATASET" \
  bq --project_id="$PROJECT" show "$PROJECT:$DATASET" -- \
  bq --project_id="$PROJECT" --location="$REGION" mk --dataset --description "Demo analytics, counts only" "$PROJECT:$DATASET"
create_if_missing "BigQuery table $DATASET.events" \
  bq --project_id="$PROJECT" show "$PROJECT:$DATASET.events" -- \
  bq --project_id="$PROJECT" mk --table --time_partitioning_field event_time --time_partitioning_type DAY "$PROJECT:$DATASET.events" ./bigquery-schema.json

# Least privilege for the service account: write rows to this dataset only, run queries, call Translation.
# Dataset-level write access via the dataset's access list (bq add-iam-policy-binding needs allowlisting).
if applying; then
  TMP=$(mktemp)
  bq --project_id="$PROJECT" show --format=prettyjson "$PROJECT:$DATASET" > "$TMP"
  python3 - "$TMP" "$SA" <<'PY'
import json, sys
path, sa = sys.argv[1], sys.argv[2]
d = json.load(open(path))
acc = d.setdefault("access", [])
if not any(a.get("userByEmail") == sa and a.get("role") == "WRITER" for a in acc):
    acc.append({"role": "WRITER", "userByEmail": sa})
json.dump({"access": acc}, open(path, "w"))
PY
  bq --project_id="$PROJECT" update --source "$TMP" "$PROJECT:$DATASET"
  rm -f "$TMP"
else
  echo "+ (APPLY=1) add $SA as WRITER to the access list of $PROJECT:$DATASET"
fi
for role in roles/bigquery.jobUser roles/cloudtranslate.user roles/serviceusage.serviceUsageConsumer; do
  run gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$role" --condition=None --quiet
done
echo "Extra setup done (APPLY=${APPLY:-0}). Then deploy with deploy/deploy.sh (it turns the features on)."
