/**
 * 格式判别与解析分派。
 *
 * 纪律：**按文件内容形态判别，不按扩展名**（扩展名只作提示）。
 * SRT / VTT / ASS 三格式均已实现；解析器各自返回 cue / findings / diagnostics / skipped。
 */
SP.define("core/parse/index", ["core/parse/srt", "core/parse/vtt", "core/parse/ass"], function (srt, vtt, ass) {
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

  const PARSERS = { srt: srt, vtt: vtt, ass: ass };

  /**
   * @param {string} text 已归一化换行的原文
   * @param {string} fileName 仅用于扩展名提示
   */
  function parseText(text, fileName) {
    const format = detectFormat(text, fileName);
    const parser = PARSERS[format];
    if (parser) {
      const parsed = parser.parse(text);
      return {
        format,
        cues: parsed.cues,
        findings: parsed.findings,
        diagnostics: parsed.diagnostics,
        skipped: [],
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
