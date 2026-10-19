import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, cue } from "./helpers/load.mjs";

const SP = loadCore();
const readability = SP.get("core/rules/readability");
const ruleset = SP.get("core/ruleset");

function rulesOf(findings) {
  return findings.map((f) => f.ruleId);
}

function full(n) {
  return "灯".repeat(n);
}

function half(n) {
  return "a".repeat(n);
}

const MIN_CHARS_MILLI = ruleset.get("line.minChars") * 1000; // 2 全角 → 2000
const DUR_MIN = ruleset.get("duration.min"); // 800
const DUR_MAX = ruleset.get("duration.max"); // 7000

/* ---------- R04 too-few-chars：可见字符下限 = line.minChars × 1000 ---------- */

test("R04 字符下限：恰好 2 全角字（= 2000 千分字符）不报", () => {
  const { findings } = readability.run([cue(0, 2000, [full(2)])], {});
  assert.ok(!rulesOf(findings).includes("readability.too-few-chars"));
});

test("R04 字符下限 − 1：1 全角字（1000 < 2000）即报", () => {
  const { findings } = readability.run([cue(0, 2000, [full(1)])], {});
  assert.ok(rulesOf(findings).includes("readability.too-few-chars"));
});

test("R04 字符下限 + 1：3 全角字（3000 > 2000）不报", () => {
  const { findings } = readability.run([cue(0, 2000, [full(3)])], {});
  assert.ok(!rulesOf(findings).includes("readability.too-few-chars"));
});

test("R04 字符下限 − 1（半角侧）：1 半角字（500 < 2000）即报", () => {
  const { findings } = readability.run([cue(0, 2000, [half(1)])], {});
  assert.ok(rulesOf(findings).includes("readability.too-few-chars"));
});

test("R04 字符下限：4 半角字（= 2000，恰好达标）不报", () => {
  const { findings } = readability.run([cue(0, 2000, [half(4)])], {});
  assert.ok(!rulesOf(findings).includes("readability.too-few-chars"));
});

test("R04 字符下限：装饰剥离后才计（<i>灯</i> 仍只有 1 字 → 报）", () => {
  const { findings } = readability.run([cue(0, 2000, ["<i>灯</i>"])], {});
  assert.ok(rulesOf(findings).includes("readability.too-few-chars"));
});

/* ---------- R05/R06 duration-short / duration-long：duration.min / duration.max ---------- */

test("R05 时长下限：恰好 duration.min（800ms）不报", () => {
  const { findings } = readability.run([cue(0, DUR_MIN, [full(4)])], {});
  assert.ok(!rulesOf(findings).includes("readability.duration-short"));
});

test("R05 时长下限 − 1：799ms 即报", () => {
  const { findings } = readability.run([cue(0, DUR_MIN - 1, [full(4)])], {});
  assert.ok(rulesOf(findings).includes("readability.duration-short"));
});

test("R05 时长下限 + 1：801ms 不报", () => {
  const { findings } = readability.run([cue(0, DUR_MIN + 1, [full(4)])], {});
  assert.ok(!rulesOf(findings).includes("readability.duration-short"));
});

test("R05 时长下限：0ms 报短（同时不触发 cps 的 0 除保护）", () => {
  const { findings } = readability.run([cue(0, 0, [full(4)])], {});
  assert.ok(rulesOf(findings).includes("readability.duration-short"));
  assert.ok(!rulesOf(findings).includes("readability.cps"));
});

test("R06 时长上限：恰好 duration.max（7000ms）不报", () => {
  const { findings } = readability.run([cue(0, DUR_MAX, [full(4)])], {});
  assert.ok(!rulesOf(findings).includes("readability.duration-long"));
});

test("R06 时长上限 + 1：7001ms 即报", () => {
  const { findings } = readability.run([cue(0, DUR_MAX + 1, [full(4)])], {});
  assert.ok(rulesOf(findings).includes("readability.duration-long"));
});

