// 本地音乐内嵌封面提取（纯 JS 字节解析，零原生依赖）
// 支持：MP3 (ID3v2.2/2.3/2.4 APIC/PIC)、FLAC (METADATA_BLOCK PICTURE)、M4A (covr atom)
// 参考 lx-music-mobile 用原生模块（react-native-local-media-metadata）实现同类功能，
// 此处改用纯 JS + expo-file-system 分段读（position/length），避免引入需 prebuild 的原生依赖。
//
// 设计要点：
// 1. 只读文件头部最多 1MB（封面 APIC 一般在前几百 KB），不全量加载大文件
// 2. 提取的图片写入 cacheDirectory/covers/，返回 file:// URI
//    （RN Image 与通知栏原生层都支持 file://，且天然带磁盘缓存）
// 3. 内存 Map 缓存 + in-flight Promise 去重，切歌回放不重复解析
// 4. 解析失败返回 null（UI 回落占位图），永不抛错阻塞播放

import * as FileSystem from 'expo-file-system/legacy';

// === base64 编解码（纯 JS，避免依赖 atob/btoa 的平台差异） ===
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

function b64ToBytes(b64) {
  const clean = b64.replace(/[\r\n\s]+/g, '');
  let len = clean.length;
  if (len === 0) return new Uint8Array(0);
  let placeHolders = 0;
  if (clean[len - 1] === '=') {
    placeHolders++;
    if (clean[len - 2] === '=') placeHolders++;
  }
  const bytes = new Uint8Array((len * 3) / 4 - placeHolders);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)];
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = clean[i + 2] === '=' ? 0 : B64_LOOKUP[clean.charCodeAt(i + 2)];
    const d = clean[i + 3] === '=' ? 0 : B64_LOOKUP[clean.charCodeAt(i + 3)];

    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (p < bytes.length) bytes[p++] = (n >> 16) & 0xff;
    if (p < bytes.length) bytes[p++] = (n >> 8) & 0xff;
    if (p < bytes.length) bytes[p++] = n & 0xff;
  }
  return bytes;
}

function bytesToB64(bytes) {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63];
    out += (i + 1 < len) ? B64_CHARS[(n >> 6) & 63] : '=';
    out += (i + 2 < len) ? B64_CHARS[n & 63] : '=';
  }
  return out;
}

