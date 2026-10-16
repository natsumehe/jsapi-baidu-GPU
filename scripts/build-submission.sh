#!/usr/bin/env bash
# Regenerate the UTF-8 PDF whitepaper from Markdown.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v pandoc >/dev/null || { echo 'pandoc is required'; exit 1; }
command -v weasyprint >/dev/null || { echo 'weasyprint is required'; exit 1; }
cd "$ROOT/submission"
pandoc '作品说明书_V9.md' -f markdown+yaml_metadata_block -t html5 --standalone --toc --toc-depth=2 -o '.submission-render.html'
python3 - <<'PY'
from pathlib import Path
p=Path('.submission-render.html')
s=p.read_text(encoding='utf8')
import re
s=re.sub(r'(<h2 id="toc-title">).*?(</h2>)',r'\1目录\2',s,count=1)
p.write_text(s,encoding='utf8')
PY
weasyprint '.submission-render.html' '作品说明书_V9.pdf' -s 'print.css'
rm '.submission-render.html'
echo 'Generated submission/作品说明书_V9.pdf'
