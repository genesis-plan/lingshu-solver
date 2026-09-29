#!/usr/bin/env bash
# 在 Windows 的 Git Bash 里跑（自带 openssl，无需 Mac、无需装任何东西）。
# 目的：生成 Apple「Apple Distribution」分发证书所需材料，纯命令行完成。
#
# 步骤：
#   ① bash ios-app/csr.sh gen
#        → 生成 ios_dist.csr + ios_dist.key
#   ② 去 https://developer.apple.com/account/resources/certificates/add
#      选 "Apple Distribution"，上传 ios_dist.csr，下载证书命名为 ios_dist.cer（放本目录）
#   ③ bash ios-app/csr.sh p12 "<你的p12密码>"
#        → 生成 ios_dist.p12
#   ④ base64 ios_dist.p12 | tr -d '\n'
#        → 把这一长串存为仓库 Secret: IOS_P12_BASE64
#        → IOS_P12_PASSWORD 存第③步的密码
#
# 这些文件都是私钥/证书，**绝不要 commit 进仓库**（已在 .gitignore 忽略）。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
case "$1" in
  gen)
    openssl req -new -newkey rsa:2048 -nodes \
      -keyout ios_dist.key -out ios_dist.csr \
      -subj "/CN=GUANGZHOU HONGCHEN LINGJING/emailAddress=admin@hongchenlingjing.com/C=CN"
    echo "✔ 已生成 ios_dist.csr 与 ios_dist.key"
    echo "  下一步：去 Apple 后台(Certificates → +) 上传 ios_dist.csr，下载 .cer 改名 ios_dist.cer 放到本目录"
    ;;
  p12)
    [ -z "$2" ] && { echo "用法: bash ios-app/csr.sh p12 <密码>"; exit 1; }
    [ -f ios_dist.cer ] || { echo "缺少 ios_dist.cer（先按 gen 步骤去 Apple 后台换证书）"; exit 1; }
    openssl x509 -inform DER -in ios_dist.cer -out ios_dist.pem 2>/dev/null \
      || openssl x509 -inform PEM -in ios_dist.cer -out ios_dist.pem
    openssl pkcs12 -export -out ios_dist.p12 -inkey ios_dist.key -in ios_dist.pem -passout pass:"$2"
    echo "✔ 已生成 ios_dist.p12"
    echo "  取 base64 存 Secret:  base64 ios_dist.p12 | tr -d '\n'"
    ;;
  *)
    echo "用法: bash ios-app/csr.sh {gen|p12 <密码>}"
    exit 1
    ;;
esac
