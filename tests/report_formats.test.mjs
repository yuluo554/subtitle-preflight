import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, fileOf } from "./helpers/load.mjs";

const SP = loadCore();
const pipeline = SP.get("core/pipeline");
const report = SP.get("core/report");

/** 有正例的样本：三条规则同时命中，且含逗号/引号，用来验 CSV 转义。 */
function richSample() {
  return [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "用Python写的脚本",
    "",
    "2",
    "00:00:02,000 --> 00:00:04,000",
    "等一下！！！",
    "",
    "3",
    "00:00:04,000 --> 00:00:05,000",
    '他说 "你好"，然后走了。',
    "",
  ].join("\n");
}

function analyze() {
  return pipeline.run([fileOf("a.srt", richSample())], {}).results[0];
}

/* ---------- 单一渲染源：三格式共用同一份 findings 数组 ---------- */

test("三格式同源：条目数与每条的 ruleId/line 逐条一致（不是各自算一遍）", () => {
  const result = analyze();
  const findings = result.report.findings;

  // JSON：解析回来（不是字符串包含，而是真的结构相等）
  const fromJson = JSON.parse(result.json).findings;
  assert.equal(fromJson.length, findings.length);
  assert.deepEqual(fromJson, findings, "JSON 里的 findings 与 report.findings 不一致");

  // CSV：跳过表头后逐行比对
  const csvRows = result.csv.split("\r\n").filter((l) => l !== "");
  assert.equal(csvRows.length, findings.length + 1, "CSV 行数 = findings + 表头");
  assert.equal(csvRows[0], "ruleId,severity,line,field,expected,actual,message");
  const fromCsv = csvRows.slice(1).map((row) => {
    const cells = parseCsvRow(row);
    return { ruleId: cells[0], severity: cells[1], line: Number(cells[2]) };
  });
  assert.deepEqual(
    fromCsv.map((f) => `${f.ruleId}@${f.line}`),
    findings.map((f) => `${f.ruleId}@${f.line}`),
    "CSV 的 ruleId/line 与 findings 不一致"
  );

  // Markdown：每条 finding 都必须在正文里出现 `第 N 行` + ruleId
  for (const f of findings) {
    assert.ok(result.markdown.includes("第 " + f.line + " 行"), `MD 缺位置 第 ${f.line} 行`);
    assert.ok(result.markdown.includes("`" + f.ruleId + "`"), `MD 缺规则 ${f.ruleId}`);
  }
  // 分组计数必须与 summary 对得上
  for (const [severity, label] of [["error", "错误"], ["warn", "警告"], ["info", "提示"]]) {
    const count = findings.filter((f) => f.severity === severity).length;
    if (count > 0) {
      assert.ok(result.markdown.includes("## " + label + "（" + count + "）"), `MD 分组计数不符: ${severity}`);
    } else {
      assert.ok(!result.markdown.includes("## " + label), `MD 出现了空分组: ${label}`);
    }
  }
});

test("三格式同源：同一输入两次导出逐字节一致（确定性）", () => {
  const a = analyze();
  const b = analyze();
  assert.equal(a.json, b.json);
  assert.equal(a.markdown, b.markdown);
  assert.equal(a.csv, b.csv);
});

test("CSV：列固定 + RFC 4180 转义（含逗号/引号/换行的字段必须加引号）", () => {
  // 直接构造含转义需求的 finding（管道里真实样本的 finding 字段通常不含逗号，
  // 那不能证明"转义确实生效"——必须真的喂给它逗号/引号/换行）
  const built = report.build({
    inputSha256: "x",
    findings: [
      {
        ruleId: "timing.gap-too-small",
        severity: "error",
        line: 6,
        field: "startMs",
        expected: ">= 2580, 且 < 2660",
        actual: '他说 "好"，然后走',
        message: "第一行\n第二行",
      },
    ],
    fixes: [],
    skipped: [],
    capabilities: {},
    diagnostics: [],
    whitelist: {},
  });
  const csv = report.toCsv(built);
  const rows = csv.split("\r\n").filter((l) => l !== "");
  assert.equal(rows[0], "ruleId,severity,line,field,expected,actual,message");
  assert.equal(rows.length, 2);
  // 含逗号的 expected 必须被引号包住；引号翻倍；换行折入引号内
  assert.ok(rows[1].includes('">= 2580, 且 < 2660"'), "含逗号的 expected 未加引号: " + rows[1]);
  assert.ok(rows[1].includes('"他说 ""好""，然后走"'), "引号未翻倍: " + rows[1]);
  assert.ok(rows[1].includes('"第一行\n第二行"'), "含换行的字段未折入引号: " + rows[1]);
  const cells = parseCsvRow(rows[1]);
  assert.deepEqual(cells, [
    "timing.gap-too-small",
    "error",
    "6",
    "startMs",
    ">= 2580, 且 < 2660",
    '他说 "好"，然后走',
    "第一行\n第二行",
  ]);

  // 管道侧：条目数仍与 findings 严格一致
  const result = analyze();
  const pipeRows = result.csv.split("\r\n").filter((l) => l !== "");
  assert.equal(pipeRows.length, result.report.findings.length + 1);
  for (const row of pipeRows.slice(1)) assert.equal(parseCsvRow(row).length, 7);
  assert.ok(result.csv.endsWith("\r\n"), "CSV 应以 CRLF 结尾");
});

