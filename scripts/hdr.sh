#!/bin/sh
# usage: hdr.sh file  (prepends license header in place)
f="$1"; t="$(mktemp)"; cat "$(dirname "$0")/header.txt" "$f" > "$t" && mv "$t" "$f"
