# Shared settings for the deploy scripts. No secrets here. The project and the deployer's gcloud account
# come from deploy/.env.deploy (not committed) or the environment.
[ -f "$(dirname "${BASH_SOURCE[0]}")/.env.deploy" ] && . "$(dirname "${BASH_SOURCE[0]}")/.env.deploy"
: "${PROJECT:?set PROJECT (Google Cloud project ID) in deploy/.env.deploy or the environment}"
: "${DEPLOY_ACCOUNT:?set DEPLOY_ACCOUNT (the gcloud account allowed to deploy) in deploy/.env.deploy or the environment}"
REGION="${REGION:-asia-southeast1}"          # Singapore, nearest Cloud Run region to the Philippines
SERVICE="${SERVICE:-proof-of-progress}"
SA_NAME="${SA_NAME:-pop-run}"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
BUCKET="${BUCKET:-${PROJECT}-pop-photos}"
MODEL="${MODEL:-gemini-3.8-flash}"
DAILY_CAP_USD="${DAILY_CAP_USD:-3}"           # estimated live model spend per day (src/ai/spend.js); not a spending limit on the account
# Collection groups that carry expireAt and get a TTL policy: the visitor copies (ws/<id>/...), the
# per-visitor caches and the workspace records. Keep in step with src/store/firestore.js.
COLLECTIONS="users projects periods photos submissions decisions transmittals monitoring meta aicache notecache workspaces visioncache translatecache"

applying() { [ "${APPLY:-0}" = 1 ]; }

run() {   # print every command; execute only with APPLY=1; any failure stops the script
  printf '+ %s\n' "$*"
  if applying; then "$@"; fi
}

# create_if_missing WHAT DESCRIBE_COMMAND... -- CREATE_COMMAND...
# Runs the describe command first. If it succeeds, the resource exists and the create step is skipped.
# Otherwise the create command runs, and any failure stops the script.
create_if_missing() {
  local what="$1"; shift
  local describe=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do describe+=("$1"); shift; done
  [ "${1:-}" = "--" ] || { echo "create_if_missing: missing -- for $what"; exit 1; }
  shift
  printf '+ %s\n' "$*"
  printf '  (skipped if this succeeds: %s)\n' "${describe[*]}"
  if applying; then
    if "${describe[@]}" >/dev/null 2>&1; then
      echo "  $what exists, kept."
    else
      "$@"
    fi
  fi
}

check_account() {
  [ "$(gcloud config get-value account 2>/dev/null)" = "$DEPLOY_ACCOUNT" ] || { echo "Active gcloud account is not DEPLOY_ACCOUNT; stopping."; exit 1; }
}
