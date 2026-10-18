/**
 * SRT 解析器（模块 ①）。
 *
 * 纪律：
 *  - 行号一律 1-based，指向**归一化后的原文行**（换行归一不增删行）。
 *  - 容忍：序号缺失 / 跳号 / 与块数不一致 / `,` 与 `.` 混用 / 行尾空白 / 空行噪声。
 *  - 时间码起点允许前导 `-`（负毫秒），交给规则层报 `timing.negative-start`（G11）。
 *  - 时间码无法解析时走回退路径并产出 `timing.unparsable-timecode`，不静默丢弃。
 */
SP.define("core/parse/srt", [], function () {
  "use strict";

  const TIMECODE = /^\s*(-?)(\d{1,4}):(\d{1,2}):(\d{1,2})[,.](\d{1,4})\s*-->\s*(-?)(\d{1,4}):(\d{1,2}):(\d{1,2})[,.](\d{1,4})(?:\s+.*)?\s*$/;
  const INDEX_LINE = /^\s*\d+\s*$/;

  function toMs(hour, minute, second, fraction, sign) {
    const digits = fraction.length;
    let ms;
    if (digits === 1) ms = Number(fraction) * 100;
    else if (digits === 2) ms = Number(fraction) * 10;
    else if (digits === 3) ms = Number(fraction);
    else ms = Math.floor(Number(fraction) / 10); // 4 位及以上：截断到毫秒
    const value = Number(hour) * 3600000 + Number(minute) * 60000 + Number(second) * 1000 + ms;
    return sign === "-" ? -value : value;
  }

  function precisionIssues(side, line, field) {
    const issues = [];
    if (side.hour.length > 2) {
      issues.push({ code: "parse.timecode-precision", line, field, detail: "小时位超过 2 位" });
    }
    if (side.fraction.length > 3) {
      issues.push({ code: "parse.timecode-precision", line, field, detail: "亚毫秒精度被截断" });
    }
    if (side.fraction.length !== 3) {
      issues.push({ code: "parse.timecode-precision", line, field, detail: "毫秒位不是 3 位" });
    }
    return issues;
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

    while (i < lines.length) {
      if (lines[i].trim() === "") {
        i += 1;
        continue;
      }

      const blockStart = i;
      let declaredIndex = null;
      let timeLineIdx = i;

      if (INDEX_LINE.test(lines[i]) && i + 1 < lines.length) {
        // 序号行之后要么是可解析的时间行，要么是"意图是时间行但坏了"的行（含 -->）
        if (isTimecode(lines[i + 1]) || lines[i + 1].includes("-->")) {
          declaredIndex = Number(lines[i].trim());
          timeLineIdx = i + 1;
        }
      }

      const timeLine = lines[timeLineIdx];
      const match = TIMECODE.exec(timeLine);
      if (!match) {
        findings.push({
          ruleId: "timing.unparsable-timecode",
          severity: "error",
          line: timeLineIdx + 1,
          field: "timecode",
          expected: "HH:MM:SS,mmm --> HH:MM:SS,mmm",
          actual: String(timeLine).slice(0, 120),
          message: "时间码无法解析，该块已跳过",
        });
        diagnostics.push({ code: "parse.unparsable-timecode", line: timeLineIdx + 1 });
        // 跳到下一个空行，避免把后续文本当独立块重复报错
        i = timeLineIdx + 1;
        while (i < lines.length && lines[i].trim() !== "") i += 1;
        continue;
      }

      // 序号契约：缺序号 / 跳号都记诊断（真值 data/truth/format/srt-v3,v4）
      if (declaredIndex === null) {
        diagnostics.push({ code: "parse.missing-index", line: timeLineIdx + 1 });
      } else if (declaredIndex !== cues.length + 1) {
        diagnostics.push({ code: "parse.index-mismatch", line: blockStart + 1 });
      }

      const startSide = { hour: match[2], fraction: match[5] };
      const endSide = { hour: match[7], fraction: match[10] };
      for (const issue of precisionIssues(startSide, timeLineIdx + 1, "startMs")) {
        diagnostics.push(issue);
      }
      for (const issue of precisionIssues(endSide, timeLineIdx + 1, "endMs")) {
        diagnostics.push(issue);
      }

      const textStart = timeLineIdx + 1;
      let j = textStart;
      while (j < lines.length && lines[j].trim() !== "") j += 1;

      const textLines = lines.slice(textStart, j);
      const textLineNumbers = [];
      for (let k = 0; k < textLines.length; k += 1) textLineNumbers.push(textStart + k + 1);

      if (textLines.length === 0) {
        findings.push({
          ruleId: "parse.empty-cue",
          severity: "warn",
          line: timeLineIdx + 1,
          field: "text",
          expected: "至少 1 行文本",
          actual: "0 行",
          message: "时间码后没有文本行",
        });
        diagnostics.push({ code: "parse.empty-cue", line: timeLineIdx + 1 });
      }

      cues.push({
        index: cues.length + 1,
        declaredIndex,
        startMs: toMs(match[2], match[3], match[4], match[5], match[1]),
        endMs: toMs(match[7], match[8], match[9], match[10], match[6]),
        textLines,
        textLineNumbers,
        format: "srt",
        sourceLine: blockStart + 1,
        endLine: j === textStart ? timeLineIdx + 1 : j,
        timeLine: timeLineIdx + 1,
      });

      i = j;
    }

    return { cues, findings, diagnostics };
  }

  return { parse, toMs, TIMECODE };
});
