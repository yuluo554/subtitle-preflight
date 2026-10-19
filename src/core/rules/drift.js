/**
 * fps 漂移拟合（模块 ② 的 T11 子过程）。
 *
 * **模型（方向写死在此，与 `data/README.md` §4.5 / `plan/03` §二 同文）**：
 *   `observed ≈ offset + scale × ref`
 *   `ref` = **声明帧率的帧栅格时间轴**：把每个 cue 的起点吸附到声明帧率的整数帧号，
 *   由相邻间隔 `Δkᵢ = round(Δobservedᵢ ÷ (scale × 帧长))` 累积得到。
 *   `scale` 是声明帧率与实际帧率之比；`offset` 是整段时间轴平移。
 *
 * **判据**：拟合残差中位数是**拟合目标**，不是判据——自由 `scale` 会把纯比例漂移完全吸收，
 *   残差恒接近 0。故报红条件为
 *   `|scale − 1| × 时间跨度 > drift.residualMaxMs`，
 *   并以 `drift.gridToleranceMs` 作为"文件确实落在声明帧栅格上"的护栏（不落格 → `skipped`，不报）。
 *
 * 定点整数：内部一律用「微毫秒」(µms = ms × 1000) 做加减与取整，比较全走整数，避免浮点比较。
 * 阈值全部读 `data/ruleset.v1.json`（K1）；本文件不出现阈值字面量。
 * 不碰 DOM / 不发网络 / 不读时钟 / 不读 locale / 不用随机（K2）。
 */
