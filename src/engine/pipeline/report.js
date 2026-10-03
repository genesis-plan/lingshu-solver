/* 模块 pipeline/report：构建期拼接区块（内部标识符保持原样，裸名引用保留）。改这个模块只动本文件，不要动 index.html。 */
function _ieeeReset() { _IEEE.nan = false; _IEEE.inf = false; _IEEE.divZero = false; _IEEE.domainErr = false; }

function _utf8Bytes(str) {
  var b = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) b.push(c);
    else if (c < 0x800) { b.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c < 0xd800 || c >= 0xe000) { b.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    else { i++; var c2 = str.charCodeAt(i); var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); b.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)); }
  }
  return b;
}

function _sha256(str) {
  function rrot(x, n) { return (x >>> n) | (x << (32 - n)); }
  var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var msg = _utf8Bytes(str);
  var l = msg.length;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0x00);
  var bitLen = l * 8;
  for (var p = 0; p < 4; p++) msg.push(0x00);
  msg.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);
  for (var off = 0; off < msg.length; off += 64) {
    var w = new Array(64);
    for (var t = 0; t < 16; t++) { var j = off + t * 4; w[t] = (msg[j] << 24) | (msg[j+1] << 16) | (msg[j+2] << 8) | msg[j+3]; }
    for (var t2 = 16; t2 < 64; t2++) { var s0 = rrot(w[t2-15],7) ^ rrot(w[t2-15],18) ^ (w[t2-15] >>> 3); var s1 = rrot(w[t2-2],17) ^ rrot(w[t2-2],19) ^ (w[t2-2] >>> 10); w[t2] = (w[t2-16] + s0 + w[t2-7] + s1) | 0; }
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (var t3 = 0; t3 < 64; t3++) {
      var S1 = rrot(e,6) ^ rrot(e,11) ^ rrot(e,25); var ch = (e & f) ^ (~e & g); var t1 = (h + S1 + ch + K[t3] + w[t3]) | 0;
      var S0 = rrot(a,2) ^ rrot(a,13) ^ rrot(a,22); var maj = (a & b) ^ (a & c) ^ (b & c); var t2v = (S0 + maj) | 0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2v)|0;
    }
    H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0; H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
  }
  var hex = '';
  for (var hi = 0; hi < 8; hi++) { var vv = H[hi]; for (var ss = 28; ss >= 0; ss -= 4) hex += ((vv >>> ss) & 0xf).toString(16); }
  return hex;
}

function _computeReportId(state) {
  try {
    var seed = JSON.stringify([
      state.equationStrs || [],
      state.varNames || [],
      state.decimals,
      state._initD0 || null,
      !!state.fastMode,
      SOLVER_VERSION
    ]);
    return 'ls1-' + _sha256(seed);
  } catch (e) { return null; }
}
