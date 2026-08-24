#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

: "${V1_OUT_OF_SCOPE_NON_BLOCKING:=semantic-restore-ranking,marketplace,multi-tenant-saas,desktop-client,branch-compare,physical-purge}"

echo "ContextOS V1 RC verification"
echo "Non-blocking V1 out-of-scope: $V1_OUT_OF_SCOPE_NON_BLOCKING"

if command -v python >/dev/null 2>&1; then
  PYTHON_BIN=(python)
elif command -v py.exe >/dev/null 2>&1; then
  PYTHON_BIN=(py.exe -3)
elif command -v python.exe >/dev/null 2>&1; then
  PYTHON_BIN=(python.exe)
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN=(python3)
elif command -v py >/dev/null 2>&1; then
  PYTHON_BIN=(py -3)
else
  echo "Python 3 is required to run ContextOS V1 verification." >&2
  exit 127
fi

PYTHONPATH="backend/src" "${PYTHON_BIN[@]}" -m unittest discover -s backend/tests/unit -p "test*.py"
PYTHONPATH="backend/src" "${PYTHON_BIN[@]}" -m unittest discover -s backend/tests/e2e -p "test*.py"
PYTHONPATH="backend/src" "${PYTHON_BIN[@]}" -m unittest discover -s backend/tests/integration -p "test*.py"
PYTHONPATH="backend/src" "${PYTHON_BIN[@]}" -m unittest discover -s backend/tests/performance -p "test*.py"
"${PYTHON_BIN[@]}" -m unittest discover -s tests/implementation -p "test*.py"

npm --prefix studio test
npm --prefix studio run typecheck
npm --prefix studio run test:e2e

echo "ContextOS V1 RC verification passed"
