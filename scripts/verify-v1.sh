#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

: "${V1_OUT_OF_SCOPE_NON_BLOCKING:=semantic-restore-ranking,marketplace,multi-tenant-saas,desktop-client,branch-compare,physical-purge}"

echo "ContextOS V1 RC verification"
echo "Non-blocking V1 out-of-scope: $V1_OUT_OF_SCOPE_NON_BLOCKING"

PYTHONPATH="backend/src" python -m unittest discover -s backend/tests/unit -p "test*.py"
PYTHONPATH="backend/src" python -m unittest discover -s backend/tests/e2e -p "test*.py"
PYTHONPATH="backend/src" python -m unittest discover -s backend/tests/integration -p "test*.py"
PYTHONPATH="backend/src" python -m unittest discover -s backend/tests/performance -p "test*.py"
python -m unittest discover -s tests/implementation -p "test*.py"

npm --prefix studio test
npm --prefix studio run typecheck
npm --prefix studio run test:e2e

echo "ContextOS V1 RC verification passed"