// === 小工具 ===
function readU32(b, o) { return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]; }
function readU24(b, o) { return (b[o] << 16) | (b[o + 1] << 8) | b[o + 2]; }
function readSyncsafe(b, o) {
  // ID3v2.4 syncsafe integer: 每 7 位有效
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

function sniffImage(bytes, start) {
  // 返回 { mime, ext } 或 null
  if (start + 3 < bytes.length) {
    if (bytes[start] === 0xff && bytes[start + 1] === 0xd8 && bytes[start + 2] === 0xff) {
      return { mime: 'image/jpeg', ext: 'jpg' };
    }
    if (bytes[start] === 0x89 && bytes[start + 1] === 0x50 && bytes[start + 2] === 0x4e && bytes[start + 3] === 0x47) {
      return { mime: 'image/png', ext: 'png' };
    }
    // GIF
    if (bytes[start] === 0x47 && bytes[start + 1] === 0x49 && bytes[start + 2] === 0x46) {
      return { mime: 'image/gif', ext: 'gif' };
    }
    // WebP (RIFF....WEBP)
    if (bytes[start] === 0x52 && bytes[start + 1] === 0x49 && bytes[start + 2] === 0x46 && bytes[start + 3] === 0x46 &&
        start + 11 < bytes.length && bytes[start + 8] === 0x57 && bytes[start + 9] === 0x45 && bytes[start + 10] === 0x42 && bytes[start + 11] === 0x50) {
      return { mime: 'image/webp', ext: 'webp' };
    }
    // BMP
    if (bytes[start] === 0x42 && bytes[start + 1] === 0x4d) {
      return { mime: 'image/bmp', ext: 'bmp' };
    }
  }
  return null;
}

// === ID3v2 解析（MP3） ===
// 返回 { offset, length } 指向图片字节在 tag 内的区间，或 null
function parseId3v2(bytes) {
  if (bytes.length < 20) return null;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null; // "ID3"
  const ver = bytes[3]; // 2 / 3 / 4
  const tagSize = readSyncsafe(bytes, 6); // 头 10 字节后的 tag 主体大小
  const tagEnd = Math.min(10 + tagSize, bytes.length);

  const frameHdr = ver === 2 ? 6 : 10;
  let pos = 10;
  let firstPic = null; // 万一没有 picType=3（front cover），接受任何 APIC

  while (pos + frameHdr <= tagEnd) {
    if (bytes[pos] === 0) break; // padding
    let id, size, headerLen;
    if (ver === 2) {
      id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2]);
      size = (bytes[pos + 3] << 16) | (bytes[pos + 4] << 8) | bytes[pos + 5];
      headerLen = 6;
    } else {
      id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
      size = ver === 4 ? readSyncsafe(bytes, pos + 4) : readU32(bytes, pos + 4);
      headerLen = 10;
    }
    if (size <= 0 || pos + headerLen + size > tagEnd) break;

    const frame = bytes.subarray(pos + headerLen, pos + headerLen + size);

    if (id === 'APIC' || id === 'PIC') {
      let o = 0;
      const enc = frame[o]; o++;
      if (id === 'PIC') {
        // v2.2: 3 字符图像格式（如 "JPG"/"PNG"）
        o += 3;
      } else {
        // v2.3/2.4: mime 以 \x00 结尾（latin1）
        while (o < frame.length && frame[o] !== 0) o++;
        o++; // skip null
      }
      const picType = frame[o]; o++;
      // 跳过 description：latin1/utf8 单字节 0 结尾；utf16 双字节 0x0000 结尾
      if (enc === 1 || enc === 2) {
        while (o + 1 < frame.length && !(frame[o] === 0 && frame[o + 1] === 0)) o += 2;
        o += 2;
      } else {
        while (o < frame.length && frame[o] !== 0) o++;
        o++;
      }
      if (o < frame.length && sniffImage(frame, o)) {
        const found = { offset: pos + headerLen + o, length: frame.length - o, picType, frame };
        if (picType === 3) return found; // front cover 优先
        if (!firstPic) firstPic = found;
      }
    }
    pos += headerLen + size;
  }
  return firstPic;
}

// === FLAC PICTURE block 解析 ===
function parseFlac(bytes) {
  if (bytes.length < 8) return null;
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'fLaC') return null;
  let pos = 4;
  while (pos + 4 <= bytes.length) {
    const blockType = bytes[pos] & 0x7f;
    const isLast = (bytes[pos] & 0x80) !== 0;
    const blockSize = readU24(bytes, pos + 1);
    pos += 4;
    if (blockType === 6) {
      // PICTURE: type(4) mimeLen(4) mime descLen(4) desc w(4) h(4) depth(4) colors(4) dataLen(4) data
      let o = pos;
      o += 4; // picture type
      const mimeLen = readU32(bytes, o); o += 4;
      o += mimeLen; // mime string
      const descLen = readU32(bytes, o); o += 4;
      o += descLen;
      o += 16; // width/height/depth/colors
      const dataLen = readU32(bytes, o); o += 4;
      if (dataLen > 0 && o + dataLen <= bytes.length && sniffImage(bytes, o)) {
        return { offset: o, length: dataLen, picType: 3, frame: bytes };
      }
      return null;
    }
    pos += blockSize;
    if (isLast) break;
  }
  return null;
}

