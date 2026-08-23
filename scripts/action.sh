#!/usr/bin/env bash
# Entry point for the GitHub Action. Everything arrives via environment
# variables; nothing from the workflow is interpolated into this file.
set -euo pipefail

: "${PERMIT_BIN:?PERMIT_BIN must point at dist/cli/main.js}"
: "${PERMIT_PATHS:=.}"
: "${PERMIT_FORMAT:=github}"
: "${PERMIT_ARGS:=}"
: "${PERMIT_FAIL_ON_FINDINGS:=true}"

args=(--format "$PERMIT_FORMAT")
if [ "$PERMIT_FAIL_ON_FINDINGS" != "true" ]; then
  args+=(--exit-zero)
fi

# PERMIT_ARGS and PERMIT_PATHS are deliberately word-split: they are lists.
# shellcheck disable=SC2206
args+=($PERMIT_ARGS)
# shellcheck disable=SC2206
args+=($PERMIT_PATHS)

exec node "$PERMIT_BIN" "${args[@]}"
