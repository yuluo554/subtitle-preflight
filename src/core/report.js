/**
 * 报告渲染（模块 ⑤ 的 JSON 部分）。
 *
 * 确定性：键序固定、findings 按 (line, ruleId) 排序、2 空格缩进、结尾换行。
 * 不读时钟、不写绝对路径、不生成随机 ID。
 */
SP.define("core/report", ["core/ruleset"], function (ruleset) {
  "use strict";

  function compareFindings(a, b) {
    if (a.line !== b.line) return a.line - b.line;
    if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
    if (a.field !== b.field) return a.field < b.field ? -1 : 1;
    return 0;
  }

  /**
   * 白名单命中计数（`hygiene.whitelist` 里每个词的命中次数）并进 `summary`：
   * 命中次数不得静默——被白名单"放过"的内容必须能在报告里看见。
   * 键按字典序输出，未命中的词不出现（保持报告紧凑且确定）。
   */
  function summarizeWhitelist(counts) {
    const out = {};
    const source = counts || {};
    for (const key of Object.keys(source).sort()) {
      const value = source[key];
      if (typeof value === "number" && value > 0) out[key] = value;
    }
    return out;
  }

  function summarize(findings, whitelist) {
    const byRule = {};
    const bySeverity = { error: 0, warn: 0, info: 0 };
    for (const f of findings) {
      byRule[f.ruleId] = (byRule[f.ruleId] || 0) + 1;
      if (Object.prototype.hasOwnProperty.call(bySeverity, f.severity)) {
        bySeverity[f.severity] += 1;
      } else {
        bySeverity.info += 1;
      }
    }
    const rules = {};
    for (const key of Object.keys(byRule).sort()) rules[key] = byRule[key];
    return {
      total: findings.length,
      bySeverity,
      byRule: rules,
      whitelist: summarizeWhitelist(whitelist),
    };
  }

  /**
   * @param {{inputSha256:string, findings:Array, fixes:Array, skipped:Array,
   *          capabilities:Object, diagnostics:Array, whitelist:Object}} input
   */
  function build(input) {
    const findings = (input.findings || []).slice().sort(compareFindings);
    return {
      schemaVersion: ruleset.schemaVersion,
      rulesetVersion: ruleset.version,
      inputSha256: input.inputSha256 || "",
      summary: summarize(findings, input.whitelist),
      findings,
      fixes: (input.fixes || []).slice(),
      skipped: (input.skipped || []).slice(),
      capabilities: input.capabilities || {},
      diagnostics: (input.diagnostics || []).slice(),
    };
  }

  function toJson(report) {
    return JSON.stringify(report, null, 2) + "\n";
  }

  /* ---------- Markdown / CSV：与 JSON 共用**同一份 findings 数组**（单一渲染源） ---------- */

  const CSV_COLUMNS = ["ruleId", "severity", "line", "field", "expected", "actual", "message"];
  const SNIPPET_MAX = 60;

  /** 截断到 60 字符（按码点），超出加 `…`；换行折成空格。 */
  function snippet(value) {
    const text = String(value === null || value === undefined ? "" : value).replace(/\s*\n\s*/g, " ");
    const chars = Array.from(text);
    if (chars.length <= SNIPPET_MAX) return text;
    return chars.slice(0, SNIPPET_MAX).join("") + "…";
  }

  /** RFC 4180：含逗号 / 引号 / 换行的字段加双引号，内部引号翻倍。 */
  function csvField(value) {
    const text = String(value === null || value === undefined ? "" : value);
    if (/[",\n\r]/.test(text)) return '"' + text.split('"').join('""') + '"';
    return text;
  }

  function csvLine(cells) {
    return cells.map(csvField).join(",");
  }

  /**
   * CSV：列固定 `ruleId,severity,line,field,expected,actual,message`；
   * 行序与 `report.findings` 完全一致（不重排、不丢行）。
   */
  function toCsv(report) {
    const rows = [csvLine(CSV_COLUMNS)];
    for (const f of report.findings || []) {
      rows.push(
        csvLine([
          f.ruleId,
          f.severity,
          f.line,
          f.field,
          f.expected,
          f.actual,
          f.message,
        ])
      );
    }
    return rows.join("\r\n") + "\r\n";
  }

  const SEVERITY_ORDER = ["error", "warn", "info"];
  const SEVERITY_LABEL = { error: "错误", warn: "警告", info: "提示" };

  /**
   * Markdown：按 severity 分组；每条含 `第 N 行` 与原文片段（截断 60 字符，超出加 `…`）。
   * 组内顺序沿用 `report.findings` 的 `(line, ruleId)` 序。
   */
  function toMarkdown(report) {
    const findings = report.findings || [];
    const out = [];
    out.push("# 字幕投放前体检报告");
    out.push("");
    out.push("- rulesetVersion: " + report.rulesetVersion + "（schemaVersion " + report.schemaVersion + "）");
    out.push("- inputSha256: `" + report.inputSha256 + "`");
    out.push(
      "- 合计 " +
        findings.length +
        " 条（错误 " +
        report.summary.bySeverity.error +
        " / 警告 " +
        report.summary.bySeverity.warn +
        " / 提示 " +
        report.summary.bySeverity.info +
        "）"
    );
    const whitelistKeys = Object.keys(report.summary.whitelist || {});
    out.push(
      "- 白名单命中：" +
        (whitelistKeys.length
          ? whitelistKeys.map((k) => "`" + k + "` ×" + report.summary.whitelist[k]).join("、")
          : "无")
    );
    out.push("");

    for (const severity of SEVERITY_ORDER) {
      const group = findings.filter((f) => f.severity === severity);
      if (!group.length) continue;
      out.push("## " + SEVERITY_LABEL[severity] + "（" + group.length + "）");
      out.push("");
      out.push("| 位置 | 规则 | 期望 | 实测 | 说明 |");
      out.push("|---|---|---|---|---|");
      for (const f of group) {
        out.push(
          "| 第 " +
            f.line +
            " 行 | `" +
            f.ruleId +
            "` | " +
            mdCell(f.expected) +
            " | " +
            mdCell(f.actual) +
            " | " +
            mdCell(f.message) +
            " |"
        );
      }
      out.push("");
    }

    if (!findings.length) {
      out.push("无违规。");
      out.push("");
    }

    const skipped = report.skipped || [];
    out.push("## 未执行的检查（" + skipped.length + "）");
    out.push("");
    if (!skipped.length) {
      out.push("无。");
    } else {
      for (const item of skipped) {
        out.push("- " + mdCell(describeSkipped(item)));
      }
    }
    out.push("");
    return out.join("\n");
  }

  /** 表格单元格里的 `|` 必须转义，否则列会被撑开。 */
  function mdCell(value) {
    return snippet(value).replace(/\|/g, "\\|");
  }

  function describeSkipped(item) {
    const label = item.ruleId || item.domain || item.format || item.kind || "unknown";
    return label + " — " + (item.reason || "unknown");
  }

  return { build, toJson, toCsv, toMarkdown, summarize, compareFindings, snippet, csvField, CSV_COLUMNS };
});