test("CSV：转义函数本身可逆（引号翻倍 + 换行折入引号内）", () => {
  assert.equal(report.csvField("plain"), "plain");
  assert.equal(report.csvField("a,b"), '"a,b"');
  assert.equal(report.csvField('say "hi"'), '"say ""hi"""');
  assert.equal(report.csvField("line1\nline2"), '"line1\nline2"');
  assert.equal(report.csvField(null), "");
  assert.equal(report.csvField(undefined), "");
});

test("Markdown：原文片段截断到 60 字符，超出加 …（不整段贴进报告）", () => {
  const long = "长".repeat(80);
  assert.equal(Array.from(report.snippet(long)).length, 61, "截断长度应为 60 + 省略号");
  assert.ok(report.snippet(long).endsWith("…"));
  assert.equal(report.snippet("短文本"), "短文本");
  assert.ok(!report.snippet("短文本").endsWith("…"));
  // 换行折成空格（Markdown 表格里不能出现真换行）
  assert.equal(report.snippet("第一行\n第二行"), "第一行 第二行");
});

test("Markdown：未执行检查（skipped）与白名单命中都在正文里", () => {
  const result = analyze();
  assert.ok(result.markdown.includes("## 未执行的检查（"), "MD 缺未执行检查小节");
  const skippedCount = result.report.skipped.length;
  assert.ok(result.markdown.includes("## 未执行的检查（" + skippedCount + "）"), "MD 的 skipped 计数与报告不一致");
  assert.ok(result.markdown.includes("白名单命中："), "MD 缺白名单命中行");
});

test("Markdown：表格单元格里的 | 被转义（否则列会被撑开）", () => {
  const built = report.build({
    inputSha256: "x",
    findings: [
      {
        ruleId: "timing.overlap",
        severity: "error",
        line: 1,
        field: "startMs",
        expected: "a|b",
        actual: "c|d",
        message: "含竖线 | 的说明",
      },
    ],
    fixes: [],
    skipped: [],
    capabilities: {},
    diagnostics: [],
    whitelist: {},
  });
  const md = report.toMarkdown(built);
  assert.ok(md.includes("a\\|b"), "expected 里的竖线未转义: " + md);
  assert.ok(md.includes("c\\|d"));
  assert.ok(md.includes("含竖线 \\| 的说明"));
});

/* ---------- 报告确定性：新增 summary.whitelist 不破坏既有键序 ---------- */

test("报告：summary 新增 whitelist 键，键序仍是 total → bySeverity → byRule → whitelist", () => {
  const result = analyze();
  const summary = JSON.parse(result.json).summary;
  assert.deepEqual(Object.keys(summary), ["total", "bySeverity", "byRule", "whitelist"]);
  assert.equal(summary.total, result.report.findings.length);
  assert.equal(typeof summary.whitelist, "object");
});

/* ---------- 极简样本：无违规时三格式仍然成形（不是空字符串） ---------- */

test("无违规样本：三格式都产出合法骨架（不返回空串）", () => {
  const text = ["1", "00:00:01,000 --> 00:00:03,000", "夜航灯塔浪风沙", ""].join("\n");
  const result = pipeline.run([fileOf("clean.srt", text)], {}).results[0];
  assert.equal(result.report.summary.total, 0);
  assert.ok(result.json.startsWith("{\n  \"schemaVersion\": 2,"));
  assert.equal(result.csv, "ruleId,severity,line,field,expected,actual,message\r\n");
  assert.ok(result.markdown.includes("无违规。"), "MD 无违规时应显式写出来: " + result.markdown);
  assert.ok(result.markdown.includes("# 字幕投放前体检报告"));
});

/* ---------- 简易 RFC 4180 解析器（测试侧独立实现，不复用被测代码） ---------- */

function parseCsvRow(row) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}
