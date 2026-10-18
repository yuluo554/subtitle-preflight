/**
 * SRT 解析器（模块 ①）。
 *
 * 纪律：
 *  - 行号一律 1-based，指向**归一化后的原文行**（换行归一不增删行）。
 *  - 容忍：序号缺失 / 跳号 / 与块数不一致 / `,` 与 `.` 混用 / 行尾空白 / 空行噪声。
 *  - 时间码无法解析时走回退路径并产出 `timing.unparsable-timecode`，不静默丢弃。
 */
SP.define("core/parse/srt", [], function () {
  "use strict";

  const TIMECODE = /^\s*(\d{1,4}):(\d{1,2}):(\d{1,2})[,.](\d{1,4})\s*-->\s*(\d{1,4}):(\d{1,2}):(\d{1,2})[,.](\d{1,4})(?:\s+.*)?\s*$/;
  const INDEX_LINE = /^\s*\d+\s*$/;

  function toMs(hour, minute, second, fraction) {
    const digits = fraction.length;
    let ms;
    if (digits === 1) ms = Number(fraction) * 100;
    else if (digits === 2) ms = Number(fraction) * 10;
    else if (digits === 3) ms = Number(fraction);
    else ms = Math.floor(Number(fraction) / 10); // 4 位及以上：截断到毫秒
    return Number(hour) * 3600000 + Number(minute) * 60000 + Number(second) * 1000 + ms;
  }

  function precisionIssues(match, line) {
    const issues = [];
    const startHour = match[1];
    const endHour = match[5];
    const startFrac = match[4];
    const endFrac = match[8];
    if (startHour.length > 2) {
      issues.push({ code: "parse.timecode-precision", line, field: "startMs", detail: "小时位超过 2 位" });
    }
    if (endHour.length > 2) {
      issues.push({ code: "parse.timecode-precision", line, field: "endMs", detail: "小时位超过 2 位" });
    }
    if (startFrac.length > 3) {
      issues.push({ code: "parse.timecode-precision", line, field: "startMs", detail: "亚毫秒精度被截断" });
    }
    if (endFrac.length > 3) {
      issues.push({ code: "parse.timecode-precision", line, field: "endMs", detail: "亚毫秒精度被截断" });
    }
    if (startFrac.length !== 3) {
      issues.push({ code: "parse.timecode-precision", line, field: "startMs", detail: "毫秒位不是 3 位" });
    }
    if (endFrac.length !== 3) {
      issues.push({ code: "parse.timecode-precision", line, field: "endMs", detail: "毫秒位不是 3 位" });
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

      for (const issue of precisionIssues(match, timeLineIdx + 1)) {
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
        startMs: toMs(match[1], match[2], match[3], match[4]),
        endMs: toMs(match[5], match[6], match[7], match[8]),
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
