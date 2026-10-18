import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, fileOf } from "./helpers/load.mjs";

const SP = loadCore();
const srt = SP.get("core/parse/srt");

test("SRT：基本块解析，时间与文本正确", () => {
  const text = [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "第一行",
    "",
    "2",
    "00:00:04,500 --> 00:00:06,000",
    "第二行",
    "",
  ].join("\n");

  const { cues, findings } = srt.parse(text);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 3000);
  assert.deepEqual(cues[0].textLines, ["第一行"]);
  assert.equal(cues[1].startMs, 4500);
  assert.equal(findings.length, 0);
});

test("SRT：行号映射（sourceLine / timeLine / textLineNumbers）", () => {
  const text = [
    "1", // 1
    "00:00:01,000 --> 00:00:03,000", // 2
    "第一行", // 3
    "第二行", // 4
    "", // 5
    "2", // 6
    "00:00:04,000 --> 00:00:05,000", // 7
    "第三行", // 8
  ].join("\n");

  const { cues } = srt.parse(text);
  assert.equal(cues[0].sourceLine, 1);
  assert.equal(cues[0].timeLine, 2);
  assert.deepEqual(cues[0].textLineNumbers, [3, 4]);
  assert.equal(cues[1].sourceLine, 6);
  assert.equal(cues[1].timeLine, 7);
  assert.deepEqual(cues[1].textLineNumbers, [8]);
});

test("SRT 变体 3：序号缺失仍能解析", () => {
  const text = [
    "00:00:01,000 --> 00:00:02,000",
    "无序号",
    "",
    "00:00:03,000 --> 00:00:04,000",
    "也无序号",
    "",
  ].join("\n");
  const { cues } = srt.parse(text);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].declaredIndex, null);
  assert.equal(cues[0].startMs, 1000);
});

test("SRT 变体 4：序号跳号与块数不一致仍按块解析", () => {
  const text = [
    "1",
    "00:00:01,000 --> 00:00:02,000",
    "甲",
    "",
    "7",
    "00:00:03,000 --> 00:00:04,000",
    "乙",
    "",
    "3",
    "00:00:05,000 --> 00:00:06,000",
    "丙",
    "",
  ].join("\n");
  const { cues } = srt.parse(text);
  assert.equal(cues.length, 3);
  assert.deepEqual(cues.map((c) => c.declaredIndex), [1, 7, 3]);
  assert.deepEqual(cues.map((c) => c.index), [1, 2, 3]);
});

test("SRT 变体 5：逗号与点号混用", () => {
  const text = [
    "1",
    "00:00:01.000 --> 00:00:02,500",
    "混用",
    "",
  ].join("\n");
  const { cues } = srt.parse(text);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 2500);
});

test("SRT 变体 7：行尾空白与缩进不影响时间码识别", () => {
  const text = ["1  ", "  00:00:01,000 --> 00:00:02,000   ", "文本  ", ""].join("\n");
  const { cues, findings } = srt.parse(text);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(findings.length, 0);
  assert.deepEqual(cues[0].textLines, ["文本  "]);
});

test("SRT 变体 8：块内与块间多余空行", () => {
  const text = [
    "",
    "",
    "1",
    "00:00:01,000 --> 00:00:02,000",
    "甲",
    "",
    "",
    "",
    "2",
    "00:00:03,000 --> 00:00:04,000",
    "乙",
    "",
    "",
  ].join("\n");
  const { cues } = srt.parse(text);
  assert.equal(cues.length, 2);
  assert.equal(cues[1].sourceLine, 9);
});

test("SRT：毫秒位数 1/2/3 位按位数补零", () => {
  assert.equal(srt.toMs("0", "0", "1", "5"), 1500);
  assert.equal(srt.toMs("0", "0", "1", "50"), 1500);
  assert.equal(srt.toMs("0", "0", "1", "500"), 1500);
  assert.equal(srt.toMs("0", "0", "1", "5000"), 1500); // 4 位截断
});

test("SRT：小时位与毫秒位精度问题记入 diagnostics（T12 输入）", () => {
  const text = ["1", "001:00:01,50 --> 00:00:02,000", "精度", ""].join("\n");
  const { diagnostics } = srt.parse(text);
  const codes = diagnostics.map((d) => d.code);
  assert.ok(codes.includes("parse.timecode-precision"));
  const details = diagnostics.filter((d) => d.code === "parse.timecode-precision").map((d) => d.detail);
  assert.ok(details.some((d) => d.includes("小时位")));
  assert.ok(details.some((d) => d.includes("毫秒位")));
});

