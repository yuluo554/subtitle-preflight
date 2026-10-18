/**
 * WebVTT 解析器（模块 ① 的 VTT 分支）。
 *
 * 纪律：
 *  - 行号一律 1-based，指向**归一化后的原文行**（换行归一不增删行）。
 *  - 首行 `WEBVTT`（允许其后跟 header 文本）整行跳过；
 *    `NOTE` / `STYLE` / `REGION` 整块跳过并产出 `parse.skipped-block`（带块首行号），不静默丢弃。
 *  - cue 标识行可有可无；时间码 `MM:SS.mmm` 与 `HH:MM:SS.mmm` 都接受；`-->` 后可带 settings。
 *  - 与 `data/truth/format/vtt-*.json` 0 容差：cue 数 / 起止时间 / 行号映射。
 */
SP.define("core/parse/vtt", [], function () {
  "use strict";

  const TIMECODE =
    /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})\.(\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})\.(\d{3})(?:\s+.*)?\s*$/;
  const BLOCK_START = /^\s*(?:NOTE|STYLE|REGION)\b/;

  function toMs(hour, minute, second, fraction) {
    return (
      Number(hour || 0) * 3600000 +
      Number(minute) * 60000 +
      Number(second) * 1000 +
      Number(fraction)
    );
  }

  function isTimecode(line) {
    return TIMECODE.test(line);
  }

  /**
   * @param {string} text 已归一化换行（LF）的原文
   * @returns {{cues:Array, findings:Array, diagnostics:Array}}
   */
  function parse(text) {
    const lines = text.split("\n");
    const cues = [];
    const findings = [];
    const diagnostics = [];
    let i = 0;

    // 首行 WEBVTT 头（可带其后 header 文本），整行跳过
    if (lines.length && /WEBVTT/.test(lines[0])) i = 1;

    while (i < lines.length) {
      if (lines[i].trim() === "") {
        i += 1;
        continue;
      }

      // NOTE / STYLE / REGION：整块（含其后的标识或文本行）跳过，只留一条诊断
      if (BLOCK_START.test(lines[i])) {
        const blockStart = i + 1;
        i += 1;
        while (i < lines.length && lines[i].trim() !== "") i += 1;
        diagnostics.push({ code: "parse.skipped-block", line: blockStart });
        continue;
      }

      const sourceLine = i + 1;
      let identifier = null;
      let timeLineIdx = i;

      // cue 标识行可有可无：非时间码行 + 下一行是时间码 ⇒ 视为标识
      if (!isTimecode(lines[i]) && i + 1 < lines.length && isTimecode(lines[i + 1])) {
        identifier = lines[i].trim();
        timeLineIdx = i + 1;
      }

      const match = TIMECODE.exec(lines[timeLineIdx]);
      if (!match) {
        // 形如时间码但解析不了：显式声明，不静默丢弃
        if (String(lines[timeLineIdx]).includes("-->")) {
          const lineNo = timeLineIdx + 1;
          findings.push({
            ruleId: "timing.unparsable-timecode",
            severity: "error",
            line: lineNo,
            field: "timecode",
            expected: "HH:MM:SS.mmm --> HH:MM:SS.mmm",
            actual: String(lines[timeLineIdx]).slice(0, 120),
            message: "时间码无法解析，该块已跳过",
          });
          diagnostics.push({ code: "parse.unparsable-timecode", line: lineNo });
        }
        i = timeLineIdx + 1;
        continue;
      }

      const timeLine = timeLineIdx + 1;
      let j = timeLineIdx + 1;
      while (j < lines.length && lines[j].trim() !== "") j += 1;

      const textLines = lines.slice(timeLineIdx + 1, j);
      const textLineNumbers = [];
      for (let k = 0; k < textLines.length; k += 1) textLineNumbers.push(timeLineIdx + 2 + k);

      cues.push({
        index: cues.length + 1,
        identifier,
        startMs: toMs(match[1], match[2], match[3], match[4]),
        endMs: toMs(match[5], match[6], match[7], match[8]),
        textLines,
        textLineNumbers,
        format: "vtt",
        sourceLine,
        endLine: textLines.length ? j : timeLine,
        timeLine,
      });

      i = j;
    }

    return { cues, findings, diagnostics };
  }

  return { parse, toMs, isTimecode, TIMECODE };
});
