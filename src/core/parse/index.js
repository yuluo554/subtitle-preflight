/**
 * 格式判别与解析分派。
 *
 * 纪律：**按文件内容形态判别，不按扩展名**（扩展名只作提示）。
 * 已声明但未实现的解析器必须返回 `parser.not_implemented`，不得返回空成功——
 * 否则"没做"会被读成"通过"。
 */
SP.define("core/parse/index", ["core/parse/srt"], function (srt) {
  "use strict";

  const FORMAT_LABEL = {
    srt: "SubRip (.srt)",
    vtt: "WebVTT (.vtt)",
    ass: "Advanced SubStation Alpha (.ass/.ssa)",
    unknown: "未知格式",
  };

  function detectFormat(text, fileName) {
    const head = text.replace(/^\uFEFF/, "").slice(0, 4096);
    if (/^\s*WEBVTT\b/.test(head)) return "vtt";
    if (/^\s*\[Script Info\]/im.test(head) || /^\s*\[Events\]/im.test(head)) return "ass";
    if (/-->/.test(head)) return "srt";
    const ext = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    if (ext) {
      if (ext[1] === "srt") return "srt";
      if (ext[1] === "vtt") return "vtt";
      if (ext[1] === "ass" || ext[1] === "ssa") return "ass";
    }
    return "unknown";
  }

  function notImplemented(format) {
    return {
      cues: [],
      findings: [],
      diagnostics: [{ code: "parser.not_implemented", format, detail: FORMAT_LABEL[format] + " 解析器尚未实现" }],
      skipped: [{ kind: "parser", format, reason: "not_implemented" }],
    };
  }

  /**
   * @param {string} text 已归一化换行的原文
   * @param {string} fileName 仅用于扩展名提示
   */
  function parseText(text, fileName) {
    const format = detectFormat(text, fileName);

    if (format === "srt") {
      const parsed = srt.parse(text);
      return {
        format,
        cues: parsed.cues,
        findings: parsed.findings,
        diagnostics: parsed.diagnostics,
        skipped: [],
      };
    }

    if (format === "vtt" || format === "ass") {
      const stub = notImplemented(format);
      return {
        format,
        cues: stub.cues,
        findings: stub.findings,
        diagnostics: stub.diagnostics,
        skipped: stub.skipped,
      };
    }

    return {
      format: "unknown",
      cues: [],
      findings: [],
      diagnostics: [{ code: "parser.unsupported", detail: "无法判别格式（既非 SRT/VTT 也非 ASS）" }],
      skipped: [{ kind: "parser", format: "unknown", reason: "unsupported" }],
    };
  }

  return { parseText, detectFormat, FORMAT_LABEL };
});
