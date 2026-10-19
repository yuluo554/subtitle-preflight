import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../tools/bundle.mjs";
import { loadCore, cue } from "./helpers/load.mjs";

const SP = loadCore();
const drift = SP.get("core/rules/drift");
const pipeline = SP.get("core/pipeline");

/** 声明帧栅格上的 n 条 cue（起点 = 整数帧号 × 帧长）。 */
function gridCues(n, fps, steps, durations) {
  const frameMs = 1000 / fps;
  const M = steps || [7, 8, 6, 9, 7, 8];
  const D = durations || [4, 5, 4, 5, 4, 5];
  let frame = 0;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      startMs: Math.round(frame * frameMs),
      endMs: Math.round((frame + D[i % D.length]) * frameMs),
      textLines: ["第 " + (i + 1) + " 句"],
      timeLine: i * 3 + 2,
      sourceLine: i * 3 + 1,
      endLine: i * 3 + 3,
    });
    frame += M[i % M.length];
  }
  return out;
}

const stretch = (cues, scale) =>
  cues.map((c) =>
    Object.assign({}, c, {
      startMs: Math.round(c.startMs * scale),
      endMs: Math.round(c.endMs * scale),
    })
  );

const starts = (cues) => cues.map((c) => c.startMs);

test("漂移拟合：整段等比拉伸可复原 scale，且复原误差 < 1 帧", () => {
  const declaredFps = 23.976;
  const trueScale = 25 / declaredFps;
  // 基线落在**声明**帧栅格上，再按 playback/declared 等比拉伸（与样本同构）
  const base = gridCues(24, declaredFps);
  const drifted = stretch(base, trueScale);
  const outcome = drift.fit(starts(drifted), declaredFps);
  assert.equal(outcome.ok, true, "整段等比漂移必须报红");
  const fit = outcome.fit;
  assert.ok(Math.abs(fit.scale - trueScale) < 0.001, `复原 scale ${fit.scale} 偏离真值 ${trueScale}`);
  // 1 帧（25fps）= 40ms；用跨度把 scale 误差折算成时间误差
  const errorMs = Math.abs(fit.scale - trueScale) * fit.spanMs;
  assert.ok(errorMs < 40, `复原误差 ${errorMs}ms 应 < 1 帧（40ms）`);
  assert.equal(fit.offsetMs, 0, "无整体偏移时 offset 应为 0");
  assert.equal(fit.samples, 24);
});

test("漂移拟合：双跑逐字段一致（不是近似一致）", () => {
  const drifted = stretch(gridCues(24, 23.976), 25 / 23.976);
  const a = drift.fit(starts(drifted), 23.976);
  const b = drift.fit(starts(drifted), 23.976);
  assert.deepEqual(a, b);
});

test("漂移拟合：干净（落在声明帧栅格）不报，且进 skipped 说明原因", () => {
  const base = gridCues(24, 23.976);
  const outcome = drift.fit(starts(base), 23.976);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.skipped.reason, "drift_within_tolerance");
});

test("漂移拟合：整体偏移（scale=1）不报——offset 由模型吸收", () => {
  const base = gridCues(24, 23.976);
  const shifted = base.map((c) => Object.assign({}, c, { startMs: c.startMs + 1500, endMs: c.endMs + 1500 }));
  const outcome = drift.fit(starts(shifted), 23.976);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.skipped.reason, "drift_within_tolerance");
});

test("漂移拟合：容差内的等比漂移（跨度 < residualMaxMs）不报", () => {
  const mild = stretch(gridCues(24, 23.976), 1.0005);
  const outcome = drift.fit(starts(mild), 23.976);
  assert.equal(outcome.ok, false, "跨度仅 ~7ms，远小于 40ms 阈值");
  assert.equal(outcome.skipped.reason, "drift_within_tolerance");
});

test("漂移拟合：未声明帧率 → skipped(media_fps_unknown)，不静默返回空", () => {
  const drifted = stretch(gridCues(24, 23.976), 25 / 23.976);
  const outcome = drift.fit(starts(drifted), undefined);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.skipped.reason, "media_fps_unknown");
});

test("漂移拟合：干净对不足 → skipped(samples_below_min)，不报", () => {
  const drifted = stretch(gridCues(19, 25), 25 / 23.976);
  const outcome = drift.fit(starts(drifted), 23.976);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.skipped.reason, "samples_below_min");
});

test("漂移拟合：不落在声明帧栅格上 → skipped(not_frame_grid)，不报", () => {
  // 间隔不规则的干净字幕（不落任何帧栅格）
  const irregular = [];
  let t = 1000;
  for (let i = 0; i < 24; i += 1) {
    irregular.push(t);
    t += 1200 + ((i * 617) % 1400);
  }
  const outcome = drift.fit(irregular, 23.976);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.skipped.reason, "not_frame_grid");
});

test("漂移拟合：阈值读自 ruleset（口径门保证 §4 与镜像一致）", () => {
  const ruleset = SP.get("data/ruleset");
  const drifted = stretch(gridCues(24, 23.976), 25 / 23.976);
  const outcome = drift.fit(starts(drifted), 23.976);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.fit.residualMaxMs, ruleset["drift.residualMaxMs"]);
  assert.equal(outcome.fit.gridToleranceMs, ruleset["drift.gridToleranceMs"]);
});

test("漂移拟合：「干净对」只取最长合法连续段（坏 cue 不带偏）", () => {
  const gapMin = SP.get("core/ruleset").get("timing.gapMin");
  // 24 条干净 cue，末尾追加一条与末条重叠的坏 cue
  const clean = gridCues(24, 23.976);
  const bad = cue(clean[23].startMs - 10, clean[23].endMs, ["坏"]); // 与前一条重叠
  const cues = clean.concat([bad]);
  const run = drift.cleanRunStarts(cues, gapMin);
  assert.equal(run.length, 24, `最长干净段应是 24 条干净 cue，实际 ${run.length}`);
  // 坏 cue 的起点不在干净段里
  assert.ok(!run.includes(bad.startMs), "重叠的坏 cue 不应进入拟合样本");
});

test("漂移拟合：端到端（pipeline）产出 timing.fps-drift@1:fit 且进 report.findings", () => {
  const truth = JSON.parse(readFileSync(join(ROOT, "data/truth/timing/t11-fps-drift.json"), "utf8"));
  const bytes = readFileSync(join(ROOT, "data/samples", truth.sample));
  const result = pipeline.run([{ name: "t11.srt", bytes }], { declaredFps: truth.fps.declared }).results[0];
  const driftFindings = result.report.findings.filter((f) => f.ruleId === "timing.fps-drift");
  assert.equal(driftFindings.length, 1);
  assert.equal(driftFindings[0].line, 1);
  assert.equal(driftFindings[0].field, "fit");
  assert.ok(result.driftFit && result.driftFit.scale > 1.04, "pipeline 应透出拟合结果");
});

test("漂移拟合：T11 样本端到端双跑逐字段一致", () => {
  const truth = JSON.parse(readFileSync(join(ROOT, "data/truth/timing/t11-fps-drift.json"), "utf8"));
  const bytes = readFileSync(join(ROOT, "data/samples", truth.sample));
  const run = () => pipeline.run([{ name: "t11.srt", bytes }], { declaredFps: truth.fps.declared }).results[0];
  const a = run();
  const b = run();
  assert.equal(a.json, b.json, "报告应逐字节一致");
  assert.deepEqual(a.driftFit, b.driftFit);
});
