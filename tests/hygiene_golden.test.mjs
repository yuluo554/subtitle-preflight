import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../tools/bundle.mjs";
import { loadCore } from "./helpers/load.mjs";
import { HYGIENE_RULES, runHygieneOracle } from "../tools/samples/hygieneoracle.mjs";

const SP = loadCore();
const pipeline = SP.get("core/pipeline");
const hygiene = SP.get("core/rules/hygiene");

const TRUTH = JSON.parse(readFileSync(join(ROOT, "data/truth/hygiene/hygiene-golden.json"), "utf8"));

function runGolden() {
  const bytes = readFileSync(join(ROOT, "data/samples", TRUTH.sample));
  return pipeline.run([{ name: "hygiene-golden.srt", bytes }], {}).results[0];
}

/* ---------- 端到端：golden set 的逐条契约 ---------- */

test("卫生 golden set：端到端与真值 expectFindings 0 容差（无多报、无漏报）", () => {
  const result = runGolden();
  const got = result.report.findings
    .filter((f) => f.ruleId.startsWith("hygiene."))
    .map((f) => `${f.ruleId}@${f.line}`)
    .sort();
  const want = TRUTH.expectFindings.map((f) => `${f.ruleId}@${f.line}`).sort();
  const ws = new Set(want);
  const gs = new Set(got);
  assert.deepEqual(got.filter((x) => !ws.has(x)), [], "多报（precision 违约）");
  assert.deepEqual(want.filter((x) => !gs.has(x)), [], "漏报（recall 违约）");
  assert.equal(got.length, want.length);
});

test("卫生 golden set：逐条 cue 复核（每条 cue 的全部规则输出 = 真值契约）", () => {
  const result = runGolden();
  const byLine = new Map();
  for (const f of result.report.findings) {
    if (!f.ruleId.startsWith("hygiene.")) continue;
    if (!byLine.has(f.line)) byLine.set(f.line, []);
    byLine.get(f.line).push(f.ruleId);
  }
  const mismatches = [];
  for (const cue of TRUTH.cues) {
    const actual = (byLine.get(cue.line) || []).slice().sort();
    const expect = cue.expectFindings.slice().sort();
    if (JSON.stringify(actual) !== JSON.stringify(expect)) {
      mismatches.push(`第 ${cue.line} 行（${cue.rule}）：期望 [${expect}] 实算 [${actual}]`);
    }
  }
  assert.deepEqual(mismatches, [], "逐条 cue 与真值不一致");
  assert.equal(TRUTH.cues.length, 30);
});

test("卫生 golden set：precision 100% / recall ≥ 90%（按规则逐条统计）", () => {
  const result = runGolden();
  const got = result.report.findings
    .filter((f) => f.ruleId.startsWith("hygiene."))
    .map((f) => `${f.ruleId}@${f.line}`)
    .sort();
  const want = TRUTH.expectFindings.map((f) => `${f.ruleId}@${f.line}`).sort();
  const ws = new Set(want);
  const gs = new Set(got);

  const falsePositives = got.filter((x) => !ws.has(x));
  const falseNegatives = want.filter((x) => !gs.has(x));
  const precision = got.length ? (got.length - falsePositives.length) / got.length : 1;
  const recall = want.length ? (want.length - falseNegatives.length) / want.length : 1;

  assert.equal(precision, 1, "precision 必须 100%（falsePositive: " + falsePositives.join(", ") + "）");
  assert.ok(recall >= 0.9, `recall ${recall} < 0.9（falseNegative: ${falseNegatives.join(", ")}）`);

  // 每条规则都要有正例与反例：只统计总账会掩盖"某条规则整条没跑"
  for (const rule of HYGIENE_RULES) {
    const pos = TRUTH.cues.filter((c) => c.rule === rule && c.expectFindings.includes(rule)).length;
    const neg = TRUTH.cues.filter((c) => c.rule === rule && !c.expectFindings.includes(rule)).length;
    assert.ok(pos >= 1, `${rule} 无正例`);
    assert.ok(neg >= 1, `${rule} 无反例`);
    assert.ok(got.includes(`${rule}@${TRUTH.cues.find((c) => c.rule === rule && c.expectFindings.includes(rule)).line}`),
      `${rule} 的正例在实现里没报`);
  }
});

/* ---------- 差分对照：实现 vs 独立判定式 ---------- */

