import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, cue } from "./helpers/load.mjs";

const SP = loadCore();
const timing = SP.get("core/rules/timing");

function rulesOf(findings) {
  return findings.map((f) => f.ruleId).sort();
}

test("T01 overlap：next.start < cur.end", () => {
  const cues = [cue(0, 2000), cue(1500, 3000)];
  const { findings } = timing.run(cues, {});
  assert.ok(rulesOf(findings).includes("timing.overlap"));
});

test("T01 反例：恰好首尾相接（start == prev.end）不报 overlap", () => {
  const cues = [cue(0, 2000), cue(2000, 3000)];
  const { findings } = timing.run(cues, {});
  assert.ok(!rulesOf(findings).includes("timing.overlap"));
});

test("T02 zero-duration：end == start", () => {
  const { findings } = timing.run([cue(1000, 1000)], {});
  assert.ok(rulesOf(findings).includes("timing.zero-duration"));
});

test("T03 negative-duration：end < start", () => {
  const { findings } = timing.run([cue(3000, 1000)], {});
  assert.ok(rulesOf(findings).includes("timing.negative-duration"));
});

test("T04 gap-too-small：0 <= gap < gapMin", () => {
  // gapMin = 80（口径键 timing.gapMin）
  const { findings } = timing.run([cue(0, 2000), cue(2079, 3000)], {});
  assert.ok(rulesOf(findings).includes("timing.gap-too-small"));
});

test("T04 边界：gap == gapMin 不报", () => {
  const { findings } = timing.run([cue(0, 2000), cue(2080, 3000)], {});
  assert.ok(!rulesOf(findings).includes("timing.gap-too-small"));
});

test("T04：重叠时不重复报 gap", () => {
  const { findings } = timing.run([cue(0, 2000), cue(1500, 3000)], {});
  assert.ok(rulesOf(findings).includes("timing.overlap"));
  assert.ok(!rulesOf(findings).includes("timing.gap-too-small"));
});

test("T05 non-monotonic：起点相对上一条倒退", () => {
  const { findings } = timing.run([cue(0, 1000), cue(3000, 4000), cue(2000, 2500)], {});
  assert.ok(rulesOf(findings).includes("timing.non-monotonic"));
});

test("T06 duplicate-cue：起止与文本完全相同", () => {
  const cues = [cue(0, 1000, ["同一句"]), cue(0, 1000, ["同一句"])];
  const { findings } = timing.run(cues, {});
  assert.ok(rulesOf(findings).includes("timing.duplicate-cue"));
});

test("T06 反例：时间相同但文本不同不报 duplicate", () => {
  const cues = [cue(0, 1000, ["甲"]), cue(0, 1000, ["乙"])];
  const { findings } = timing.run(cues, {});
  assert.ok(!rulesOf(findings).includes("timing.duplicate-cue"));
});

test("T07 negative-start：起点 < 0", () => {
  const { findings } = timing.run([cue(-500, 1000)], {});
  assert.ok(rulesOf(findings).includes("timing.negative-start"));
});

test("T08 past-media-end：未填时长时进入 skipped，不报", () => {
  const cues = [cue(0, 1000), cue(2000, 90000)];
  const { findings, skipped } = timing.run(cues, {});
  assert.ok(!rulesOf(findings).includes("timing.past-media-end"));
  assert.ok(skipped.some((s) => s.ruleId === "timing.past-media-end" && s.reason === "media_duration_unknown"));
});

test("T08 past-media-end：填了时长且越界则报", () => {
  const cues = [cue(0, 1000), cue(2000, 90000)];
  const { findings } = timing.run(cues, { mediaDurationMs: 60000 });
  assert.ok(rulesOf(findings).includes("timing.past-media-end"));
});

test("T08 反例：填了时长但未越界不报", () => {
  const cues = [cue(0, 1000), cue(2000, 9000)];
  const { findings } = timing.run(cues, { mediaDurationMs: 60000 });
  assert.ok(!rulesOf(findings).includes("timing.past-media-end"));
});

test("T09 unparsable-timecode：由解析层产生，规则层透传", () => {
  const cues = [];
  const diagnostics = [{ code: "parse.unparsable-timecode", line: 2 }];
  const { findings } = timing.run(cues, { diagnostics });
  assert.ok(!rulesOf(findings).includes("timing.unparsable-timecode"));
});

test("T10 file-order-mismatch：整段只报一条", () => {
  const cues = [cue(5000, 6000), cue(1000, 2000), cue(3000, 4000)];
  const { findings } = timing.run(cues, {});
  const mismatch = findings.filter((f) => f.ruleId === "timing.file-order-mismatch");
  assert.equal(mismatch.length, 1);
  assert.equal(mismatch[0].line, cues[1].timeLine);
});

test("T12 timecode-precision：从解析诊断转成 finding", () => {
  const diagnostics = [
    { code: "parse.timecode-precision", line: 2, field: "startMs", detail: "毫秒位不是 3 位" },
  ];
  const { findings } = timing.run([], { diagnostics });
  const precision = findings.filter((f) => f.ruleId === "timing.timecode-precision");
  assert.equal(precision.length, 1);
  assert.equal(precision[0].line, 2);
});

test("T11 fps-drift 未实现时进入 skipped，不静默返回空", () => {
  const { skipped } = timing.run([cue(0, 1000)], {});
  assert.ok(skipped.some((s) => s.ruleId === "timing.fps-drift" && s.reason === "not_implemented"));
});

test("finding 的 line 指向时间码所在行", () => {
  const cues = [cue(0, 2000, ["甲"], { timeLine: 2 }), cue(1500, 3000, ["乙"], { timeLine: 7 })];
  const { findings } = timing.run(cues, {});
  const overlap = findings.find((f) => f.ruleId === "timing.overlap");
  assert.equal(overlap.line, 7);
});

test("同输入双跑结果逐字段一致", () => {
  const cues = [cue(0, 2000), cue(1500, 3000), cue(3000, 3500)];
  const a = timing.run(cues, {});
  const b = timing.run(cues, {});
  assert.deepEqual(a, b);
});
