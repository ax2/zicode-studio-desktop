#!/usr/bin/env bash
# Deploy the ZiCode rendezvous relay to a Linux server (M1 prototype).
#
# Run on the server as root. Prerequisites:
#   1. DNS A record: relay.zicode.com -> this server's public IP
#   2. TCP 80/443 open in the cloud security group (Aliyun console)
#   3. The repository is reachable from GitHub (or pass an existing repo dir)
#
# Usage: ./deploy-relay.sh [repo-dir-or-git-url]
set -euo pipefail

SOURCE="${1:-https://github.com/ax2/zicode-studio-desktop.git}"
RELAY_PORT="${RELAY_PORT:-9760}"
DOMAIN="${DOMAIN:-relay.zicode.com}"
BUILD_DIR="${BUILD_DIR:-/root/zicode-relay-build}"

if [ ! -f "$SOURCE/src-tauri/src/bin/relay.rs" ]; then
  if [[ "$SOURCE" == http* ]]; then
    echo "==> cloning repository (shallow)"
    rm -rf "$BUILD_DIR"
    git clone --depth 1 "$SOURCE" "$BUILD_DIR"
    SOURCE="$BUILD_DIR"
  else
    echo "error: relay source not found under $SOURCE" >&2
    exit 1
  fi
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "==> installing Rust toolchain"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  export PATH="$HOME/.cargo/bin:$PATH"
fi

echo "==> building relay (release)"
cd "$SOURCE/src-tauri"
cargo build --release --bin zicode-relay

echo "==> installing binary"
install -m 0755 target/release/zicode-relay /usr/local/bin/zicode-relay

echo "==> writing systemd unit"
cat > /etc/systemd/system/zicode-relay.service <<'EOF'
[Unit]
Description=ZiCode rendezvous relay
After=network.target

[Service]
ExecStart=/usr/local/bin/zicode-relay 127.0.0.1:9760
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now zicode-relay

echo "==> writing nginx site"
cat > "/etc/nginx/sites-available/${DOMAIN}.conf" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    location / {
        proxy_pass http://127.0.0.1:${RELAY_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 120s;
        client_max_body_size 16m;
    }
}
EOF
ln -sf "/etc/nginx/sites-available/${DOMAIN}.conf" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
nginx -t

echo "==> issuing certificate (DNS A record for ${DOMAIN} must already exist)"
if command -v certbot >/dev/null 2>&1; then
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos \
    --register-unsafely-without-email --redirect \
    || echo "certbot failed; run manually: certbot --nginx -d ${DOMAIN}"
  nginx -s reload
else
  echo "certbot not installed. Install it, then run: certbot --nginx -d ${DOMAIN}"
fi

echo "==> relay deployed: https://${DOMAIN}"
echo "    desktop agent: wss://${DOMAIN}/relay/desktop"
echo "    mobile page:   https://${DOMAIN}/d/<deviceId>/app/"
echo "    status:        curl https://${DOMAIN}/relay/status"
