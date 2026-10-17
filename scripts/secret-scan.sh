#!/usr/bin/env bash
# Fails if anything that looks like a credential is in the repo. Usage: scripts/secret-scan.sh [dir]
# Patterns: Google API keys (Gemini keys start this way), service-account key files, OAuth access
# tokens, private keys, AWS keys, GitHub and Slack tokens, and a hard-coded session secret.
set -euo pipefail
DIR="${1:-.}"
PATTERNS=(
  'AIza[0-9A-Za-z_-]{35}'
  '"private_key_[i]d"'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'ya29\.[0-9A-Za-z_-]{20,}'
  'AKIA[0-9A-Z]{16}'
  'ghp_[0-9A-Za-z]{36}'
  'xox[abprs]-[0-9A-Za-z-]{10,}'
  'SESSION_SECRET=[0-9a-fA-F]{32,}'
)
found=0
for p in "${PATTERNS[@]}"; do
  if grep -rInE --binary-files=without-match \
      --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=seed-photos --exclude-dir=screens \
      --exclude-dir=test-results --exclude-dir=playwright-report --exclude-dir=data \
      -e "$p" "$DIR"; then
    found=1
  fi
done
if [ "$found" -ne 0 ]; then
  echo "secret-scan: possible secret found (see above). Remove it and rotate the key." >&2
  exit 1
fi
echo "secret-scan: clean (${#PATTERNS[@]} patterns, $DIR)"
