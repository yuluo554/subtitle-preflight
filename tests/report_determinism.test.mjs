import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadCore, fileOf } from "./helpers/load.mjs";

const SP = loadCore();
const pipeline = SP.get("core/pipeline");

function sample() {
  return [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "第一行",
    "第二行",
    "",
    "2",
    "00:00:02,000 --> 00:00:04,000",
    "重叠的一条",
    "",
    "3",
    "00:00:04,000 --> 00:00:05,000",
    "正常",
    "",
  ].join("\n");
}

test("报告：两次运行逐字节一致", () => {
  const a = pipeline.run([fileOf("a.srt", sample())], {}).results[0].json;
  const b = pipeline.run([fileOf("a.srt", sample())], {}).results[0].json;
  assert.equal(a, b);
});

test("报告：键序固定", () => {
  const json = pipeline.run([fileOf("a.srt", sample())], {}).results[0].json;
  const parsed = JSON.parse(json);
  assert.deepEqual(Object.keys(parsed), [
    "schemaVersion",
    "rulesetVersion",
    "inputSha256",
    "summary",
    "findings",
    "fixes",
    "skipped",
    "capabilities",
    "diagnostics",
  ]);
});

test("报告：findings 按 (line, ruleId) 排序", () => {
  const report = pipeline.run([fileOf("a.srt", sample())], {}).results[0].report;
  const sorted = report.findings.slice().sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });
  assert.deepEqual(report.findings, sorted);
});

test("报告：summary 的 byRule 键按字典序", () => {
  const report = pipeline.run([fileOf("a.srt", sample())], {}).results[0].report;
  const keys = Object.keys(report.summary.byRule);
  assert.deepEqual(keys, keys.slice().sort());
});

test("报告：不含时间戳、随机 ID、本机绝对路径", () => {
  const json = pipeline.run([fileOf("a.srt", sample())], {}).results[0].json;
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(json), "不应含 ISO 时间戳");
  assert.ok(!/[A-Za-z]:[\\/](?:Users|Documents|Desktop)/i.test(json), "不应含本机路径");
  assert.ok(!/generatedAt|timestamp|uuid|randomId/i.test(json), "不应含时间/随机字段");
});

test("报告：JSON 以换行结尾、缩进 2 空格", () => {
  const json = pipeline.run([fileOf("a.srt", sample())], {}).results[0].json;
  assert.ok(json.endsWith("\n"));
  assert.ok(json.includes('\n  "schemaVersion": 2,'));
});

test("报告：inputSha256 与源字节一致", () => {
  const bytes = new TextEncoder().encode(sample());
  const result = pipeline.run([{ name: "a.srt", bytes }], {}).results[0];
  // 用 Node 自带 crypto 独立复算（不复用被测实现）
  const expected = createHash("sha256").update(bytes).digest("hex");
  assert.equal(result.report.inputSha256, expected);
});

test("报告：能力声明与 skipped 一致（已实现的域不得再进 skipped）", () => {
  const report = pipeline.run([fileOf("a.srt", sample())], {}).results[0].report;
  assert.equal(report.capabilities.rules.timing, "implemented");
  assert.equal(report.capabilities.driftFit, "implemented");
  assert.equal(report.capabilities.rules.readability, "implemented");
  assert.equal(report.capabilities.rules.hygiene, "implemented");
  assert.equal(report.capabilities.exports.json, "implemented");
  assert.equal(report.capabilities.exports.markdown, "implemented");
  assert.equal(report.capabilities.exports.csv, "implemented");
  assert.equal(report.capabilities.fixes, "implemented");
  for (const domain of ["readability", "hygiene"]) {
    assert.ok(!report.skipped.some((s) => s.domain === domain), `${domain} 已实现，不得再进 skipped`);
  }
  // 修复已经真的跑过：skipped 里的 fix 记录的是**执行结果**，不是"未实现"
  const fixSkip = report.skipped.filter((s) => s.kind === "fix");
  assert.equal(fixSkip.length, 1);
  assert.ok(["applied", "no_fixable_finding"].includes(fixSkip[0].reason), "fix 的 reason 不是执行结果: " + fixSkip[0].reason);
  assert.ok(!report.skipped.some((s) => s.reason === "not_implemented"), "M5 后不应再有任何 not_implemented 声明");
});

test("报告：summary 的键序与 ruleset 的 report.summaryKeys 逐项一致", () => {
  const report = pipeline.run([fileOf("a.srt", sample())], {}).results[0].report;
  const expected = SP.get("data/ruleset")["report.summaryKeys"];
  assert.ok(Array.isArray(expected) && expected.length >= 4, "ruleset 缺 report.summaryKeys");
  assert.deepEqual(Object.keys(report.summary), expected, "summary 键序与口径不符");
  // 口径里声明的每个键都真的存在（不是把键名写在口径里当摆设）
  for (const key of expected) {
    assert.ok(key in report.summary, `summary 缺口径声明的键: ${key}`);
  }
});

test("报告：schemaVersion 反映当前报告结构（M5 由 1 升到 2）", () => {
  const report = pipeline.run([fileOf("a.srt", sample())], {}).results[0].report;
  assert.equal(report.schemaVersion, SP.get("data/ruleset")["report.schemaVersion"]);
  assert.equal(report.schemaVersion, 2, "summary 新增 whitelist 键后结构变了，schemaVersion 应同步升到 2");
});

test("报告：媒体时长未填时 T08 在 skipped 里", () => {
  const report = pipeline.run([fileOf("a.srt", sample())], {}).results[0].report;
  assert.ok(report.skipped.some((s) => s.ruleId === "timing.past-media-end"));
});

test("报告：填了媒体时长后 T08 不再 skipped", () => {
  const report = pipeline.run([fileOf("a.srt", sample())], { mediaDurationMs: 600000 }).results[0].report;
  assert.ok(!report.skipped.some((s) => s.ruleId === "timing.past-media-end"));
});
