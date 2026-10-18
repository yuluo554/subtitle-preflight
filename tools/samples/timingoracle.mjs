/**
 * 时序规则的**独立**判定式实现（真值侧，只被 tools/** 使用）。
 *
 * 为什么独立：plan/04 §三 要求"期望值可由输入独立复算"——标注脚本**不调用被测实现**。
 * 本文件按 `plan/03` §二 的判定表重写一遍（不 import src/core），
 * 与 M2/M3 的规则引擎形成差分对照，而不是"比对两份预先算好的答案"。
 *
 * 阈值从 `data/ruleset.v1.json` 读（K1：不在这里写第二份数值）。
 */
import { readRuleset } from "./util.mjs";

const RULESET = readRuleset();

/** 时间码文本 → 精度问题（T12）；小时位 > 2 位 / 毫秒位 ≠ 3 位 / 亚毫秒。 */
export function precisionIssuesOf(timecodeText) {
  const m =
    /^\s*(-)?(\d{1,4}):(\d{1,2}):(\d{1,2})[,.](\d{1,4})\s*-->\s*(-)?(\d{1,4}):(\d{1,2}):(\d{1,2})[,.](\d{1,4})/.exec(
      String(timecodeText)
    );
  if (!m) return [];
  const issues = [];
  if (m[2].length > 2) issues.push({ field: "startMs", detail: "小时位超过 2 位" });
  if (m[7].length > 2) issues.push({ field: "endMs", detail: "小时位超过 2 位" });
  if (m[5].length > 3) issues.push({ field: "startMs", detail: "亚毫秒精度被截断" });
  if (m[10].length > 3) issues.push({ field: "endMs", detail: "亚毫秒精度被截断" });
  if (m[5].length !== 3) issues.push({ field: "startMs", detail: "毫秒位不是 3 位" });
  if (m[10].length !== 3) issues.push({ field: "endMs", detail: "毫秒位不是 3 位" });
  return issues;
}

function compare(a, b) {
  if (a.line !== b.line) return a.line - b.line;
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  if ((a.field || "") !== (b.field || "")) return (a.field || "") < (b.field || "") ? -1 : 1;
  return 0;
}

/**
 * @param {Array<{startMs?:number,endMs?:number,textLines?:string[],timeLine:number,unparsable?:boolean}>} cues
 * @param {{mediaDurationMs?:number}} opts
 * @returns {{findings:Array<{ruleId:string,line:number,field:string}>, skipped:Array}}
 */
export function runTimingOracle(cues, opts) {
  const o = opts || {};
  const gapMin = RULESET["timing.gapMin"];
  const findings = [];
  const skipped = [];
  const at = (ruleId, cue, field) => findings.push({ ruleId, line: cue.timeLine, field });

  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i];
    if (cue.unparsable) {
      at("timing.unparsable-timecode", cue, "timecode");
      continue;
    }
    const prev = i > 0 ? cues[i - 1] : null;

    if (cue.startMs < 0) at("timing.negative-start", cue, "startMs");

    if (cue.endMs < cue.startMs) at("timing.negative-duration", cue, "endMs");
    else if (cue.endMs === cue.startMs) at("timing.zero-duration", cue, "endMs");

    if (cue.timecodeText) {
      for (const issue of precisionIssuesOf(cue.timecodeText)) {
        at("timing.timecode-precision", cue, issue.field);
      }
    }

    if (prev && !prev.unparsable) {
      if (cue.startMs < prev.endMs) {
        at("timing.overlap", cue, "startMs");
      } else if (cue.startMs - prev.endMs < gapMin) {
        at("timing.gap-too-small", cue, "startMs");
      }
      if (cue.startMs < prev.startMs) at("timing.non-monotonic", cue, "startMs");
      if (
        cue.startMs === prev.startMs &&
        cue.endMs === prev.endMs &&
        (cue.textLines || []).join("\n") === (prev.textLines || []).join("\n")
      ) {
        at("timing.duplicate-cue", cue, "text");
      }
    }
  }

  // 文件顺序 ≠ 时间顺序：整段只报一条，指向首个倒退位置
  const parsed = cues.filter((c) => !c.unparsable);
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i].startMs < parsed[i - 1].startMs) {
      at("timing.file-order-mismatch", parsed[i], "startMs");
      break;
    }
  }

  if (typeof o.mediaDurationMs === "number") {
    let last = null;
    for (const cue of parsed) if (!last || cue.endMs > last.endMs) last = cue;
    if (last && last.endMs > o.mediaDurationMs) at("timing.past-media-end", last, "endMs");
  } else {
    skipped.push({ ruleId: "timing.past-media-end", reason: "media_duration_unknown" });
  }

  // 与 src/core/rules/timing.js 一致：T11 未实现必须显式声明（K7），不静默返回空
  skipped.push({ ruleId: "timing.fps-drift", reason: "not_implemented" });

  findings.sort(compare);
  return { findings, skipped };
}

export const TIMING_CLASSES = [
  "T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10", "T11", "T12",
];

export const CLASS_RULE = {
  T01: "timing.overlap",
  T02: "timing.zero-duration",
  T03: "timing.negative-duration",
  T04: "timing.gap-too-small",
  T05: "timing.non-monotonic",
  T06: "timing.duplicate-cue",
  T07: "timing.negative-start",
  T08: "timing.past-media-end",
  T09: "timing.unparsable-timecode",
  T10: "timing.file-order-mismatch",
  T11: "timing.fps-drift",
  T12: "timing.timecode-precision",
};
