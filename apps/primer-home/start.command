#!/bin/zsh
repo_dir="${0:A:h}/../.."
cd -- "$repo_dir" || exit 1
if [[ ! -d node_modules ]]; then
  npm ci --no-audit --no-fund || exit 1
fi
exec npm run dev --workspace @astforum/primer-home
