#!/usr/bin/env bash
# Entry point for the GitHub Action. Everything arrives via environment
# variables; nothing from the workflow is interpolated into this file.
set -euo pipefail

: "${FROSTJS_BIN:?FROSTJS_BIN must point at dist/cli/main.js}"
: "${FROSTJS_PATHS:=.}"
: "${FROSTJS_FORMAT:=github}"
: "${FROSTJS_ARGS:=}"
: "${FROSTJS_FAIL_ON_FINDINGS:=true}"

args=(--format "$FROSTJS_FORMAT")
if [ "$FROSTJS_FAIL_ON_FINDINGS" != "true" ]; then
  args+=(--exit-zero)
fi

# FROSTJS_ARGS and FROSTJS_PATHS are deliberately word-split: they are lists.
# shellcheck disable=SC2206
args+=($FROSTJS_ARGS)
# shellcheck disable=SC2206
args+=($FROSTJS_PATHS)

exec node "$FROSTJS_BIN" "${args[@]}"
