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

  function summarize(findings) {
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
    return { total: findings.length, bySeverity, byRule: rules };
  }

  /**
   * @param {{inputSha256:string, findings:Array, fixes:Array, skipped:Array,
   *          capabilities:Object, diagnostics:Array}} input
   */
  function build(input) {
    const findings = (input.findings || []).slice().sort(compareFindings);
    return {
      schemaVersion: ruleset.schemaVersion,
      rulesetVersion: ruleset.version,
      inputSha256: input.inputSha256 || "",
      summary: summarize(findings),
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

  return { build, toJson, summarize, compareFindings };
});
