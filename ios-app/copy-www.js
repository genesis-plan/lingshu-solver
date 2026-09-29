// 把仓库根的自包含网页（求解器单文件 + PWA 资源）同步到 Capacitor webDir (../www)
// 并在原生包里注入原生桥脚本（主站 PWA 的 index.html 不受影响）
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const out = path.resolve(root, 'www');
fs.mkdirSync(out, { recursive: true });

const files = ['index.html', 'manifest.json', 'sw.js', 'native-bridge.js', 'icon-192.png', 'icon-512.png', 'icon.svg'];
for (const f of files) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, f));
}

// 仅在 www 副本里注入原生桥（Capacitor 容器内生效，Web/PWA 不加）
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!html.includes('native-bridge.js')) {
  html = html.replace('</body>', '<script src="native-bridge.js" defer></script>\n</body>');
  fs.writeFileSync(path.join(out, 'index.html'), html);
}
console.log('www synced (with native bridge for Capacitor)');
