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

const FULL_LIMIT_MILLI = ruleset.get("line.maxWidthFull") * 1000; // 16 全角 → 16000
const HALF_LIMIT_MILLI = ruleset.get("line.maxWidthHalf") * 500; // 42 半角 → 21000

/* ---------- R02 line-length：中/日档上限 = maxWidthFull × 1000 ---------- */

test("R02 行长上限：恰好 16 全角字（= 16000 千分字符）不报", () => {
  const { findings } = readability.run([cue(0, 3000, [full(16)])], {});
  assert.ok(!rulesOf(findings).includes("readability.line-length"));
});

test("R02 行长上限 + 1：17 全角字（17000 > 16000）即报", () => {
  const { findings } = readability.run([cue(0, 3000, [full(17)])], {});
  assert.ok(rulesOf(findings).includes("readability.line-length"));
});

test("R02 行长下限：1 个全角字（1000，远低于上限）不报", () => {
  const { findings } = readability.run([cue(0, 3000, [full(1)])], {});
  assert.ok(!rulesOf(findings).includes("readability.line-length"));
});

test("R02 行长下限 − 1：空行（0 宽）不报行长（也不计可见行）", () => {
  const { findings } = readability.run([cue(0, 3000, ["", full(3)])], {});
  assert.ok(!rulesOf(findings).includes("readability.line-length"));
});

test("R02 行长：英文档上限 = maxWidthHalf × 500（恰好 42 半角不报 / 43 报）", () => {
  const atLimit = readability.run([cue(0, 3000, [half(42)])], {}).findings.map((f) => f.ruleId);
  assert.ok(!atLimit.includes("readability.line-length"), "42 半角 = 21000 = 上限，不应报");
  const over = readability.run([cue(0, 3000, [half(43)])], {}).findings.map((f) => f.ruleId);
  assert.ok(over.includes("readability.line-length"), "43 半角 = 21500 > 21000，应报");
});

test("R02 行长：任一行超限即报（多行里只有一行超）", () => {
  const { findings } = readability.run([cue(0, 3000, [full(4), full(17)])], {});
  assert.ok(rulesOf(findings).includes("readability.line-length"));
});

test("R02 行长：装饰剥离后才计宽（<i> 包裹 16 字仍不报）", () => {
  const { findings } = readability.run([cue(0, 3000, ["<i>" + full(16) + "</i>"])], {});
  assert.ok(!rulesOf(findings).includes("readability.line-length"));
});

test("R02 口径自证：上限键与换算基数来自 ruleset", () => {
  assert.equal(FULL_LIMIT_MILLI, 16000);
  assert.equal(HALF_LIMIT_MILLI, 21000);
});

/* ---------- R03 too-many-lines：可见行数上限 = line.maxLines（2） ---------- */

test("R03 行数上限：恰好 2 可见行不报", () => {
  const { findings } = readability.run([cue(0, 3000, [full(4), full(4)])], {});
  assert.ok(!rulesOf(findings).includes("readability.too-many-lines"));
});

test("R03 行数上限 + 1：3 可见行即报", () => {
  const { findings } = readability.run([cue(0, 3000, [full(4), full(4), full(4)])], {});
  assert.ok(rulesOf(findings).includes("readability.too-many-lines"));
});

test("R03 行数下限：1 可见行不报", () => {
  const { findings } = readability.run([cue(0, 3000, [full(4)])], {});
  assert.ok(!rulesOf(findings).includes("readability.too-many-lines"));
});

test("R03 行数下限 − 1：空文本（0 可见行）不报行数（另有 too-few-chars 兜底）", () => {
  const { findings } = readability.run([cue(0, 3000, [""])], {});
  assert.ok(!rulesOf(findings).includes("readability.too-many-lines"));
});

test("R03 行数：空行不计入可见行数（3 行里 1 行是空行 → 2 可见行不报）", () => {
  const { findings } = readability.run([cue(0, 3000, [full(4), "", full(4)])], {});
  assert.ok(!rulesOf(findings).includes("readability.too-many-lines"));
});

test("R03 行数：装饰行（全被剥离 → 0 宽）不计入可见行数", () => {
  const { findings } = readability.run([cue(0, 3000, [full(4), "{\\an8}", full(4)])], {});
  assert.ok(!rulesOf(findings).includes("readability.too-many-lines"));
});