SP.define("core/rules/drift", ["core/ruleset"], function (ruleset) {
  "use strict";

  const MICRO_PER_MS = 1000;
  const SCALE_UNIT = 1000000;

  /** 整数中位数（偶数取中间两数的下中位，保证确定性）。 */
  function medianInt(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    if (sorted.length % 2) return sorted[mid];
    return Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
  }

  function textOf(cue) {
    return (cue.textLines || []).join("\n");
  }

  /**
   * 「干净对」序列：个体合法（可解析 / 起点非负 / 时长 > 0）且相邻对合法
   * （不重叠 / 间隔 ≥ `timing.gapMin` / 起点不回退 / 非重复 cue）的**最长连续段**。
   * 只用它作拟合样本，避免被坏 cue 带偏（plan/03 §二）。
   */
  function cleanRunStarts(cues, gapMin) {
    const valid = [];
    for (let i = 0; i < cues.length; i += 1) {
      const cue = cues[i];
      valid.push(
        !cue.unparsable &&
          typeof cue.startMs === "number" &&
          typeof cue.endMs === "number" &&
          isFinite(cue.startMs) &&
          isFinite(cue.endMs) &&
          cue.startMs >= 0 &&
          cue.endMs > cue.startMs
      );
    }
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
        const gap = cue.startMs - prev.endMs;
        const cleanPair =
          gap >= gapMin &&
          cue.startMs >= prev.startMs &&
          !(cue.startMs === prev.startMs && cue.endMs === prev.endMs && textOf(cue) === textOf(prev));
        if (cleanPair) run.push(i);
        else run = [i];
      }
      if (run.length > best.length) best = run.slice();
    }
    return best.map((i) => cues[i].startMs);
  }

  /**
   * @param {number[]} startsMs 干净对的起点（毫秒）
   * @param {number|undefined} declaredFps 用户声明的帧率
   * @returns {{ok:true, fit:Object} | {ok:false, skipped:Object}}
   */
  function fit(startsMs, declaredFps) {
    const n = startsMs.length;
    const minSamples = ruleset.get("drift.minSamples");

    if (!(typeof declaredFps === "number" && isFinite(declaredFps) && declaredFps > 0)) {
      return {
        ok: false,
        skipped: { kind: "rule", ruleId: "timing.fps-drift", reason: "media_fps_unknown", samples: n },
      };
    }
    if (n < minSamples) {
      return {
        ok: false,
        skipped: { kind: "rule", ruleId: "timing.fps-drift", reason: "samples_below_min", samples: n },
      };
    }

    const T = startsMs.map((ms) => Math.round(ms * MICRO_PER_MS));
    const frameMicro = SCALE_UNIT / declaredFps; // 帧长（µms）

    const offsetRange = ruleset.get("drift.offsetRange");
    const offLo = offsetRange[0] * MICRO_PER_MS;
    const offHi = offsetRange[1] * MICRO_PER_MS;
    const offCoarse = ruleset.get("drift.offsetStepCoarse") * MICRO_PER_MS;
    const offFine = ruleset.get("drift.offsetStepFine") * MICRO_PER_MS;

    const scaleRange = ruleset.get("drift.scaleRange");
    const sLo = Math.round(scaleRange[0] * SCALE_UNIT);
    const sHi = Math.round(scaleRange[1] * SCALE_UNIT);
    const sCoarse = Math.round(ruleset.get("drift.scaleStepCoarse") * SCALE_UNIT);
    const sFine = Math.round(ruleset.get("drift.scaleStepFine") * SCALE_UNIT);

    /** 声明帧栅格时间轴（µms）：f₁ = 0；fᵢ = fᵢ₋₁ + round(ΔTᵢ ÷ (scale × 帧长))；refᵢ = fᵢ × 帧长。 */
    function buildRef(scaleMicro) {
      const step = (scaleMicro / SCALE_UNIT) * frameMicro;
      const frames = [0];
      for (let i = 1; i < n; i += 1) {
        frames.push(frames[i - 1] + Math.round((T[i] - T[i - 1]) / step));
      }
      return frames.map((f) => Math.round(f * frameMicro));
    }

    /** 给定 scale 与 ref 的预测值（不含 offset），µms 整数。 */
    function predict(scaleMicro, ref) {
      const out = [];
      for (let i = 0; i < n; i += 1) out.push(Math.round((scaleMicro * ref[i]) / SCALE_UNIT));
      return out;
    }

    /** 给定 scale 的解析最优 offset = 残差中位数，再吸附到指定步长的网格并夹到口径范围。 */
    function evaluateScale(scaleMicro, ref, step) {
      const pred = predict(scaleMicro, ref);
      const diff = [];
      for (let i = 0; i < n; i += 1) diff.push(T[i] - pred[i]);
      let offU = Math.round(medianInt(diff) / step) * step;
      if (offU < offLo) offU = offLo;
      if (offU > offHi) offU = offHi;
      const residual = [];
      for (let i = 0; i < n; i += 1) residual.push(Math.abs(T[i] - offU - pred[i]));
      return { offsetU: offU, residualU: medianInt(residual) };
    }

    function better(cand, best) {
      if (best === null) return true;
      if (cand.residualU !== best.residualU) return cand.residualU < best.residualU;
      if (cand.offsetU !== best.offsetU) return cand.offsetU < best.offsetU;
      return cand.scaleU < best.scaleU;
    }

    // 粗搜：scale 走粗网格（每个 scale 用解析最优 offset）
    let best = null;
    for (let scaleU = sLo; scaleU <= sHi; scaleU += sCoarse) {
      const cand = Object.assign({ scaleU }, evaluateScale(scaleU, buildRef(scaleU), offCoarse));
      if (better(cand, best)) best = cand;
    }
    // 细搜：±1 粗步邻域，按细步长走 2-D 网格（offset 也按细步长细化）
    let fine = Object.assign({}, best);
    const sFrom = Math.max(sLo, best.scaleU - sCoarse);
    const sTo = Math.min(sHi, best.scaleU + sCoarse);
    for (let scaleU = sFrom; scaleU <= sTo; scaleU += sFine) {
      const ref = buildRef(scaleU);
      const pred = predict(scaleU, ref);
      const oFrom = Math.max(offLo, best.offsetU - offCoarse);
      const oTo = Math.min(offHi, best.offsetU + offCoarse);
      for (let offU = oFrom; offU <= oTo; offU += offFine) {
        const residual = [];
        for (let i = 0; i < n; i += 1) residual.push(Math.abs(T[i] - offU - pred[i]));
        const cand = { scaleU, offsetU: offU, residualU: medianInt(residual) };
        if (better(cand, fine)) fine = cand;
      }
    }

    const spanU = T[T.length - 1] - T[0];
    const driftU = Math.round((Math.abs(fine.scaleU - SCALE_UNIT) * spanU) / SCALE_UNIT);
    const gridToleranceU = ruleset.get("drift.gridToleranceMs") * MICRO_PER_MS;
    const residualMaxU = ruleset.get("drift.residualMaxMs") * MICRO_PER_MS;

    const onGrid = fine.residualU <= gridToleranceU;
    const drifted = driftU > residualMaxU;
    const fires = onGrid && drifted;

    const detail = {
      scale: fine.scaleU / SCALE_UNIT,
      offsetMs: fine.offsetU / MICRO_PER_MS,
      residualMs: fine.residualU / MICRO_PER_MS,
      spanMs: spanU / MICRO_PER_MS,
      driftMs: driftU / MICRO_PER_MS,
      samples: n,
      declaredFps,
      residualMaxMs: ruleset.get("drift.residualMaxMs"),
      gridToleranceMs: ruleset.get("drift.gridToleranceMs"),
    };

    if (!fires) {
      return {
        ok: false,
        skipped: {
          kind: "rule",
          ruleId: "timing.fps-drift",
          reason: onGrid ? "drift_within_tolerance" : "not_frame_grid",
          samples: n,
        },
      };
    }
    return { ok: true, fit: detail };
  }

  /**
   * @param {Array} cues 解析层产出的 cue 序列
   * @param {{declaredFps?:number}} options
   * @returns {{findings:Array, skipped:Array, fit:Object|null}}
   */
  function evaluate(cues, options) {
    const opts = options || {};
    const starts = cleanRunStarts(cues, ruleset.get("timing.gapMin"));
    const outcome = fit(starts, opts.declaredFps);
    if (!outcome.ok) return { findings: [], skipped: [outcome.skipped], fit: null };
    const f = outcome.fit;
    return {
      findings: [
        {
          ruleId: "timing.fps-drift",
          severity: "warn",
          line: 1,
          field: "fit",
          expected: "|scale - 1| × 跨度 <= " + f.residualMaxMs + " ms",
          actual: "scale=" + f.scale + " offsetMs=" + f.offsetMs + " 漂移=" + f.driftMs + "ms",
          message: "整条时间轴等比漂移（疑似字幕帧率与素材帧率不一致）",
        },
      ],
      skipped: [],
      fit: f,
    };
  }

  return { fit, evaluate, cleanRunStarts, medianInt };
});
