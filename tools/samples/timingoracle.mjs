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

  // T11 fps 漂移：需要声明帧率；只用"干净对"作样本（与 src 同口径、独立实现）
  const driftOutcome = fitDriftOracle(cleanPairStarts(cues, gapMin), o.declaredFps);
  if (driftOutcome.ok) at("timing.fps-drift", { timeLine: 1 }, "fit");
  else skipped.push({ ruleId: "timing.fps-drift", reason: driftOutcome.reason, samples: driftOutcome.samples });

  findings.sort(compare);
  return { findings, skipped };
}

/**
 * 「干净对」起点序列：个体合法且相邻对合法的**最长连续段**（独立实现，与 src 同口径）。
 * @param {Array} cues
 * @param {number} gapMin
 */
export function cleanPairStarts(cues, gapMin) {
  const textOf = (c) => (c.textLines || []).join("\n");
  const valid = cues.map(
    (c) =>
      !c.unparsable &&
      typeof c.startMs === "number" &&
      typeof c.endMs === "number" &&
      isFinite(c.startMs) &&
      isFinite(c.endMs) &&
      c.startMs >= 0 &&
      c.endMs > c.startMs
  );
  let best = [];
  let run = [];
  for (let i = 0; i < cues.length; i += 1) {
    if (!valid[i]) {
      run = [];
      continue;
    }
    if (run.length === 0) {
      run = [i];
    } else {
      const prev = cues[run[run.length - 1]];
      const cue = cues[i];
      const clean =
        cue.startMs - prev.endMs >= gapMin &&
        cue.startMs >= prev.startMs &&
        !(cue.startMs === prev.startMs && cue.endMs === prev.endMs && textOf(cue) === textOf(prev));
      if (clean) run.push(i);
      else run = [i];
    }
    if (run.length > best.length) best = run.slice();
  }
  return best.map((i) => cues[i].startMs);
}

/**
 * T11 fps 漂移拟合（真值侧**独立实现**，不 import src/core）。
 *
 * 与 `src/core/rules/drift.js` 构成差分对照：同一口径（`data/README.md` §4.5）写两遍。
 * 判据 = 拟合后**残余漂移** `|scale − 1| × 时间跨度 > drift.residualMaxMs`；
 * 残差中位数是**拟合目标**，不是判据（自由 scale 会吸收纯比例漂移）。
 *
 * @param {number[]} startsMs 干净对起点（毫秒）
 * @param {number} declaredFps 用户声明的帧率
 * @returns {{ok:true, fit:Object}|{ok:false, reason:string, samples:number}}
 */
export function fitDriftOracle(startsMs, declaredFps) {
  const R = RULESET;
  const MICRO = 1000;
  const UNIT = 1000000;
  const n = startsMs.length;
  if (!(typeof declaredFps === "number" && isFinite(declaredFps) && declaredFps > 0)) {
    return { ok: false, reason: "media_fps_unknown", samples: n };
  }
  if (n < R["drift.minSamples"]) return { ok: false, reason: "samples_below_min", samples: n };

  const T = startsMs.map((ms) => Math.round(ms * MICRO));
  const frameMicro = UNIT / declaredFps;

  const offLo = R["drift.offsetRange"][0] * MICRO;
  const offHi = R["drift.offsetRange"][1] * MICRO;
  const offCoarse = R["drift.offsetStepCoarse"] * MICRO;
  const offFine = R["drift.offsetStepFine"] * MICRO;
  const sLo = Math.round(R["drift.scaleRange"][0] * UNIT);
  const sHi = Math.round(R["drift.scaleRange"][1] * UNIT);
  const sCoarse = Math.round(R["drift.scaleStepCoarse"] * UNIT);
  const sFine = Math.round(R["drift.scaleStepFine"] * UNIT);

  const medianInt = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
  };

  // 声明帧栅格时间轴（µms 整数）：f₁ = 0；fᵢ = fᵢ₋₁ + round(ΔTᵢ ÷ (scale × 帧长))；refᵢ = fᵢ × 帧长
  const buildRef = (scaleU) => {
    const step = (scaleU / UNIT) * frameMicro;
    const frames = [0];
    for (let i = 1; i < n; i += 1) frames.push(frames[i - 1] + Math.round((T[i] - T[i - 1]) / step));
    return frames.map((f) => Math.round(f * frameMicro));
  };
  const predict = (scaleU, ref) => ref.map((r) => Math.round((scaleU * r) / UNIT));

  const residualAt = (offU, pred) => medianInt(T.map((t, i) => Math.abs(t - offU - pred[i])));

  const prefer = (cand, best) => {
    if (!best) return true;
    if (cand.residualU !== best.residualU) return cand.residualU < best.residualU;
    if (cand.offsetU !== best.offsetU) return cand.offsetU < best.offsetU;
    return cand.scaleU < best.scaleU;
  };

  let best = null;
  for (let scaleU = sLo; scaleU <= sHi; scaleU += sCoarse) {
    const pred = predict(scaleU, buildRef(scaleU));
    let offU = Math.round(medianInt(T.map((t, i) => t - pred[i])) / offCoarse) * offCoarse;
    if (offU < offLo) offU = offLo;
    if (offU > offHi) offU = offHi;
    const cand = { scaleU, offsetU: offU, residualU: residualAt(offU, pred) };
    if (prefer(cand, best)) best = cand;
  }
  let fine = Object.assign({}, best);
  const sFrom = Math.max(sLo, best.scaleU - sCoarse);
  const sTo = Math.min(sHi, best.scaleU + sCoarse);
  for (let scaleU = sFrom; scaleU <= sTo; scaleU += sFine) {
    const pred = predict(scaleU, buildRef(scaleU));
    const oFrom = Math.max(offLo, best.offsetU - offCoarse);
    const oTo = Math.min(offHi, best.offsetU + offCoarse);
    for (let offU = oFrom; offU <= oTo; offU += offFine) {
      const cand = { scaleU, offsetU: offU, residualU: residualAt(offU, pred) };
      if (prefer(cand, fine)) fine = cand;
    }
  }

  const spanU = T[T.length - 1] - T[0];
  const driftU = Math.round((Math.abs(fine.scaleU - UNIT) * spanU) / UNIT);
  const onGrid = fine.residualU <= R["drift.gridToleranceMs"] * MICRO;
  const fires = onGrid && driftU > R["drift.residualMaxMs"] * MICRO;
  if (!fires) {
    return { ok: false, reason: onGrid ? "drift_within_tolerance" : "not_frame_grid", samples: n };
  }
  return {
    ok: true,
    fit: {
      scale: fine.scaleU / UNIT,
      offsetMs: fine.offsetU / MICRO,
      residualMs: fine.residualU / MICRO,
      spanMs: spanU / MICRO,
      driftMs: driftU / MICRO,
      samples: n,
    },
  };
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
