/**
 * 可读性规则的**独立**判定式实现（真值侧，只被 tools/** 使用）。
 *
 * 按 `plan/03` §三 的判定表 + `data/README.md` §4.2/§4.3 的口径键重写一遍，
 * 不 import src/core。单位一律**定点整数**（千分字符 milli）：
 *   全角 = 1000，半角 = 500；CPS = charsMilli / durationMs（= 字符/秒）。
 *
 * 行长上限的单位换算（M1 定稿，见 data/truth/README.md）：
 *   `line.maxWidthFull` / `line.maxWidthHalf` 的口径单位是"该档字符数"，
 *   折成 milli 后：zh/ja 上限 = full × 1000，en 上限 = half × 500。
 */
import { lineWidthMilli, dominantLang, measureCue, readRuleset } from "./util.mjs";

const RULESET = readRuleset();

export const READABILITY_RULES = [
  "readability.cps",
  "readability.line-length",
  "readability.too-many-lines",
  "readability.too-few-chars",
  "readability.duration-short",
  "readability.duration-long",
  "readability.repeated-text",
];

function cpsLimitOf(lang) {
  if (lang === "en") return RULESET["cps.en"];
  if (lang === "ja") return RULESET["cps.ja"];
  return RULESET["cps.zh"];
}

export function lineLengthLimitMilli(lang) {
  return lang === "en" ? RULESET["line.maxWidthHalf"] * 500 : RULESET["line.maxWidthFull"] * 1000;
}

/**
 * @param {Array<{textLines:string[], startMs:number, endMs:number}>} cues
 * @param {number[]} lines 与 cues 一一对应的行号（文本类 finding 取 sourceLine）
 * @returns {Array<{index:number, line:number, ruleId:string}>}
 */
export function runReadabilityOracle(cues, lines) {
  const out = [];
  const minCharsMilli = RULESET["line.minChars"] * 1000;
  const durMin = RULESET["duration.min"];
  const durMax = RULESET["duration.max"];
  const maxLines = RULESET["line.maxLines"];

  cues.forEach((cue, i) => {
    const line = lines[i];
    const lang = dominantLang(cue.textLines);
    const durationMs = cue.endMs - cue.startMs;
    const measured = measureCue(cue.textLines);

    if (durationMs > 0 && measured.charsMilli > cpsLimitOf(lang) * durationMs) {
      out.push({ index: i + 1, line, ruleId: "readability.cps" });
    }
    const limit = lineLengthLimitMilli(lang);
    if (cue.textLines.some((t) => lineWidthMilli(t) > limit)) {
      out.push({ index: i + 1, line, ruleId: "readability.line-length" });
    }
    if (measured.visibleLineCount > maxLines) {
      out.push({ index: i + 1, line, ruleId: "readability.too-many-lines" });
    }
    if (measured.charsMilli < minCharsMilli) {
      out.push({ index: i + 1, line, ruleId: "readability.too-few-chars" });
    }
    if (durationMs < durMin) {
      out.push({ index: i + 1, line, ruleId: "readability.duration-short" });
    }
    if (durationMs > durMax) {
      out.push({ index: i + 1, line, ruleId: "readability.duration-long" });
    }
    if (
      i > 0 &&
      cue.textLines.join("\n") === cues[i - 1].textLines.join("\n") &&
      (cue.startMs !== cues[i - 1].startMs || cue.endMs !== cues[i - 1].endMs)
    ) {
      out.push({ index: i + 1, line, ruleId: "readability.repeated-text" });
    }
  });

  out.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.ruleId < b.ruleId ? -1 : 1));
  return out;
}
