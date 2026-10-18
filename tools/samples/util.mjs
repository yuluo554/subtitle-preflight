/**
 * 样本生成与真值的共用基础设施（只被 tools/** 使用，不进产物）。
 *
 * 纪律：
 *  - 输出一律 LF（除显式 CRLF 变体）；文件按 **Unicode 码点序** 写出；固定种子（本生成器不用随机）。
 *  - 阈值不在这里写死：全部从 `data/ruleset.v1.json` 读（K1 单一真相源）。
 *  - 植入器自证：每处植入都给出（干净基线, 变异文本）并对，断言 diff 非空。
 *  - 内容白名单：只用虚构名；禁用词表命中即抛错。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../bundle.mjs";

export const SAMPLES_DIR = "data/samples";
export const TRUTH_DIR = "data/truth";

export function readRuleset() {
  return JSON.parse(readFileSync(join(ROOT, "data/ruleset.v1.json"), "utf8"));
}

/** 按 Unicode 码点序排序（不是 UTF-16 码元序，代理对不参与本仓库文件名）。 */
export function sortByCodePoint(list) {
  return list.slice().sort((a, b) => {
    const ac = Array.from(a);
    const bc = Array.from(b);
    const len = Math.min(ac.length, bc.length);
    for (let i = 0; i < len; i += 1) {
      const av = ac[i].codePointAt(0);
      const bv = bc[i].codePointAt(0);
      if (av !== bv) return av < bv ? -1 : 1;
    }
    return ac.length - bc.length;
  });
}

/** 行号累加器：push 一行返回它的 1-based 行号。 */
export class Builder {
  constructor() {
    this.lines = [];
  }
  push(line) {
    this.lines.push(line);
    return this.lines.length;
  }
  /** 行号（下一条将要 push 的行）。 */
  get nextLineNo() {
    return this.lines.length + 1;
  }
  get lineCount() {
    return this.lines.length;
  }
  text() {
    return this.lines.join("\n") + "\n";
  }
}

/** 文本 → LF 字节；可选 UTF-8 BOM / CRLF。 */
export function encodeText(text, opts) {
  const o = opts || {};
  let body = o.crlf ? text.replace(/\n/g, "\r\n") : text;
  const parts = [];
  if (o.bom) parts.push(Buffer.from([0xef, 0xbb, 0xbf]));
  parts.push(Buffer.from(body, "utf8"));
  return Buffer.concat(parts);
}

/* ---------- GBK 编码（无第三方依赖，靠 TextDecoder 反查） ---------- */

let gbkMap = null;

function buildGbkMap() {
  const decoder = new TextDecoder("gbk", { fatal: true });
  const map = new Map();
  const pair = new Uint8Array(2);
  for (let b1 = 0x81; b1 <= 0xfe; b1 += 1) {
    for (let b2 = 0x40; b2 <= 0xfe; b2 += 1) {
      if (b2 === 0x7f) continue;
      pair[0] = b1;
      pair[1] = b2;
      let ch;
      try {
        ch = decoder.decode(pair);
      } catch {
        continue;
      }
      if (ch.length === 1 && !map.has(ch)) map.set(ch, [b1, b2]);
    }
  }
  if (map.size === 0) throw new Error("宿主 TextDecoder 不支持 gbk（ICU 缺失），无法生成 GBK 样本");
  return map;
}

export function gbkCapable() {
  try {
    new TextDecoder("gbk", { fatal: true }).decode(new Uint8Array([0xb5, 0xc4]));
    return true;
  } catch {
    return false;
  }
}

/** 文本 → GBK 字节；往返自证（解码回原文），有字符不在表里直接抛错。 */
export function encodeGbk(text, opts) {
  if (!gbkMap) gbkMap = buildGbkMap();
  const o = opts || {};
  const out = [];
  if (o.bom) out.push(0xef, 0xbb, 0xbf);
  const body = o.crlf ? text.replace(/\n/g, "\r\n") : text;
  for (const ch of Array.from(body)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) {
      out.push(cp);
      continue;
    }
    const found = gbkMap.get(ch);
    if (!found) throw new Error(`GBK 表里没有字符 ${ch}（U+${cp.toString(16).toUpperCase()}）`);
    out.push(found[0], found[1]);
  }
  const bytes = Buffer.from(out);
  const back = new TextDecoder("gbk", { fatal: true }).decode(bytes);
  if (back !== body) throw new Error(`GBK 往返不一致：${JSON.stringify(body)} → ${JSON.stringify(back)}`);
  return bytes;
}

/* ---------- 可见字符度量（口径来自 §4） ---------- */

/** 全角码点区间；区间外一律按半角计。 */
const FULL_RANGES = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

export function isFullWidth(ch) {
  const cp = ch.codePointAt(0);
  for (const [lo, hi] of FULL_RANGES) if (cp >= lo && cp <= hi) return true;
  return false;
}

const KANA = /[\u3041-\u30ff]/;

/** 剥离不计入可见字符的装饰：ASS 覆写块 / HTML 标签 / SDH 方括号与圆括号 / 音符。 */
export function stripDecorations(line) {
  return String(line)
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/♪/g, "");
}

/** 一行 → 千分字符宽度（全角 1000 / 半角 500，空白与换行不计）。 */
export function lineWidthMilli(line) {
  let milli = 0;
  for (const ch of Array.from(stripDecorations(line))) {
    if (/\s/.test(ch)) continue;
    milli += isFullWidth(ch) ? 1000 : 500;
  }
  return milli;
}

export function dominantLang(textLines) {
  let full = 0;
  let half = 0;
  let kana = 0;
  for (const line of textLines) {
    for (const ch of Array.from(stripDecorations(line))) {
      if (/\s/.test(ch)) continue;
      if (isFullWidth(ch)) {
        full += 1;
        if (KANA.test(ch)) kana += 1;
      } else {
        half += 1;
      }
    }
  }
  if (full === 0) return "en";
  if (kana * 2 >= full) return "ja";
  if (full >= half) return "zh";
  return "en";
}

/** 一条 cue 的可见字符度量（供人工标注独立复算；不调用任何被测实现）。 */
export function measureCue(textLines) {
  let charsMilli = 0;
  let maxLineWidthMilli = 0;
  let visibleLineCount = 0;
  for (const line of textLines) {
    const width = lineWidthMilli(line);
    if (width > 0) visibleLineCount += 1;
    if (width > maxLineWidthMilli) maxLineWidthMilli = width;
    charsMilli += width;
  }
  return { charsMilli, maxLineWidthMilli, visibleLineCount };
}

/* ---------- 植入器自证 ---------- */

/**
 * 断言"干净基线里确实没有这个缺陷"：变异文本必须与干净基线不同。
 * @returns {{id:string, clean:string, mutant:string, diffNonEmpty:true}}
 */
export function plant(id, clean, mutant) {
  if (typeof clean !== "string" || typeof mutant !== "string") {
    throw new Error(`植入 ${id}: clean/mutant 必须是字符串`);
  }
  if (clean === mutant) {
    throw new Error(`植入 ${id}: diff 为空（干净基线里已经有这个缺陷，样本不得计入检出率分母）`);
  }
  return { id, clean, mutant, diffNonEmpty: true };
}

/* ---------- 文件系统 ---------- */

export function listFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

export function relFromRoot(abs) {
  return abs.slice(ROOT.length).replace(/^[\\/]/, "").split("\\").join("/");
}
