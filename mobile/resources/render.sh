#!/usr/bin/env bash
# Renders the launcher icons and splash screens in mobile/android from the SVGs here.
# Needs rsvg-convert (librsvg) and ImageMagick. Run after changing an SVG and commit the PNGs.
set -euo pipefail
cd "$(dirname "$0")"
RES=../android/app/src/main/res
declare -A DENSITY=([mdpi]=1 [hdpi]=1.5 [xhdpi]=2 [xxhdpi]=3 [xxxhdpi]=4)

for d in "${!DENSITY[@]}"; do
  s=${DENSITY[$d]}
  px() { awk "BEGIN { printf \"%d\", $1 * $s }"; }
  rsvg-convert -w "$(px 48)" icon.svg -o "$RES/mipmap-$d/ic_launcher.png"
  rsvg-convert -w "$(px 48)" icon-round.svg -o "$RES/mipmap-$d/ic_launcher_round.png"
  rsvg-convert -w "$(px 108)" icon-foreground.svg -o "$RES/mipmap-$d/ic_launcher_foreground.png"
done

# Splash: the icon centred on the app's background colour, in every size the Capacitor template ships.
for f in "$RES"/drawable*/splash.png; do
  dims=$(magick identify -format '%w %h' "$f")
  w=${dims% *} h=${dims#* }
  size=$(( (w < h ? w : h) * 3 / 10 ))
  rsvg-convert -w "$size" icon.svg | magick -size "${w}x${h}" xc:'#12111a' - -gravity center -composite -strip "$f"
done

# Favicon of the host and guest pages.
cp icon.svg ../../web/public/icon.svg
