#!/bin/sh
set -e
DEST=/mnt/project-files/x-cleaner
mkdir -p "$DEST"
cd "$(dirname "$0")/.."
git ls-files -co --exclude-standard | tar -cf - -T - | (cd "$DEST" && tar -xf -)
