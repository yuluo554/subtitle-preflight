/**
 * 卫生规则的**独立**判定式实现（真值侧，只被 tools/** 使用）。
 *
 * 按 `plan/03` §四 的规则表 + `data/ruleset.v1.json` 的 `hygiene.*` 口径重写一遍，
 * 不 import src/core（M5 才实现）。每条规则都配"已知不报"白名单路径，precision 优先。
 *
 * 行号口径：卫生属**文本类** finding，`line` 取 cue 的 sourceLine（plan/02 §3.1）。
 */
import { readRuleset } from "./util.mjs";
import { stripDecorations } from "./util.mjs";

const RULESET = readRuleset();
const WHITELIST = RULESET["hygiene.whitelist"];

export const HYGIENE_RULES = [
  "hygiene.cjk-latin-spacing",
  "hygiene.punctuation-width",
  "hygiene.trailing-punctuation",
  "hygiene.unclosed-tag",
  "hygiene.ass-override-residue",
  "hygiene.placeholder-residue",
  "hygiene.font-tag-residue",
  "hygiene.sdh-marker",
  "hygiene.all-caps",
  "hygiene.repeated-punctuation",
];

const CJK = /[\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN_OR_DIGIT = /[A-Za-z0-9]/;

function isWhitelistedToken(token) {
  return WHITELIST.includes(token);
}

/** S01：CJK 与拉丁/数字直接相邻，且该拉丁词不在白名单。 */
function cjkLatinSpacing(raw) {
  const text = raw;
  for (let i = 0; i + 1 < text.length; i += 1) {
    const a = text[i];
    const b = text[i + 1];
    let latinStart = -1;
    if (CJK.test(a) && LATIN_OR_DIGIT.test(b)) latinStart = i + 1;
    else if (LATIN_OR_DIGIT.test(a) && CJK.test(b)) {
      latinStart = i;
      while (latinStart > 0 && LATIN_OR_DIGIT.test(text[latinStart - 1])) latinStart -= 1;
    }
    if (latinStart < 0) continue;
    let end = latinStart;
    while (end < text.length && LATIN_OR_DIGIT.test(text[end])) end += 1;
    const token = text.slice(latinStart, end);
    if (isWhitelistedToken(token)) continue;
    return true;
  }
  return false;
}

/** S02：中文语境出现半角 ,.!?:; / 英文语境出现全角标点。 */
function punctuationWidth(raw, lang) {
  let text = raw;
  for (const w of WHITELIST) text = text.split(w).join("");
  text = text.replace(/\d+\.\d+/g, "").replace(/\.\.\./g, "");
  if (lang === "en") return /[，。！？：；（）]/.test(raw);
  return /[,!?:;]/.test(text);
}

/** S03：行尾为 。/.（问号感叹号不报）；省略号与白名单缩写不报。 */
function trailingPunctuation(raw) {
  const text = raw.trim();
  if (/[。]$/.test(text)) return true;
  if (!/\.$/.test(text)) return false;
  if (/\.\.\.$/.test(text)) return false;
  for (const w of WHITELIST) if (text.endsWith(w)) return false;
  return true;
}

/** S04：<i>/<b>/<u> 未闭合或交叉嵌套；自闭合形态不报。 */
function unclosedTag(raw) {
  const stack = [];
  const re = /<\/?([ibu])\s*\/?>/gi;
  let m;
  while ((m = re.exec(raw))) {
    const tag = m[1].toLowerCase();
    const whole = m[0];
    if (/\/\s*>$/.test(whole) && !/^<\//.test(whole)) continue; // 自闭合 <i/>
    if (/^<\//.test(whole)) {
      if (stack.length === 0 || stack[stack.length - 1] !== tag) return true;
      stack.pop();
    } else {
      stack.push(tag);
    }
  }
  return stack.length > 0;
}

/** S05：非 ASS 输出含 {\...} 覆写块，或 { 未闭合。 */
function assOverrideResidue(raw) {
  if (/\{\\[^}]*\}/.test(raw)) return true;
  let depth = 0;
  for (const ch of raw) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    if (depth < 0) return true;
  }
  return depth !== 0;
}

/** S06：残留 %s / %1$s / {0} / {name}；数学表达式 {x} 不报。 */
function placeholderResidue(raw) {
  if (/%(\d+\$)?[sdf]/.test(raw)) return true;
  if (/\{\d+\}/.test(raw)) return true;
  const named = raw.match(/\{[A-Za-z_][A-Za-z0-9_]*\}/g) || [];
  return named.some((token) => !/^\{[a-z]\}$/.test(token));
}

/** S07：残留 <font ...>。 */
function fontTagResidue(raw) {
  return /<font\b[^>]*>/i.test(raw);
}

/** S08：SDH 标记 [music] / （笑声）一类 / ♪；整条以 ♪ 起止的歌词语境不报。 */
function sdhMarker(raw) {
  const text = raw.trim();
  if (/^♪[\s\S]*♪$/.test(text) && text.length > 2) return false;
  if (/\[music\]/i.test(raw)) return true;
  if (/（[^）]*(笑声|掌声|音乐|歌唱|欢呼)[^）]*）/.test(raw)) return true;
  return /♪/.test(raw);
}

/** S09：全大写且可见长度 ≥ hygiene.allCapsMinLength（半角字符数）。 */
function allCaps(raw) {
  const visible = stripDecorations(raw).replace(/\s/g, "");
  if (visible.length < RULESET["hygiene.allCapsMinLength"]) return false;
  if (!/[A-Za-z]/.test(visible)) return false;
  if (visible !== visible.toUpperCase()) return false;
  if (WHITELIST.includes(visible)) return false;
  return true;
}

/** S10：同一标点连续 ≥ hygiene.repeatPunctMin 次。 */
function repeatedPunctuation(raw) {
  const re = /([,.;!?，。！？：；、])\1+/g;
  let m;
  while ((m = re.exec(raw))) {
    if (m[0].length >= RULESET["hygiene.repeatPunctMin"]) return true;
  }
  return false;
}

/**
 * @param {Array<{textLines:string[]}>} cues
 * @param {number[]} lines 与 cues 一一对应的 sourceLine
 * @returns {Array<{index:number, line:number, ruleId:string}>}
 */
export function runHygieneOracle(cues, lines) {
  const out = [];
  cues.forEach((cue, i) => {
    for (const raw of cue.textLines) {
      const lang = /[\u4e00-\u9fff]/.test(raw) ? "zh" : "en";
      const checks = [
        ["hygiene.cjk-latin-spacing", cjkLatinSpacing(raw)],
        ["hygiene.punctuation-width", punctuationWidth(raw, lang)],
        ["hygiene.trailing-punctuation", trailingPunctuation(raw)],
        ["hygiene.unclosed-tag", unclosedTag(raw)],
        ["hygiene.ass-override-residue", assOverrideResidue(raw)],
        ["hygiene.placeholder-residue", placeholderResidue(raw)],
        ["hygiene.font-tag-residue", fontTagResidue(raw)],
        ["hygiene.sdh-marker", sdhMarker(raw)],
        ["hygiene.all-caps", allCaps(raw)],
        ["hygiene.repeated-punctuation", repeatedPunctuation(raw)],
      ];
      for (const [ruleId, hit] of checks) {
        if (hit) out.push({ index: i + 1, line: lines[i], ruleId });
      }
    }
  });
  return out;
}
