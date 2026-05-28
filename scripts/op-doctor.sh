#!/usr/bin/env bash
# scripts/op-doctor.sh
# Verify the 1Password env workflow is wired up correctly: CLI installed,
# signed in, vault accessible, every reference in .env.1password resolves.

set -euo pipefail

ACCT="${OP_ACCOUNT:-namuhinc.1password.com}"
VAULT="${OP_VAULT:-Exponential}"
REF_FILE="${1:-.env.1password}"

fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }
ok()   { printf 'ok    %s\n' "$1"; }

command -v op >/dev/null 2>&1 || fail "op CLI not installed (brew install 1password-cli)"
ok "op CLI present ($(op --version))"

if [ -n "${OP_SERVICE_ACCOUNT_TOKEN-}" ]; then
  op whoami >/dev/null 2>&1 || fail "OP_SERVICE_ACCOUNT_TOKEN set but invalid"
  ok "authenticated via service account"
else
  op --account "$ACCT" whoami >/dev/null 2>&1 || fail "not signed in: run 'op signin --account $ACCT'"
  ok "signed in as $(op --account "$ACCT" whoami | awk '/Email/{print $2}')"
fi

[ -f "$REF_FILE" ] || fail "$REF_FILE not found"
ok "reference file present: $REF_FILE"

unresolved=0
while IFS= read -r ref; do
  # op read prints the resolved value; we only care about the exit status.
  if op --account "$ACCT" read "$ref" >/dev/null 2>&1; then
    ok "resolves: $ref"
  else
    printf 'FAIL  unresolved: %s\n' "$ref" >&2
    unresolved=$((unresolved+1))
  fi
done < <(grep -oE 'op://[^[:space:]"]+' "$REF_FILE" | sort -u)

if [ "$unresolved" -gt 0 ]; then
  printf '\n%d unresolved reference(s). populate them with: make op-bootstrap\n' "$unresolved" >&2
  exit 1
fi

echo
echo "all checks passed."
