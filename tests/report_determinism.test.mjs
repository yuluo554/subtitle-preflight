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
  assert.ok(json.includes('\n  "schemaVersion": 1,'));
});

test("报告：inputSha256 与源字节一致", () => {
  const bytes = new TextEncoder().encode(sample());
  const result = pipeline.run([{ name: "a.srt", bytes }], {}).results[0];
  // 用 Node 自带 crypto 独立复算（不复用被测实现）
  const expected = createHash("sha256").update(bytes).digest("hex");
  assert.equal(result.report.inputSha256, expected);
});

test("报告：未实现能力在 capabilities 与 skipped 中显式声明", () => {
  const report = pipeline.run([fileOf("a.srt", sample())], {}).results[0].report;
  assert.equal(report.capabilities.rules.readability, "not_implemented");
  assert.equal(report.capabilities.rules.hygiene, "not_implemented");
  assert.equal(report.capabilities.driftFit, "not_implemented");
  assert.ok(report.skipped.some((s) => s.domain === "readability"));
  assert.ok(report.skipped.some((s) => s.domain === "hygiene"));
  assert.ok(report.skipped.some((s) => s.kind === "export" && s.format === "markdown"));
  assert.ok(report.skipped.some((s) => s.kind === "fix"));
});

test("报告：媒体时长未填时 T08 在 skipped 里", () => {
  const report = pipeline.run([fileOf("a.srt", sample())], {}).results[0].report;
  assert.ok(report.skipped.some((s) => s.ruleId === "timing.past-media-end"));
});

test("报告：填了媒体时长后 T08 不再 skipped", () => {
  const report = pipeline.run([fileOf("a.srt", sample())], { mediaDurationMs: 600000 }).results[0].report;
  assert.ok(!report.skipped.some((s) => s.ruleId === "timing.past-media-end"));
});
