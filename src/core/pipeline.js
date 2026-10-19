/**
 * 编排层（L2）：一次体检的唯一入口。
 *
 * 职责边界：
 *  - 只串 L1，不做判定、不渲染。
 *  - 未实现的规则/解析器必须以 `skipped[]` + `capabilities` 形式进入产物。
 *  - 多文件按**文件名 Unicode 码点序**处理，保证确定性。
 *  - 修复在同一份 cue 模型上做（`core/fix`），修复后的文本与报告一起返回，
 *    界面只负责下载；重跑体检即得到"修复后违规数"（单调性由测试断言）。
 */
SP.define(
  "core/pipeline",
  [
    "core/decode",
    "core/parse/index",
    "core/rules/timing",
    "core/rules/readability",
    "core/rules/hygiene",
    "core/report",
    "core/fix",
    "core/sha256",
    "core/ruleset",
  ],
  function (decode, parser, timing, readability, hygiene, report, fix, sha256, ruleset) {
    "use strict";

    const CAPABILITIES = {
      parsers: { srt: "implemented", vtt: "implemented", ass: "implemented" },
      rules: {
        timing: "implemented",
        readability: "implemented",
        hygiene: "implemented",
      },
      exports: { json: "implemented", markdown: "implemented", csv: "implemented" },
      fixes: "implemented",
      driftFit: "implemented",
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
        declaredFps: options.declaredFps,
        diagnostics: parsed.diagnostics,
      });

      const readabilityResult = readability.run(parsed.cues);
      const hygieneResult = hygiene.run(parsed.cues);

      const findings = parsed.findings
        .concat(timingResult.findings)
        .concat(readabilityResult.findings)
        .concat(hygieneResult.findings);
      const skipped = parsed.skipped.concat(timingResult.skipped).concat(readabilityResult.skipped);

      const fixed = fix.apply(decoded.text, parsed.cues, {});
      skipped.push({ kind: "fix", reason: fixed.fixes.length ? "applied" : "no_fixable_finding" });

      const built = report.build({
        inputSha256: sha256.sha256Hex(file.bytes),
        findings,
        fixes: fixed.fixes,
        skipped,
        capabilities: CAPABILITIES,
        diagnostics: decoded.diagnostics.concat(parsed.diagnostics),
        whitelist: hygieneResult.whitelist,
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
        markdown: report.toMarkdown(built),
        csv: report.toCsv(built),
        fixedText: fixed.text,
        driftFit: timingResult.driftFit || null,
      };
    }

    /**
     * @param {Array<{name:string, bytes:Uint8Array}>} files
     * @param {{mediaDurationMs?:number, declaredFps?:number}} options
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
