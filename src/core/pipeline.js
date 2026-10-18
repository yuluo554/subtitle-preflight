/**
 * 编排层（L2）：一次体检的唯一入口。
 *
 * 职责边界：
 *  - 只串 L1，不做判定、不渲染。
 *  - 未实现的规则/解析器必须以 `skipped[]` + `capabilities` 形式进入产物。
 *  - 多文件按**文件名 Unicode 码点序**处理，保证确定性。
 */
SP.define(
  "core/pipeline",
  ["core/decode", "core/parse/index", "core/rules/timing", "core/report", "core/sha256", "core/ruleset"],
  function (decode, parser, timing, report, sha256, ruleset) {
    "use strict";

    const CAPABILITIES = {
      parsers: { srt: "implemented", vtt: "implemented", ass: "implemented" },
      rules: {
        timing: "partial",
        readability: "not_implemented",
        hygiene: "not_implemented",
      },
      exports: { json: "implemented", markdown: "not_implemented", csv: "not_implemented" },
      fixes: "not_implemented",
      driftFit: "not_implemented",
    };

    function compareName(a, b) {
      const an = a.name;
      const bn = b.name;
      if (an === bn) return 0;
      const ac = Array.from(an);
      const bc = Array.from(bn);
      const len = Math.min(ac.length, bc.length);
      for (let i = 0; i < len; i += 1) {
        const av = ac[i].codePointAt(0);
        const bv = bc[i].codePointAt(0);
        if (av !== bv) return av < bv ? -1 : 1;
      }
      return ac.length - bc.length;
    }

    function runOne(file, options) {
      const decoded = decode.decodeBytes(file.bytes);
      const parsed = parser.parseText(decoded.text, file.name);

      const timingResult = timing.run(parsed.cues, {
        mediaDurationMs: options.mediaDurationMs,
        diagnostics: parsed.diagnostics,
      });

      const findings = parsed.findings.concat(timingResult.findings);
      const skipped = parsed.skipped.concat(timingResult.skipped);

      // 未实现的规则域：显式声明，不静默
      skipped.push({ kind: "ruleDomain", domain: "readability", reason: "not_implemented" });
      skipped.push({ kind: "ruleDomain", domain: "hygiene", reason: "not_implemented" });
      skipped.push({ kind: "export", format: "markdown", reason: "not_implemented" });
      skipped.push({ kind: "export", format: "csv", reason: "not_implemented" });
      skipped.push({ kind: "fix", reason: "not_implemented" });

      const built = report.build({
        inputSha256: sha256.sha256Hex(file.bytes),
        findings,
        fixes: [],
        skipped,
        capabilities: CAPABILITIES,
        diagnostics: decoded.diagnostics.concat(parsed.diagnostics),
      });

      return {
        file: {
          name: file.name,
          size: file.bytes.length,
          format: parsed.format,
          encoding: decoded.encoding,
          bom: decoded.bom,
          fallback: decoded.fallback,
          lossy: decoded.lossy,
          eol: decoded.eol,
          cueCount: parsed.cues.length,
        },
        cues: parsed.cues,
        report: built,
        json: report.toJson(built),
      };
    }

    /**
     * @param {Array<{name:string, bytes:Uint8Array}>} files
     * @param {{mediaDurationMs?:number}} options
     */
    function run(files, options) {
      const opts = options || {};
      const ordered = files.slice().sort(compareName);
      const results = ordered.map((file) => runOne(file, opts));
      return {
        results,
        rulesetVersion: ruleset.version,
        schemaVersion: ruleset.schemaVersion,
      };
    }

    return { run, CAPABILITIES };
  }
);