test("SRT：无法解析的时间码走回退路径并产出 finding", () => {
  const text = ["1", "00:00:01 --> 00:00:02", "坏时间码", "", "2", "00:00:03,000 --> 00:00:04,000", "好的", ""].join("\n");
  const { cues, findings } = srt.parse(text);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 3000);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "timing.unparsable-timecode");
  assert.equal(findings[0].line, 2);
});

test("SRT：时间码后无文本行报 parse.empty-cue", () => {
  const text = ["1", "00:00:01,000 --> 00:00:02,000", ""].join("\n");
  const { cues, findings } = srt.parse(text);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].textLines.length, 0);
  assert.equal(findings[0].ruleId, "parse.empty-cue");
});

test("SRT：多行文本按行号逐行映射", () => {
  const text = ["1", "00:00:01,000 --> 00:00:02,000", "一", "二", "三", ""].join("\n");
  const { cues } = srt.parse(text);
  assert.deepEqual(cues[0].textLines, ["一", "二", "三"]);
  assert.deepEqual(cues[0].textLineNumbers, [3, 4, 5]);
  assert.equal(cues[0].endLine, 5);
});

test("SRT：重复解析同一输入逐字段一致", () => {
  const text = ["1", "00:00:01,000 --> 00:00:02,000", "稳定", ""].join("\n");
  const a = srt.parse(text);
  const b = srt.parse(text);
  assert.deepEqual(a, b);
});

test("解析分派：按内容判别格式，不只看扩展名", () => {
  const parse = SP.get("core/parse/index");
  assert.equal(parse.detectFormat("WEBVTT\n\n00:00.000 --> 00:01.000\nx", "a.srt"), "vtt");
  assert.equal(parse.detectFormat("[Script Info]\n[Events]\n", "a.srt"), "ass");
  assert.equal(parse.detectFormat("1\n00:00:01,000 --> 00:00:02,000\nx", "a.vtt"), "srt");
  assert.equal(parse.detectFormat("随便一段文字", "a.txt"), "unknown");
});

test("解析分派：未实现解析器返回 not_implemented，不返回空成功", () => {
  const parse = SP.get("core/parse/index");
  const result = parse.parseText("WEBVTT\n\n00:00.000 --> 00:01.000\nhello\n", "a.vtt");
  assert.equal(result.format, "vtt");
  assert.equal(result.cues.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "not_implemented");
  assert.equal(result.diagnostics[0].code, "parser.not_implemented");
});

test("解析分派：未知格式报 parser.unsupported", () => {
  const parse = SP.get("core/parse/index");
  const result = parse.parseText("这不是字幕", "a.txt");
  assert.equal(result.format, "unknown");
  assert.equal(result.skipped[0].reason, "unsupported");
  assert.equal(result.diagnostics[0].code, "parser.unsupported");
});

test("pipeline：SRT 端到端跑通并产出报告", () => {
  const pipeline = SP.get("core/pipeline");
  const text = ["1", "00:00:01,000 --> 00:00:02,000", "示例", ""].join("\n");
  const outcome = pipeline.run([fileOf("示例.srt", text)], {});
  assert.equal(outcome.results.length, 1);
  const result = outcome.results[0];
  assert.equal(result.file.format, "srt");
  assert.equal(result.file.cueCount, 1);
  assert.equal(result.report.schemaVersion, 1);
  assert.equal(result.report.rulesetVersion, 1);
  assert.equal(result.report.inputSha256.length, 64);
  assert.ok(Array.isArray(result.report.skipped));
  assert.equal(result.report.capabilities.parsers.srt, "implemented");
  assert.equal(result.report.capabilities.parsers.vtt, "not_implemented");
});

test("pipeline：多文件按文件名 Unicode 码点序处理", () => {
  const pipeline = SP.get("core/pipeline");
  const body = ["1", "00:00:01,000 --> 00:00:02,000", "x", ""].join("\n");
  const outcome = pipeline.run(
    [fileOf("b.srt", body), fileOf("A.srt", body), fileOf("a.srt", body)],
    {}
  );
  assert.deepEqual(outcome.results.map((r) => r.file.name), ["A.srt", "a.srt", "b.srt"]);
});
