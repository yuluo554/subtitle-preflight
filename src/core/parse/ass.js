/**
 * ASS / SSA 解析器（模块 ① 的 ASS 分支）。
 *
 * 纪律：
 *  - 只取 `[Events]` 段；段外（`[Script Info]` / `[V4+ Styles]` …）整段忽略。
 *  - 按 `Format:` 行建立 `字段名 → 列位` 映射，**不假设固定列位**（列序可乱序）。
 *  - `Text` 是最后一列，可含逗号：前 N-1 列按逗号切，其余全部归 `Text`。
 *  - `Comment:` 行跳过并计数（`parse.skipped-comment`，带行号）。
 *  - 时间码 `H:MM:SS.cc` → 毫秒；`\N` 拆行；行号一律指向 Dialogue 行。
 *  - 与 `data/truth/format/ass-*.json` 0 容差：cue 数 / 起止时间 / 行号映射。
 */
SP.define("core/parse/ass", [], function () {
  "use strict";

  const SECTION = /^\s*\[([^\]]+)\]\s*$/;
  const FORMAT_LINE = /^\s*Format:\s*(.+)$/i;
  const DIALOGUE_LINE = /^\s*Dialogue:\s*(.*)$/i;
  const COMMENT_LINE = /^\s*Comment:\s*/i;
  const TIME = /^(\d+):(\d{1,2}):(\d{1,2})\.(\d{1,2})$/;

  function toMs(hour, minute, second, fraction) {
    return (
      Number(hour) * 3600000 +
      Number(minute) * 60000 +
      Number(second) * 1000 +
      Number(fraction) * 10 // 厘秒 → 毫秒
    );
  }

  /** @returns {number|null} 无法解析时返回 null（不抛异常） */
  function parseTime(token) {
    const m = TIME.exec(String(token).trim());
    if (!m) return null;
    return toMs(m[1], m[2], m[3], m[4]);
  }

  /**
   * 把 Dialogue 载荷切成 count 列：前 count-1 列按第一个逗号切，其余全归最后一列。
   * @returns {string[]|null} 列数不足时返回 null
   */
  function splitFields(payload, count) {
    const parts = [];
    let rest = payload;
    for (let k = 0; k < count - 1; k += 1) {
      const idx = rest.indexOf(",");
      if (idx < 0) return null;
      parts.push(rest.slice(0, idx));
      rest = rest.slice(idx + 1);
    }
    parts.push(rest);
    return parts;
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
    let inEvents = false;
    let order = null;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      const section = SECTION.exec(line);
      if (section) {
        inEvents = section[1].trim().toLowerCase() === "events";
        order = null; // 换段必须重建列映射
        continue;
      }
      if (!inEvents) continue;

      const formatLine = FORMAT_LINE.exec(line);
      if (formatLine) {
        order = formatLine[1].split(",").map((s) => s.trim().toLowerCase());
        continue;
      }

      const dialogue = DIALOGUE_LINE.exec(line);
      if (dialogue) {
        const lineNo = i + 1;
        const values = order ? splitFields(dialogue[1], order.length) : null;
        if (!values) {
          diagnostics.push({ code: "parse.missing-format", line: lineNo });
          continue;
        }
        const map = {};
        for (let k = 0; k < order.length; k += 1) map[order[k]] = values[k];

        const startMs = parseTime(map.start);
        const endMs = parseTime(map.end);
        if (startMs === null || endMs === null) {
          findings.push({
            ruleId: "timing.unparsable-timecode",
            severity: "error",
            line: lineNo,
            field: "timecode",
            expected: "H:MM:SS.cc",
            actual: String(map.start) + " --> " + String(map.end),
            message: "时间码无法解析，该行已跳过",
          });
          diagnostics.push({ code: "parse.unparsable-timecode", line: lineNo });
          continue;
        }

        const textValue = map.text === undefined || map.text === null ? "" : String(map.text);
        cues.push({
          index: cues.length + 1,
          style: (map.style || "").trim(),
          startMs,
          endMs,
          textLines: textValue.split(/\\N/),
          textLineNumbers: [lineNo],
          format: "ass",
          sourceLine: lineNo,
          endLine: lineNo,
          timeLine: lineNo,
        });
        continue;
      }

      if (COMMENT_LINE.test(line)) {
        diagnostics.push({ code: "parse.skipped-comment", line: i + 1 });
      }
    }

    return { cues, findings, diagnostics };
  }

  return { parse, toMs, parseTime, TIMECODE: TIME };
});
