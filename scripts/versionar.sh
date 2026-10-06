#!/bin/sh
# Carimba no index.html a versão (hash do conteúdo) de cada JS/CSS: a Cloudflare manda o navegador
# guardar arquivos estáticos por 4 h, então sem isso o navegador mistura index.html novo com app.js velho.
# Rodar antes de cada commit que mexe em public/.
set -e
cd "$(dirname "$0")/../public"
for f in tema.js app.js style.css vendor/chart.umd.min.js vendor/chartjs-adapter-date-fns.bundle.min.js; do
  v=$(sha1sum "$f" | cut -c1-10)
  sed -i -E "s#(\"/?${f})(\?v=[0-9a-f]+)?\"#\1?v=${v}\"#" index.html
done
grep -oE '(href|src)="[^"]+\?v=[0-9a-f]+"' index.html
