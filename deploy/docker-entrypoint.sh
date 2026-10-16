#!/bin/sh
set -eu

: "${BAIDU_MAP_AK:?BAIDU_MAP_AK is required}"

cat > /usr/share/nginx/html/config.js <<EOF
window.__APP_CONFIG__ = {
    baiduMapAk: "${BAIDU_MAP_AK}"
};
EOF

exec "$@"