test("差分对照：实现与独立判定式在同一输入上逐条一致（K13）", () => {
  const result = runGolden();
  const lines = result.cues.map((c) => c.sourceLine);
  const oracle = runHygieneOracle(result.cues, lines)
    .map((f) => `${f.ruleId}@${f.line}`)
    .sort();
  const implemented = result.report.findings
    .filter((f) => f.ruleId.startsWith("hygiene."))
    .map((f) => `${f.ruleId}@${f.line}`)
    .sort();
  assert.deepEqual(implemented, oracle, "实现与独立判定式不一致（差分对照失败）");
});

/* ---------- 白名单：命中必须进报告 ---------- */

test("白名单命中计数进报告（不得静默）：iPhone/iPad/♪ 都被计数", () => {
  const result = runGolden();
  const counts = result.report.summary.whitelist;
  assert.ok(counts["iPhone"] >= 1, "iPhone 命中未计数: " + JSON.stringify(counts));
  assert.ok(counts["iPad"] >= 1, "iPad 命中未计数");
  assert.ok(counts["♪"] >= 2, "♪ 命中未计数");
  // 键按字典序；未命中的词不出现（报告紧凑且确定）
  const keys = Object.keys(counts);
  assert.deepEqual(keys, keys.slice().sort());
  assert.ok(!("macOS" in counts), "未命中的白名单词不应出现在报告里");
  // 计数只统计 >0
  for (const value of Object.values(counts)) assert.ok(value > 0);
});

test("白名单：命中词确实压掉了对应规则的 finding（白名单不是摆设）", () => {
  const result = runGolden();
  // 第 21 条 cue（第 81 行）是"用 iPhone 拍的"——白名单词，不得报 cjk-latin-spacing
  const atLine81 = result.report.findings
    .filter((f) => f.line === 81)
    .map((f) => f.ruleId);
  assert.ok(!atLine81.includes("hygiene.cjk-latin-spacing"), "白名单词仍被报: " + JSON.stringify(atLine81));
  assert.ok(result.report.summary.whitelist["iPhone"] >= 1, "iPhone 却没有任何命中计数");
});

/* ---------- 行号口径（K15）：文本类 finding 取 sourceLine ---------- */

test("行号口径（K15）：hygiene.* 的 line 取 cue 的 sourceLine", () => {
  const result = runGolden();
  const sourceLines = new Set(result.cues.map((c) => c.sourceLine));
  const timeLines = new Set(result.cues.map((c) => c.timeLine));
  for (const f of result.report.findings) {
    if (!f.ruleId.startsWith("hygiene.")) continue;
    assert.ok(sourceLines.has(f.line), `hygiene finding 的 line=${f.line} 不是任何 cue 的 sourceLine`);
    // 卫生样本的 sourceLine 与 timeLine 必然不同（序号行 vs 时间行），故该断言有区分度
    assert.ok(!timeLines.has(f.line), `hygiene finding 的 line=${f.line} 落在了 timeLine 上（口径反了）`);
  }
  assert.ok(sourceLines.size === 30 && timeLines.size === 30);
});

/* ---------- finding 形态（K17）：严格 7 键 ---------- */

test("finding 形态（K17）：hygiene finding 严格 7 键，不新增键", () => {
  const result = runGolden();
  const findings = result.report.findings.filter((f) => f.ruleId.startsWith("hygiene."));
  assert.ok(findings.length >= 10);
  for (const f of findings) {
    assert.deepEqual(Object.keys(f), ["ruleId", "severity", "line", "field", "expected", "actual", "message"]);
    assert.ok(["error", "warn", "info"].includes(f.severity));
    assert.equal(typeof f.expected, "string");
    assert.equal(typeof f.actual, "string");
    assert.ok(f.actual.length > 0, "actual 不得为空（否则等于静默）");
    assert.ok(f.message.length > 0);
  }
});

/* ---------- 单条规则边界：10 条各至少一个正例 + 一个反例（独立调用规则层） ---------- */