// === M4A covr atom 解析 ===
function parseMp4(bytes) {
  // 顶层 atom 遍历 → moov → udta → meta（4字节 version/flags）→ ilst → covr → data
  const findAtom = (buf, start, end, name) => {
    let p = start;
    while (p + 8 <= end) {
      const size = readU32(buf, p);
      const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
      if (size < 8) return null;
      if (type === name) return { start: p, size, dataStart: p + 8, dataEnd: Math.min(p + size, end) };
      p += size;
    }
    return null;
  };

  const moov = findAtom(bytes, 0, bytes.length, 'moov');
  if (!moov) return null;
  const udta = findAtom(bytes, moov.dataStart, moov.dataEnd, 'udta');
  if (!udta) return null;
  const meta = findAtom(bytes, udta.dataStart, udta.dataEnd, 'meta');
  if (!meta) return null;
  const ilst = findAtom(bytes, meta.dataStart + 4, meta.dataEnd, 'ilst'); // meta 有 4 字节 version/flags
  if (!ilst) return null;
  const covr = findAtom(bytes, ilst.dataStart, ilst.dataEnd, 'covr');
  if (!covr) return null;
  const data = findAtom(bytes, covr.dataStart, covr.dataEnd, 'data');
  if (!data) return null;
  // data atom: size(4) 'data'(4) type(4) locale(4) payload
  const payloadStart = data.dataStart + 8;
  if (payloadStart < data.dataEnd && sniffImage(bytes, payloadStart)) {
    return { offset: payloadStart, length: data.dataEnd - payloadStart, picType: 3, frame: bytes };
  }
  return null;
}

// === 缓存 ===
const coverUriCache = new Map(); // fileUri -> Promise<fileUri | null>
const MAX_READ = 1024 * 1024; // 最多读文件头 1MB（极少数超大封面会放弃，可接受）

function hashPath(p) {
  let h = 5381;
  const s = String(p);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36) + '_' + s.length.toString(36);
}

async function extractToFile(fileUri) {
  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists) return null;

  const readLen = Math.min(info.size || MAX_READ, MAX_READ);
  const b64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: readLen,
  });
  const bytes = b64ToBytes(b64);
  if (!bytes.length) return null;

  let pic = null;
  const magic3 = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  if (magic3 === 'ID3') {
    pic = parseId3v2(bytes);
  } else if (magic3 === 'fLa') {
    pic = parseFlac(bytes);
  } else if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    // 'ftyp' at offset 4 → MP4/M4A
    pic = parseMp4(bytes);
  }
  if (!pic || !pic.length) return null;

  // 提取图片字节 → 写缓存文件 → file:// URI
  const img = bytes.subarray(pic.offset, pic.offset + pic.length);
  const sniff = sniffImage(img, 0) || { mime: 'image/jpeg', ext: 'jpg' };
  const coversDir = (FileSystem.cacheDirectory || '') + 'covers/';
  await FileSystem.makeDirectoryAsync(coversDir, { intermediates: true }).catch(() => {});
  const outUri = coversDir + hashPath(fileUri) + '.' + sniff.ext;
  await FileSystem.writeAsStringAsync(outUri, bytesToB64(img), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return outUri;
}

/**
 * 提取本地音频内嵌封面，返回 file:// URI（含缓存与 in-flight 去重）
 * 失败返回 null。调用方负责容错显示占位图。
 */
export async function extractLocalCover(fileUri) {
  if (!fileUri || !fileUri.startsWith('file://')) return null;
  if (coverUriCache.has(fileUri)) return coverUriCache.get(fileUri);
  const p = extractToFile(fileUri)
    .then((uri) => {
      // 失败结果不缓存（null），换文件重试有机会恢复；成功结果长期缓存
      if (!uri) coverUriCache.delete(fileUri);
      return uri;
    })
    .catch((e) => {
      console.log('[Id3Cover] extract error:', e && e.message);
      coverUriCache.delete(fileUri);
      return null;
    });
  coverUriCache.set(fileUri, p);
  return p;
}

// 供测试导出纯函数
export const _test = { b64ToBytes, bytesToB64, parseId3v2, parseFlac, parseMp4, sniffImage };
