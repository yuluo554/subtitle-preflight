import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, fileOf } from "./helpers/load.mjs";

const SP = loadCore();
const ass = SP.get("core/parse/ass");

const HEAD = [
  "[Script Info]",
  "Title: 示例剧·夜航",
  "ScriptType: v4.00+",
  "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, Alignment",
  "Style: Default,DejaVu Sans,20,&H00FFFFFF,2",
  "",
  "[Events]",
];

function parseText(lines) {
  return ass.parse(lines.join("\n"));
}

test("ASS：只取 [Events]，按 Format 列序取字段", () => {
  const { cues, diagnostics } = parseText([
    ...HEAD,
    "Format: Layer, Start, End, Style, Text",
    "Dialogue: 0,0:00:01.00,0:00:03.00,Default,第一行",
    "Dialogue: 0,0:00:03.50,0:00:06.00,Default,第二行",
  ]);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 3000);
  assert.equal(cues[0].style, "Default");
  assert.deepEqual(cues[0].textLines, ["第一行"]);
  assert.equal(cues[1].startMs, 3500);
  assert.deepEqual(diagnostics, []);
});

test("ASS：列序乱序（Format: Start, End, Layer, Style, Text）仍正确", () => {
  const { cues } = parseText([
    ...HEAD,
    "Format: Start, End, Layer, Style, Text",
    "Dialogue: 0:00:01.00,0:00:03.00,0,Default,乱序也对",
  ]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 3000);
  assert.deepEqual(cues[0].textLines, ["乱序也对"]);
});

test("ASS：Text 是最后一列，内部逗号不被当分隔符", () => {
  const { cues } = parseText([
    ...HEAD,
    "Format: Layer, Start, End, Style, Text",
    "Dialogue: 0,0:00:01.00,0:00:02.00,Default,甲说：你好, 再见",
  ]);
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0].textLines, ["甲说：你好, 再见"]);
});

test("ASS：\\N 拆行，所有拆出的行都映射到同一条 Dialogue 行号", () => {
  const { cues } = parseText([
    ...HEAD, // 1-9
    "Format: Layer, Start, End, Style, Text", // 10
    "Dialogue: 0,0:00:01.00,0:00:02.00,Default,上\\N下", // 11
  ]);
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0].textLines, ["上", "下"]);
  assert.deepEqual(cues[0].textLineNumbers, [11]);
  assert.equal(cues[0].sourceLine, 11);
  assert.equal(cues[0].endLine, 11);
});

test("ASS：Comment 行跳过并产出 parse.skipped-comment（带行号）", () => {
  const { cues, diagnostics } = parseText([
    ...HEAD, // 1-9
    "Format: Layer, Start, End, Style, Text", // 10
    "Dialogue: 0,0:00:01.00,0:00:02.00,Default,正文", // 11
    "Comment: 0,0:00:00.00,0:00:00.00,Default,被跳过", // 12
    "Dialogue: 0,0:00:03.00,0:00:04.00,Default,之后", // 13
  ]);
  assert.equal(cues.length, 2);
  assert.deepEqual(diagnostics, [{ code: "parse.skipped-comment", line: 12 }]);
  assert.equal(cues[1].startMs, 3000);
});

test("ASS：厘秒时间码 H:MM:SS.cc → 毫秒", () => {
  assert.equal(ass.toMs("0", "0", "1", "05"), 1050);
  assert.equal(ass.parseTime("1:02:03.45"), 3723450);
  assert.equal(ass.parseTime("00:00:01.00"), 1000);
});

test("ASS：段外内容与 [Script Info] 的 Format 行不影响事件解析", () => {
  const { cues } = parseText([
    "[Script Info]",
    "Title: x",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize",
    "Style: Default,Arial,20",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Text",
    "Dialogue: 0,0:00:01.00,0:00:02.00,Default,只在 Events 里",
  ]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 1000);
});

test("ASS：Dialogue 出现在 Format 之前 → 记诊断，不抛异常", () => {
  const lines = [
    "[Events]",
    "Dialogue: 0,0:00:01.00,0:00:02.00,Default,无格式声明",
    "Format: Layer, Start, End, Style, Text",
    "Dialogue: 0,0:00:03.00,0:00:04.00,Default,有格式声明",
  ];
  const { cues, diagnostics } = parseText(lines);
  assert.equal(cues.length, 1, "缺 Format 的那行不得解析成 cue");
  assert.equal(diagnostics[0].code, "parse.missing-format");
  assert.equal(diagnostics[0].line, 2);
  assert.equal(cues[0].startMs, 3000);
});

test("ASS：时间码坏掉 → 显式 finding，不抛异常", () => {
  const { cues, findings, diagnostics } = parseText([
    "[Events]",
    "Format: Layer, Start, End, Style, Text",
    "Dialogue: 0,0:00:xx.00,0:00:02.00,Default,坏时间码",
    "Dialogue: 0,0:00:03.00,0:00:04.00,Default,好的",
  ]);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startMs, 3000);
  assert.equal(findings[0].ruleId, "timing.unparsable-timecode");
  assert.equal(findings[0].line, 3);
  assert.ok(diagnostics.some((d) => d.code === "parse.unparsable-timecode"));
});

test("ASS：换段后重建列映射（段头 reset order）", () => {
  const { cues } = parseText([
    "[Events]",
    "Format: Layer, Start, End, Style, Text",
    "Dialogue: 0,0:00:01.00,0:00:02.00,Default,甲",
    "[Script Info]",
    "Title: 中间插一段",
    "[Events]",
    "Format: Start, End, Layer, Style, Text",
    "Dialogue: 0:00:03.00,0:00:04.00,0,Default,乙",
  ]);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[1].startMs, 3000);
});

test("ASS：重复解析同一输入逐字段一致", () => {
  const text = [...HEAD, "Format: Layer, Start, End, Style, Text", "Dialogue: 0,0:00:01.00,0:00:02.00,Default,稳定"].join("\n");
  assert.deepEqual(ass.parse(text), ass.parse(text));
});

test("pipeline：ASS 端到端跑通并进入 capabilities", () => {
  const pipeline = SP.get("core/pipeline");
  const text = [...HEAD, "Format: Layer, Start, End, Style, Text", "Dialogue: 0,0:00:01.00,0:00:02.00,Default,示例"].join("\n");
  const result = pipeline.run([fileOf("示例.ass", text)], {}).results[0];
  assert.equal(result.file.format, "ass");
  assert.equal(result.file.cueCount, 1);
  assert.equal(result.report.capabilities.parsers.ass, "implemented");
});
