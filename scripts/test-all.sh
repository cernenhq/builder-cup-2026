#!/usr/bin/env bash
# Runs everything: secret scan, unit and API tests on the in-memory store, the same API tests and
# the storage contract on the Firestore emulator, then the browser tests on both stores.
# If the Firestore emulator cannot start (it needs gcloud and Java), those steps are reported as
# SKIPPED, never as passed.
set -euo pipefail
cd "$(dirname "$0")/.."
export MOCK_AI=1 GEMINI_API_KEY=

echo "== 1/5 secret scan"
bash scripts/secret-scan.sh .

echo "== 2/5 unit and API tests, in-memory store"
env -u FIRESTORE_EMULATOR_HOST STORE=memory node --test test/unit/*.test.js test/api/*.test.js

EMU_PID=""
# Stops only the emulator this script started: it runs in its own process group (set -m below), so
# the whole group (gcloud and its Java child) is stopped and nothing else on the machine is touched.
cleanup() {
  if [ -n "$EMU_PID" ]; then
    kill -TERM -- "-$EMU_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5; do kill -0 -- "-$EMU_PID" 2>/dev/null || break; sleep 1; done
    kill -KILL -- "-$EMU_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT
FS_OK=0
if [ -n "${FIRESTORE_EMULATOR_HOST:-}" ] && curl -s "http://${FIRESTORE_EMULATOR_HOST}" >/dev/null 2>&1; then
  FS_OK=1
elif command -v gcloud >/dev/null 2>&1 && command -v java >/dev/null 2>&1; then
  export FIRESTORE_EMULATOR_HOST=127.0.0.1:8085
  set -m   # job control: the background emulator gets its own process group, with group id EMU_PID
  gcloud emulators firestore start --host-port="$FIRESTORE_EMULATOR_HOST" --project=demo-proof-of-progress >/tmp/pop-firestore-emulator.log 2>&1 &
  EMU_PID=$!
  set +m
  for _ in $(seq 1 60); do curl -s "http://${FIRESTORE_EMULATOR_HOST}" >/dev/null 2>&1 && { FS_OK=1; break; }; sleep 1; done
fi

if [ "$FS_OK" = 1 ]; then
  echo "== 3/5 storage contract and API tests, Firestore emulator at $FIRESTORE_EMULATOR_HOST"
  STORE=firestore FIRESTORE_PROJECT_ID=demo-proof-of-progress GOOGLE_CLOUD_PROJECT=demo-proof-of-progress node --test test/unit/store.test.js test/api/*.test.js
else
  echo "== 3/5 SKIPPED: Firestore emulator not available (needs gcloud cloud-firestore-emulator and Java)"
fi

echo "== 4/5 browser tests (Playwright), in-memory store"
env -u FIRESTORE_EMULATOR_HOST STORE=memory npx playwright test

# The cernen.com set-up: the same browser tests through the cernen.com stand-in and proxy, with the
# app under /builderscup. Needs the site repo's tools/local-frontdoor.js (E2E_FRONTDOOR).
if [ -n "${E2E_FRONTDOOR:-}" ]; then
  echo "== 4b browser tests under /builderscup through the cernen.com proxy"
  env -u FIRESTORE_EMULATOR_HOST STORE=memory E2E_PORT=8121 E2E_PREFIX=/builderscup npx playwright test --reporter=list
else
  echo "== 4b SKIPPED: set E2E_FRONTDOOR=<site repo>/tools/local-frontdoor.js to test the /builderscup set-up"
fi

if [ "$FS_OK" = 1 ]; then
  echo "== 5/5 browser tests (Playwright), Firestore emulator"
  STORE=firestore FIRESTORE_PROJECT_ID=demo-proof-of-progress GOOGLE_CLOUD_PROJECT=demo-proof-of-progress E2E_PORT=8093 npx playwright test --reporter=list
else
  echo "== 5/5 SKIPPED: Firestore emulator not available"
fi
echo "All steps finished."