test("R06 时长上限 − 1：6999ms 不报", () => {
  const { findings } = readability.run([cue(0, DUR_MAX - 1, [full(4)])], {});
  assert.ok(!rulesOf(findings).includes("readability.duration-long"));
});

test("R06 时长下限：远低于上限（800ms）不报 duration-long", () => {
  const { findings } = readability.run([cue(0, DUR_MIN, [full(4)])], {});
  assert.ok(!rulesOf(findings).includes("readability.duration-long"));
});

test("R06 时长下限 − 1：799ms 不报 duration-long（改报 duration-short）", () => {
  const { findings } = readability.run([cue(0, DUR_MIN - 1, [full(4)])], {});
  assert.ok(!rulesOf(findings).includes("readability.duration-long"));
  assert.ok(rulesOf(findings).includes("readability.duration-short"));
});

/* ---------- R07 repeated-text：相邻 cue 文本相同且时间不同 ---------- */

test("R07 重复文本：相邻文本相同、时间不同 → 报在后一条", () => {
  const cues = [cue(0, 1000, ["重复句"], { sourceLine: 1 }), cue(2000, 3000, ["重复句"], { sourceLine: 5 })];
  const { findings } = readability.run(cues, {});
  const hits = findings.filter((f) => f.ruleId === "readability.repeated-text");
  assert.equal(hits.length, 1, "只报后一条");
  assert.equal(hits[0].line, 5, "line 取后一条的 sourceLine");
});

test("R07 反例：相邻文本相同但时间也相同 → 不报 repeated-text（归 T06）", () => {
  const cues = [cue(0, 1000, ["同一句"]), cue(0, 1000, ["同一句"])];
  const { findings } = readability.run(cues, {});
  assert.ok(!rulesOf(findings).includes("readability.repeated-text"));
});

test("R07 反例：相邻文本不同、时间不同 → 不报", () => {
  const cues = [cue(0, 1000, ["甲句"]), cue(2000, 3000, ["乙句"])];
  const { findings } = readability.run(cues, {});
  assert.ok(!rulesOf(findings).includes("readability.repeated-text"));
});

test("R07 反例：首条 cue 没有前一条 → 不报（无前文可比）", () => {
  const { findings } = readability.run([cue(0, 1000, ["独句"])], {});
  assert.ok(!rulesOf(findings).includes("readability.repeated-text"));
});

/* ---------- 确定性 / 排序 ---------- */

test("可读性：同输入双跑结果逐字段一致", () => {
  const cues = [cue(0, 1000, [full(12)]), cue(5000, 10000, [half(60)])];
  const a = readability.run(cues, {});
  const b = readability.run(cues, {});
  assert.deepEqual(a, b);
});

test("可读性：同一 cue 的 finding 按固定 ruleId 顺序输出（R01→R07）", () => {
  const cues = [cue(0, 7001, [full(17), full(17), full(17)])];
  const { findings } = readability.run(cues, {});
  const ids = findings.map((f) => f.ruleId);
  const order = ["readability.cps", "readability.line-length", "readability.too-many-lines", "readability.too-few-chars", "readability.duration-short", "readability.duration-long", "readability.repeated-text"];
  const ranks = ids.map((id) => order.indexOf(id));
  assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b), "同一 cue 内应按固定规则序输出");
  // 报告层的最终排序由 core/report 统一按 (line, ruleId) 归并
});

test("可读性：7 条规则全部 declared implemented（K7 不再有 not_implemented）", () => {
  const { implemented } = readability.run([], {});
  assert.equal(implemented.length, 7);
  assert.ok(implemented.includes("readability.repeated-text"));
});

test("可读性：空 cue 序列返回空 findings，不抛错", () => {
  const { findings, skipped } = readability.run([], {});
  assert.deepEqual(findings, []);
  assert.deepEqual(skipped, []);
});

test("口径自证：下限/时长键来自 ruleset（不是字面量）", () => {
  assert.equal(MIN_CHARS_MILLI, 2000);
  assert.equal(DUR_MIN, 800);
  assert.equal(DUR_MAX, 7000);
});