test("单条规则边界：10 条规则各有正例与反例，且 severity 稳定", () => {
  const cases = [
    ["hygiene.cjk-latin-spacing", ["用Python写的脚本"], ["用 Python 写的脚本"]],
    ["hygiene.punctuation-width", ["你好,世界"], ["你好，世界"]],
    ["hygiene.trailing-punctuation", ["这句话结束了。"], ["真的结束了吗？"]],
    ["hygiene.unclosed-tag", ["<i>斜体没关"], ["<i>斜体已关</i>"]],
    ["hygiene.ass-override-residue", ["{\\an8}顶部字幕"], ["顶部字幕"]],
    ["hygiene.placeholder-residue", ["你好 %s 世界"], ["数学表达式 {x}"]],
    ["hygiene.font-tag-residue", ['<font color="red">红字</font>'], ["普通文字"]],
    ["hygiene.sdh-marker", ["[music] 背景音乐"], ["♪ 整条歌词 ♪"]],
    ["hygiene.all-caps", ["THIS IS A VERY LONG ALL CAPS LINE"], ["iPhone and iPad 都很轻"]],
    ["hygiene.repeated-punctuation", ["等一下！！！"], ["他说省略号…后面还有话"]],
  ];
  assert.equal(cases.length, HYGIENE_RULES.length);
  for (const [ruleId, positives, negatives] of cases) {
    for (const text of positives) {
      const out = hygiene.run([{ textLines: [text], sourceLine: 1 }]);
      assert.ok(out.findings.some((f) => f.ruleId === ruleId), `${ruleId} 正例未报: ${JSON.stringify(text)}`);
    }
    for (const text of negatives) {
      const out = hygiene.run([{ textLines: [text], sourceLine: 1 }]);
      assert.ok(!out.findings.some((f) => f.ruleId === ruleId), `${ruleId} 反例被误报: ${JSON.stringify(text)}`);
    }
  }
});

test("单条规则边界：同一条 cue 的同一规则只报一条（line 相同不重复）", () => {
  const out = hygiene.run([{ textLines: ["用Python写的脚本", "再来一个Python脚本"], sourceLine: 7 }]);
  const hits = out.findings.filter((f) => f.ruleId === "hygiene.cjk-latin-spacing");
  assert.equal(hits.length, 1, "同 cue 同规则应只报一条");
  assert.equal(hits[0].line, 7);
});

test("阈值全部读 ruleset（K1）：源码里不出现区分性阈值字面量，且行为随口径变化", () => {
  const code = readFileSync(join(ROOT, "src/core/rules/hygiene.js"), "utf8");
  // 与 tools/check-ruleset.mjs 的 DISTINCTIVE 扫描同口径：卫生的两个阈值都在扫描表里
  for (const value of ["20"]) {
    const pattern = new RegExp(`(?<![\\w.\\-])${value}(?![\\w.\\-])`);
    assert.equal(pattern.test(code), false, `hygiene.js 出现阈值字面量 ${value}（应改读 ruleset）`);
  }
  const ruleset = SP.get("data/ruleset");
  assert.equal(typeof ruleset["hygiene.allCapsMinLength"], "number");
  assert.equal(typeof ruleset["hygiene.repeatPunctMin"], "number");
  assert.ok(Array.isArray(ruleset["hygiene.whitelist"]));

  // 行为边界 = 口径值（不是硬编码）：刚好低于下限不报，达到下限即报
  const minRepeat = ruleset["hygiene.repeatPunctMin"];
  const minLength = ruleset["hygiene.allCapsMinLength"];
  const under = "！".repeat(minRepeat - 1);
  const at = "！".repeat(minRepeat);
  assert.ok(!hygiene.run([{ textLines: ["等一下" + under], sourceLine: 1 }]).findings
    .some((f) => f.ruleId === "hygiene.repeated-punctuation"), "低于口径下限却报了");
  assert.ok(hygiene.run([{ textLines: ["等一下" + at], sourceLine: 1 }]).findings
    .some((f) => f.ruleId === "hygiene.repeated-punctuation"), "达到口径下限却没报");

  const shortCaps = "A".repeat(minLength - 1);
  const exactCaps = "A".repeat(minLength);
  assert.ok(!hygiene.run([{ textLines: [shortCaps], sourceLine: 1 }]).findings
    .some((f) => f.ruleId === "hygiene.all-caps"), "低于口径下限却报了全大写");
  assert.ok(hygiene.run([{ textLines: [exactCaps], sourceLine: 1 }]).findings
    .some((f) => f.ruleId === "hygiene.all-caps"), "达到口径下限却没报全大写");
});
