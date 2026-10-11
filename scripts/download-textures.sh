#!/usr/bin/env bash
# Downloads real NASA-based Saturn textures from Solar System Scope (CC BY 4.0).
# https://www.solarsystemscope.com/textures/   -> credit them in your video description.
set -u
mkdir -p web/textures
BASE="https://www.solarsystemscope.com/textures/download"
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"

# get <output> <url> [fallback urls...]  - tries each URL until one returns a real image
get() {
  out="$1"; shift
  for url in "$@"; do
    if curl -fsSL --retry 3 --retry-delay 2 -A "$UA" -e "https://www.solarsystemscope.com/textures/" -o "$out.part" "$url" \
       && [ "$(stat -c%s "$out.part")" -gt 20000 ]; then
      mv "$out.part" "$out"; echo "OK    $out  <-  $url"; return 0
    fi
  done
  rm -f "$out.part"; echo "WARN  could not download $out (renderer will use a procedural fallback)"; return 1
}

get web/textures/saturn.jpg            "$BASE/8k_saturn.jpg"            "$BASE/2k_saturn.jpg"
get web/textures/saturn_ring_alpha.png "$BASE/8k_saturn_ring_alpha.png" "$BASE/2k_saturn_ring_alpha.png"
get web/textures/stars_milky_way.jpg   "$BASE/8k_stars_milky_way.jpg"   "$BASE/2k_stars_milky_way.jpg"

ls -lh web/textures
