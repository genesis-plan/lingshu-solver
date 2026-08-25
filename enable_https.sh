#!/bin/bash
# enable_https.sh —— 备案批下后，将裸IP HTTP 的 MCP 端点切到固定 HTTPS 域名
# 在服务器（腾讯云轻量 159.75.154.206）以 root 执行：
#   DOMAIN=hongchenlingjing.com ADMIN_EMAIL=you@example.com bash enable_https.sh
# 前置：域名已解析到本机公网 IP；80 端口对外可达（Let's Encrypt http-01 挑战需要）
set -euo pipefail

DOMAIN="${DOMAIN:-hongchenlingjing.com}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@${DOMAIN}}"
LOCAL_PORT="${LOCAL_PORT:-3000}"
CONF="/etc/nginx/conf.d/${DOMAIN}.conf"

echo "[1/5] 前置检查"
echo "    域名 ${DOMAIN} 须已解析到本机公网 IP，且 80 端口对外可达（ACME http-01 挑战需要）"
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1)
echo "    当前解析到: ${RESOLVED:-<无>}"
command -v certbot >/dev/null 2>&1 || { echo "缺少 certbot，请先执行：apt-get install -y certbot python3-certbot-nginx"; exit 1; }

echo "[2/5] 写入 nginx 反代配置 ${CONF}（占位符待注入）"
cat > "$CONF" <<'NGINX'
server {
    listen 80;
    server_name __DOMAIN__;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl;
    server_name __DOMAIN__;
    # SSL 证书由 certbot --nginx 自动写入本块

    location /mcp {
        proxy_pass http://127.0.0.1:__PORT__;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }
}
NGINX

echo "[3/5] 注入实际域名/端口，并申请 Let's Encrypt 证书"
sed -i "s/__DOMAIN__/${DOMAIN}/g; s/__PORT__/${LOCAL_PORT}/g" "$CONF"
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${ADMIN_EMAIL}" --redirect

echo "[4/5] 校验并重载 nginx + 确认求解器服务存活"
nginx -t
systemctl reload nginx
systemctl is-active lingshu || systemctl restart lingshu
systemctl is-active lingshu

echo "[5/5] 完成。请将以下 URL 回填各平台："
echo "    远程 MCP 端点： https://${DOMAIN}/mcp"
echo "    Smithery / Glama / README 中的裸IP端点(http://159.75.154.206:3000/mcp) 替换为上述 HTTPS 地址"
