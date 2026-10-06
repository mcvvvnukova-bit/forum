#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if [[ ! -d node_modules ]]; then
  npm install --no-audit --no-fund || exit 1
fi
exec npm run dev
