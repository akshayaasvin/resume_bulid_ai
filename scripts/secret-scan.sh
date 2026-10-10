#!/usr/bin/env bash
# Scans the staged diff for secrets. Exit 1 if anything suspicious is found.
# Usage: bash scripts/secret-scan.sh   (run before every push; also wired as a pre-commit hook)
set -euo pipefail
diff=$(git diff --cached -U0 --no-color -- . ':(exclude)scripts/secret-scan.sh' ':(exclude)package-lock.json' | grep '^+' || true)
patterns='sk-ant-[A-Za-z0-9_-]{10,}|service_role"?[[:space:]]*[:=][[:space:]]*"?eyJ|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}|SUPABASE_SERVICE_ROLE_KEY=[^[:space:]]{8,}|ANTHROPIC_API_KEY=[^[:space:]]{8,}|postgres(ql)?://[^:]+:[^@<]{6,}@'
if echo "$diff" | grep -En "$patterns" >/dev/null; then
  echo "SECRET SCAN FAILED: staged changes contain what looks like a key:" >&2
  echo "$diff" | grep -En "$patterns" | cut -c1-120 >&2
  exit 1
fi
echo "secret scan: clean"
