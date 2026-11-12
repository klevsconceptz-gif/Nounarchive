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
  case "$required" in
    22.22.3) expected_integrity='sha512-L57AfRf8K3F0na3lGYXYrBGO/pafgDrswNE8hjuMCyqYcxXrm0UepJBaCLP8PyjfnDoJGyIIf1oU0UTASOEpZg==' ;;
    *) echo "::error::No verified npm runtime archive is configured for Node.js $required."; exit 1 ;;
  esac
  runtime_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/nounarchive-node-runtime"
  archive="$runtime_dir/node-linux-x64-$required.tgz"
  mkdir -p "$runtime_dir"
  echo "Node.js $required is not cached; downloading its integrity-pinned Linux x64 runtime from npm."
  curl --fail --silent --show-error --location "https://registry.npmjs.org/node-linux-x64/-/node-linux-x64-$required.tgz" --output "$archive"
  actual_integrity="sha512-$(openssl dgst -sha512 -binary "$archive" | base64 -w0)"
  if [[ "$actual_integrity" != "$expected_integrity" ]]; then
    echo "::error::The downloaded Node.js archive failed its SHA-512 integrity check."
    exit 1
  fi
  tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$runtime_dir"
  selected="$runtime_dir/package/bin/node"
  if [[ ! -x "$selected" ]]; then
    echo "::error::The verified Node.js runtime archive did not provide an executable."
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
