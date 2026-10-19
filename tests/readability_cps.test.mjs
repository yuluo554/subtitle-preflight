import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, cue } from "./helpers/load.mjs";

const SP = loadCore();
const readability = SP.get("core/rules/readability");
const ruleset = SP.get("core/ruleset");

function rulesOf(findings) {
  return findings.map((f) => f.ruleId);
}

/** 恰好 n 个全角字（每个计 1000 千分字符）。 */
function full(n) {
  return "灯".repeat(n);
}

/** 恰好 n 个半角字（每个计 500 千分字符）。 */
function half(n) {
  return "a".repeat(n);
}

/* 口径键：cps.zh = 9（全角）；1 秒 cue 的上限 = 9 × 1000 = 9000 千分字符。 */

test("R01 cps 上限：恰好等于上限（9 全角字 / 1s = 9000）不报", () => {
  const { findings } = readability.run([cue(0, 1000, [full(9)])], {});
  assert.ok(!rulesOf(findings).includes("readability.cps"));
});

test("R01 cps 上限 + 1：多 1 个半角字符（9500 > 9000）即报", () => {
  const { findings } = readability.run([cue(0, 1000, [full(9) + half(1)])], {});
  assert.ok(rulesOf(findings).includes("readability.cps"));
});

test("R01 cps 下限：1 个全角字（1000，远低于上限）不报 cps", () => {
  const { findings } = readability.run([cue(0, 1000, [full(1)])], {});
  assert.ok(!rulesOf(findings).includes("readability.cps"));
});

test("R01 cps 下限 − 1：最小可表示正值（1 半角字 = 0.5 cps）确认安全侧（负字符不存在）", () => {
  const { findings } = readability.run([cue(0, 1000, [half(1)])], {});
  assert.ok(!rulesOf(findings).includes("readability.cps"));
});

test("R01 cps：时长为 0 时不报（不做 0 除法判定）", () => {
  const { findings } = readability.run([cue(0, 0, [full(20)])], {});
  assert.ok(!rulesOf(findings).includes("readability.cps"));
});

/* ---------- 语言档：同一字符数换档后结果必须变化，且 finding 标注实际档位 ---------- */

test("R01 语言档：全角主导 → zh 档（上限 9 cps），10 字 / 1s 报红并标注 zh 档位", () => {
  const { findings } = readability.run([cue(0, 1000, [full(10)])], {});
  const hit = findings.find((f) => f.ruleId === "readability.cps");
  assert.ok(hit, "zh 档应报 cps");
  assert.ok(hit.expected.includes("档位 zh"), "finding 必须标注实际档位（expected）");
  assert.ok(hit.message.includes("档位 zh"), "finding 必须标注实际档位（message）");
  // 数据契约：finding 严格 7 键（plan/02 §3.2），不得新增 lang 等键
  assert.deepEqual(Object.keys(hit).sort(), ["actual", "expected", "field", "line", "message", "ruleId", "severity"]);
});

test("R01 语言档：半角主导 → en 档（上限 17 cps），同样的 10 字 / 1s 不报", () => {
  const { findings } = readability.run([cue(0, 1000, [half(20)])], {});
  assert.ok(!rulesOf(findings).includes("readability.cps"), "en 档 20 半角字 = 10 cps < 17");
  // 36 半角字 / 1s = 18 cps > 17 → 报红且标注 en
  const hit = readability.run([cue(0, 1000, [half(36)])], {}).findings.find(
    (f) => f.ruleId === "readability.cps"
  );
  assert.ok(hit, "en 档 36 半角字应报 cps");
  assert.ok(hit.expected.includes("档位 en"));
});

test("R01 语言档：假名过半 → ja 档（上限 9 cps），10 假名 / 1s 报红并标注 ja", () => {
  const { findings } = readability.run([cue(0, 1000, ["の".repeat(10)])], {});
  const hit = findings.find((f) => f.ruleId === "readability.cps");
  assert.ok(hit, "ja 档应报 cps");
  assert.ok(hit.expected.includes("档位 ja"));
});

test("R01 语言档：切换档位确实改变判定（同一 10 字文本，zh 报 / en 不报）", () => {
  const asZh = readability.run([cue(0, 1000, [full(10)])], {}).findings.map((f) => f.ruleId);
  const asEn = readability.run([cue(0, 1000, [half(20)])], {}).findings.map((f) => f.ruleId);
  assert.ok(asZh.includes("readability.cps"));
  assert.ok(!asEn.includes("readability.cps"));
});

test("R01 cps：装饰（标签 / ASS 覆写 / SDH 标记）不计入可见字符", () => {
  const plain = readability.run([cue(0, 1000, [full(9)])], {}).findings.map((f) => f.ruleId);
  const decorated = readability
    .run([cue(0, 1000, ["<i>" + full(9) + "</i>{\\an8}[music]"])], {})
    .findings.map((f) => f.ruleId);
  assert.deepEqual(decorated, plain, "装饰不应改变 cps 判定");
});

test("R01 cps：finding 的 line 取 sourceLine（文本类口径）", () => {
  const { findings } = readability.run([cue(0, 1000, [full(10)], { sourceLine: 42, timeLine: 2 })], {});
  const hit = findings.find((f) => f.ruleId === "readability.cps");
  assert.equal(hit.line, 42);
});

test("R01 口径自证：cps 上限键确实来自 ruleset（9），不是代码里的字面量", () => {
  assert.equal(ruleset.get("cps.zh"), 9);
  assert.equal(ruleset.get("cps.en"), 17);
  assert.equal(ruleset.get("cps.ja"), 9);
});
