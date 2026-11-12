#!/usr/bin/env bash
set -euo pipefail

required="$(tr -d '\r\n' < .nvmrc)"
if [[ ! "$required" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::Invalid Node.js version in .nvmrc."
  exit 1
fi

is_compatible() {
  local version="$1"
  [[ "$(printf '%s\n%s\n' "$required" "$version" | sort -V | head -n1)" == "$required" ]]
}

selected=""
selected_version=""
shopt -s nullglob
if [[ -n "${RUNNER_TOOL_CACHE:-}" ]]; then
  for candidate in "$RUNNER_TOOL_CACHE"/node/*/x64/bin/node; do
    [[ -x "$candidate" ]] || continue
    version="$("$candidate" -p 'process.versions.node')"
    is_compatible "$version" || continue
    if [[ "$version" == "$required" ]]; then
      selected="$candidate"
      selected_version="$version"
      break
    fi
    newest="$(printf '%s\n%s\n' "$selected_version" "$version" | sort -V | tail -n1)"
    if [[ -z "$selected" || "$newest" == "$version" ]]; then
      selected="$candidate"
      selected_version="$version"
    fi
  done
fi

if [[ -z "$selected" ]] && command -v node >/dev/null 2>&1; then
  candidate="$(command -v node)"
  version="$(node -p 'process.versions.node')"
  if is_compatible "$version"; then
    selected="$candidate"
    selected_version="$version"
  fi
fi

if [[ -z "$selected" ]]; then
  npm_cmd="$(command -v npm || true)"
  if [[ -z "$npm_cmd" ]]; then
    echo "::error::No compatible Node.js was cached, and npm is not available to bootstrap one."
    exit 1
  fi
  runtime_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/nounarchive-node-runtime"
  echo "Node.js $required is not cached; installing the exact Linux x64 runtime from npm."
  "$npm_cmd" install --prefix "$runtime_dir" --no-save --no-package-lock --ignore-scripts --no-audit --no-fund "node-linux-x64@$required"
  selected="$runtime_dir/node_modules/node-linux-x64/bin/node"
  if [[ ! -x "$selected" ]]; then
    echo "::error::The Node.js runtime package did not provide an executable."
    exit 1
  fi
  selected_version="$("$selected" -p 'process.versions.node')"
  if [[ "$selected_version" != "$required" ]]; then
    echo "::error::The downloaded Node.js version does not match .nvmrc."
    exit 1
  fi
fi

node_bin="$(dirname "$selected")"
if [[ ! -x "$node_bin/npm" ]] && ! command -v npm >/dev/null 2>&1; then
  echo "::error::npm is not available alongside the selected Node.js runtime."
  exit 1
fi
printf '%s\n' "$node_bin" >> "$GITHUB_PATH"
export PATH="$node_bin:$PATH"
printf 'Using Node.js %s (minimum %s)\n' "$selected_version" "$required"
node --version
npm --version
