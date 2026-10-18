/**
 * SRT 的**独立**序列化与标注（真值侧）。
 *
 * 关键纪律：本文件的标注器是**独立实现**，不 import `src/core/**`，
 * 因此 M2 的解析器与这里的标注构成差分对照，而不是"比对两份预先算好的答案"。
 * 行号一律 1-based，指向归一化后的原文行。
 */
import { Builder } from "./util.mjs";

export const SRT_TIME_RE =
  /^\s*(-)?(\d{1,4}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(-)?(\d{1,4}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;
export const INDEX_RE = /^\s*\d+\s*$/;

export function pad(n, width) {
  return String(n).padStart(width, "0");
}

/** 毫秒 → `HH:MM:SS,mmm`（dot=true 用 `.`）；负值写成 `-HH:MM:SS,mmm`（T07 的输入形态）。 */
export function srtTime(ms, dot) {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const milli = abs % 1000;
  return `${sign}${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${dot ? "." : ","}${pad(milli, 3)}`;
}

/**
 * @param {Array<{startMs:number,endMs:number,text:string[],declaredIndex?:number|string|null,timecode?:string}>} specs
 * @param {{blankNoise?:boolean, trailingSpace?:boolean}} opts
 * @returns {{lines:string[], cues:Array<{sourceLine:number,timeLine:number,textLineNumbers:number[]}>}}
 */
export function buildSrt(specs, opts) {
  const o = opts || {};
  const b = new Builder();
  const cues = [];
  for (const spec of specs) {
    const sourceLine = b.nextLineNo;
    if (spec.declaredIndex !== null && spec.declaredIndex !== undefined) {
      b.push(String(spec.declaredIndex) + (o.trailingSpace ? "  " : ""));
    }
    const timecode =
      spec.timecode !== undefined
        ? spec.timecode
        : `${srtTime(spec.startMs, false)} --> ${srtTime(spec.endMs, false)}`;
    const timeLine = b.push(timecode + (o.trailingSpace ? "   " : ""));
    const textLineNumbers = [];
    for (const text of spec.text || []) {
      textLineNumbers.push(b.push(text + (o.trailingSpace ? "  " : "")));
    }
    cues.push({ sourceLine, timeLine, textLineNumbers });
    b.push("");
    if (o.blankNoise) b.push("");
  }
  return { lines: b.lines, cues };
}

/** 文本（行数组）→ cue 列表。独立实现，只依赖 SRT 公开语法。 */
export function annotateSrtLines(lines) {
  const cues = [];
  const diagnostics = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i += 1;
      continue;
    }
    const blockStart = i;
    let declaredIndex = null;
    let timeLineIdx = i;
    if (INDEX_RE.test(lines[i]) && i + 1 < lines.length && SRT_TIME_RE.test(lines[i + 1])) {
      declaredIndex = Number(lines[i].trim());
      timeLineIdx = i + 1;
    }
    const match = SRT_TIME_RE.exec(lines[timeLineIdx]);
    if (!match) {
      i += 1;
      continue;
    }
    const sourceLine = blockStart + 1;
    const timeLine = timeLineIdx + 1;
    if (declaredIndex === null) {
      diagnostics.push({ code: "parse.missing-index", line: timeLine });
    } else if (declaredIndex !== cues.length + 1) {
      diagnostics.push({ code: "parse.index-mismatch", line: sourceLine });
    }
    let j = timeLineIdx + 1;
    while (j < lines.length && lines[j].trim() !== "") j += 1;
    const textLines = lines.slice(timeLineIdx + 1, j);
    const textLineNumbers = [];
    for (let k = 0; k < textLines.length; k += 1) textLineNumbers.push(timeLineIdx + 2 + k);
    cues.push({
      index: cues.length + 1,
      declaredIndex,
      startMs: matchMs(match[1], match[2], match[3], match[4], match[5]),
      endMs: matchMs(match[6], match[7], match[8], match[9], match[10]),      textLines,
      textLineNumbers,
      sourceLine,
      endLine: textLines.length ? j : timeLine,
    });
    i = j;
  }
  return { cues, diagnostics };
}

function matchMs(sign, h, m, s, frac) {
  const value = Number(h) * 3600000 + Number(m) * 60000 + Number(s) * 1000 + Number(frac.padEnd(3, "0"));
  return sign ? -value : value;
}
