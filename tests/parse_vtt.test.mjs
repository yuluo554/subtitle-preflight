import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, fileOf } from "./helpers/load.mjs";

const SP = loadCore();
const vtt = SP.get("core/parse/vtt");

function parseText(lines) {
  return vtt.parse(lines.join("\n"));
}

test("VTT：基本块解析，时间与文本正确（HH:MM:SS.mmm）", () => {
  const { cues, diagnostics } = parseText([
    "WEBVTT",
    "",
    "cue-1",
    "00:00:01.000 --> 00:00:03.000",
    "第一行",
    "",
    "cue-2",
    "00:00:04.500 --> 00:00:06.000",
    "第二行",
    "",
  ]);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 3000);
  assert.equal(cues[0].identifier, "cue-1");
  assert.deepEqual(cues[0].textLines, ["第一行"]);
  assert.equal(cues[1].startMs, 4500);
  assert.deepEqual(diagnostics, []);
});

test("VTT：短时间码 MM:SS.mmm 与 settings 后缀都被接受", () => {
  const { cues } = parseText([
    "WEBVTT",
    "",
    "00:01.000 --> 00:03.000 align:start position:10%",
    "带 settings",
    "",
  ]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 3000);
  assert.equal(cues[0].identifier, null);
});

test("VTT：首行 WEBVTT 可带 header 文本，整行跳过", () => {
  const { cues } = parseText([
    "WEBVTT - 示例剧·夜航",
    "",
    "00:00:01.000 --> 00:00:02.000",
    "嗨",
    "",
  ]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 1000);
});

test("VTT：行号映射（sourceLine / textLineNumbers / endLine）", () => {
  const { cues } = parseText([
    "WEBVTT", // 1
    "", // 2
    "cue-1", // 3
    "00:00:01.000 --> 00:00:03.000", // 4
    "第一行", // 5
    "第二行", // 6
    "", // 7
    "00:00:04.000 --> 00:00:05.000", // 8
    "无标识时的 sourceLine 指向时间码行", // 9
  ]);
  assert.equal(cues[0].sourceLine, 3);
  assert.equal(cues[0].timeLine, 4);
  assert.deepEqual(cues[0].textLineNumbers, [5, 6]);
  assert.equal(cues[0].endLine, 6);
  assert.equal(cues[1].identifier, null);
  assert.equal(cues[1].sourceLine, 8);
  assert.deepEqual(cues[1].textLineNumbers, [9]);
  assert.equal(cues[1].endLine, 9);
});

test("VTT：NOTE 块整块跳过并产出 parse.skipped-block（带块首行号）", () => {
  const { cues, diagnostics } = parseText([
    "WEBVTT", // 1
    "", // 2
    "cue-1", // 3
    "00:00:01.000 --> 00:00:02.000", // 4
    "嗨", // 5
    "", // 6
    "NOTE 这是转场备注", // 7
    "注释可以续行", // 8
    "", // 9
    "00:00:03.000 --> 00:00:04.000", // 10
    "之后", // 11
  ]);
  assert.equal(cues.length, 2);
  assert.deepEqual(diagnostics, [{ code: "parse.skipped-block", line: 7 }]);
  assert.equal(cues[1].startMs, 3000);
});

test("VTT：STYLE 与 REGION 块同样被跳过并计数", () => {
  const { cues, diagnostics } = parseText([
    "WEBVTT",
    "",
    "STYLE",
    "::cue { color: red }",
    "",
    "REGION",
    "id:r1 width:40%",
    "",
    "00:00:01.000 --> 00:00:02.000",
    "嗨",
    "",
  ]);
  assert.equal(cues.length, 1);
  assert.deepEqual(
    diagnostics.map((d) => d.line),
    [3, 6]
  );
  assert.ok(diagnostics.every((d) => d.code === "parse.skipped-block"));
});

test("VTT：形如时间码但解析不了 → 显式报 timing.unparsable-timecode，不静默丢弃", () => {
  const { cues, findings, diagnostics } = parseText([
    "WEBVTT",
    "",
    "00:00:01.000 --> 00:00:0.bad",
    "坏的",
    "",
    "00:00:03.000 --> 00:00:04.000",
    "好的",
    "",
  ]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 3000);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "timing.unparsable-timecode");
  assert.equal(findings[0].line, 3);
  assert.equal(diagnostics.some((d) => d.code === "parse.unparsable-timecode"), true);
});

test("VTT：行尾空白不影响识别，但文本行保持原样", () => {
  const { cues } = parseText(["WEBVTT", "", "cue-1  ", "00:00:01.000 --> 00:00:02.000   ", "文本  ", ""]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].identifier, "cue-1");
  assert.deepEqual(cues[0].textLines, ["文本  "]);
});

test("VTT：时间码后无文本行时 endLine 落在时间码行", () => {
  const { cues } = parseText(["WEBVTT", "", "cue-1", "00:00:01.000 --> 00:00:02.000", ""]);
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0].textLines, []);
  assert.equal(cues[0].endLine, cues[0].timeLine);
});

test("VTT：重复解析同一输入逐字段一致", () => {
  const text = ["WEBVTT", "", "cue-1", "00:00:01.000 --> 00:00:02.000", "稳定", ""];
  assert.deepEqual(vtt.parse(text.join("\n")), vtt.parse(text.join("\n")));
});

test("pipeline：VTT 端到端跑通并进入 capabilities", () => {
  const pipeline = SP.get("core/pipeline");
  const text = ["WEBVTT", "", "cue-1", "00:00:01.000 --> 00:00:02.000", "示例", ""].join("\n");
  const result = pipeline.run([fileOf("示例.vtt", text)], {}).results[0];
  assert.equal(result.file.format, "vtt");
  assert.equal(result.file.cueCount, 1);
  assert.equal(result.report.capabilities.parsers.vtt, "implemented");
});
