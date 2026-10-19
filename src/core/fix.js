/**
 * 可逆修复（模块 ⑤ 的修复部分）。
 *
 * 纪律（`plan/03` §5.2）：
 *  - 只做**白名单**内的修复，且一律是"可逆无损"动作：不改文本、不改断句、不重排语序、
 *    不合并/拆分 cue、不改字号颜色、不删 cue。
 *  - 修复落在**原文行**上（行号 → 新行内容），因此修复后的文件与原文逐行同构，
 *    格式（SRT / VTT / ASS）不需要重新序列化，也就不会引入格式漂移。
 *  - **每条规则的违规数不得因修复而增加**：缩短时间码时以 `duration.min` 作护栏——
 *    若缩短后时长低于可读性下限，宁可不修（否则会立刻产生新的 `readability.duration-short`）。
 *  - 修复记录进 `fixes[]`（`{ruleId, line, action, before, after}`），报告可见；
 *    不可修时不产出任何记录（`fixes[]` 为空）。
 *  - 纯函数层（K2）：不碰 DOM / 不发网络 / 不读时钟 / 不读 locale / 不用随机。
 *  - 阈值只读 `data/ruleset.v1.json`（K1）。
 */
SP.define("core/fix", ["core/ruleset"], function (ruleset) {
  "use strict";

  const TC_SHAPE = /^([+\-]?)(\d{1,4}):(\d{1,2}):(\d{1,2})([,.])(\d{1,4})$/;
  const TC_FIND = /[+\-]?\d{1,4}:\d{1,2}:\d{1,2}[,.]\d{1,4}/g;
  const TRAILING_WS = /[ \t]+$/;
  const TAG_RE = /<\/?([ibu])\s*\/?>/gi;
  const INDEX_LINE = /^\s*\d+\s*$/;
  const INDEX_PARTS = /^(\s*)(\d+)(\s*)$/;

  function pad2(value) {
    const s = String(value);
    return s.length >= 2 ? s : "0" + s;
  }

  /** 时间码 token 的**形态**（小时位数 / 分隔符 / 小数位数），用于同形重写。 */
  function shapeOf(token) {
    const m = TC_SHAPE.exec(token);
    if (!m) return null;
    return { hourDigits: m[2].length, sep: m[5], fracDigits: m[6].length };
  }

  function formatMs(ms, shape) {
    const abs = Math.abs(ms);
    const h = Math.floor(abs / 3600000);
    const mi = Math.floor((abs % 3600000) / 60000);
    const s = Math.floor((abs % 60000) / 1000);
    const frac = abs % 1000;
    let fracStr;
    if (shape.fracDigits === 1) fracStr = String(Math.floor(frac / 100));
    else if (shape.fracDigits === 2) fracStr = pad2(Math.floor(frac / 10));
    else {
      fracStr = String(frac).padStart(3, "0");
      while (fracStr.length < shape.fracDigits) fracStr += "0";
    }
    return (
      (ms < 0 ? "-" : "") +
      String(h).padStart(shape.hourDigits, "0") +
      ":" +
      pad2(mi) +
      ":" +
      pad2(s) +
      shape.sep +
      fracStr
    );
  }

  /**
   * 重写时间码行：**保留原行的分隔符与小数位数**，只换两个时间码的数值。
   * 找不到两个时间码 token 时返回 null（宁可不修，也不猜格式）。
   */
  function rewriteTimeLine(line, startMs, endMs) {
    TC_FIND.lastIndex = 0;
    const matches = [];
    let m;
    while ((m = TC_FIND.exec(line))) matches.push({ token: m[0], index: m.index });
    if (matches.length < 2) return null;
    const shapeStart = shapeOf(matches[0].token);
    const shapeEnd = shapeOf(matches[1].token);
    if (!shapeStart || !shapeEnd) return null;
    const first = formatMs(startMs, shapeStart);
    const second = formatMs(endMs, shapeEnd);
    return (
      line.slice(0, matches[0].index) +
      first +
      line.slice(matches[0].index + matches[0].token.length, matches[1].index) +
      second +
      line.slice(matches[1].index + matches[1].token.length)
    );
  }

  /** 补 `<i>/<b>/<u>` 闭合（只追加闭合标签，不新增样式）；交叉嵌套不可修 → null。 */
  function closeTags(line) {
    const stack = [];
    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(line))) {
      const tag = m[1].toLowerCase();
      const whole = m[0];
      if (/\/\s*>$/.test(whole) && !/^<\//.test(whole)) continue; // 自闭合
      if (/^<\//.test(whole)) {
        if (stack.length === 0 || stack[stack.length - 1] !== tag) return null; // 交叉嵌套
        stack.pop();
      } else {
        stack.push(tag);
      }
    }
    if (stack.length === 0) return null;
    let out = line;
    for (let k = stack.length - 1; k >= 0; k -= 1) out += "</" + stack[k] + ">";
    return out;
  }

  /** 行尾空白：只删行尾空格/制表符；整行只剩空白时不动（避免改变块结构）。 */
  function stripTrailingSpace(line) {
    if (!TRAILING_WS.test(line)) return null;
    const after = line.replace(TRAILING_WS, "");
    return after === "" ? null : after;
  }

  /**
   * SRT 序号重编：按时间序重排 cue 块并连续编号。
   *
   * 保守前提（不满足就不做，宁可不修）：
   *  - 全部 cue 都是 SRT；
   *  - 块区间互不重叠，且所有**非空行**都落在某个块内（文件确实是"块 + 空行"结构）；
   *  - 每个块的首行都是序号行（缺序号的块不修，不凭空造序号）。
   * @returns {{chunks:Array<string[]>, moves:Array} | null}
   */
  function planReorder(lines, cues) {
    if (!cues.length) return null;
    if (cues.some((cue) => cue.format !== "srt")) return null;
    const blocks = [];
    for (const cue of cues) {
      const start = cue.sourceLine;
      const end = cue.endLine >= cue.sourceLine ? cue.endLine : cue.sourceLine;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > lines.length) return null;
      blocks.push({ cue, start, end });
    }
    const covered = new Array(lines.length + 1).fill(false);
    for (const block of blocks) {
      for (let n = block.start; n <= block.end; n += 1) {
        if (covered[n]) return null; // 块区间重叠
        covered[n] = true;
      }
    }
    for (let n = 1; n <= lines.length; n += 1) {
      if (lines[n - 1].trim() !== "" && !covered[n]) return null; // 存在不属于任何块的内容
    }
    for (const block of blocks) {
      if (!INDEX_LINE.test(lines[block.start - 1])) return null; // 缺序号行
    }
    const sorted = blocks.slice().sort((a, b) => {
      if (a.cue.startMs !== b.cue.startMs) return a.cue.startMs - b.cue.startMs;
      return a.cue.index - b.cue.index;
    });
    return { blocks, sorted };
  }

  /**
   * @param {string} text 已归一化换行（LF）的原文
   * @param {Array} cues 解析层产出的 cue（需要 `timeLine` / `textLineNumbers` / `sourceLine` / `endLine`）
   * @param {{eol?:string}} options `eol: "crlf"` 时输出 CRLF；缺省为 LF（换行归一不是缺陷修复，不计入 fixes[]）
   * @returns {{fixes:Array, text:string}}
   */
  function apply(text, cues, options) {
    const opts = options || {};
    const gapMin = ruleset.get("timing.gapMin");
    const durationMin = ruleset.get("duration.min");
    const source = String(text);
    const lines = source.split("\n");
    const list = cues || [];
    const edits = new Map();
    const fixes = [];

    const current = (no) => {
      if (!Number.isInteger(no) || no < 1 || no > lines.length) return null;
      return edits.has(no) ? edits.get(no) : lines[no - 1];
    };
    const set = (no, content) => {
      edits.set(no, content);
    };

    /* ① 去重叠 / 修间隔：缩短"前一条"的 end 到 `后一条 start − gapMin`，
          使修完之后两条规则**同时消失**（若只缩到后一条 start，间隔恰好为 0，
          会立刻被 `timing.gap-too-small` 接手）。
          护栏：缩短后时长必须 > 0 **且 ≥ duration.min**，否则会新增 duration-short。 */
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1];
      const cur = list[i];
      const gap = cur.startMs - prev.endMs;
      if (gap >= gapMin) continue;
      const desired = cur.startMs - gapMin;
      if (!(desired > prev.startMs && desired < prev.endMs)) continue; // 时长必须 > 0
      if (desired - prev.startMs < durationMin) continue; // 不得低于可读性时长下限
      const before = current(prev.timeLine);
      if (before === null) continue;
      const after = rewriteTimeLine(before, prev.startMs, desired);
      if (after === null || after === before) continue;
      set(prev.timeLine, after);
      fixes.push({
        ruleId: gap < 0 ? "timing.overlap" : "timing.gap-too-small",
        line: prev.timeLine,
        action: gap < 0 ? "trim-overlap" : "fill-gap",
        before,
        after,
      });
    }

    /* ② 去行尾空白：只删行尾空格/制表符。
          **必须排在闭合标签之前**：`<i>斜体没关␠␠` 先去掉行尾空白，再补 `</i>` 才是
          `<i>斜体没关</i>`；若顺序反过来，补上的闭合标签会把行尾空白"锁"在标签内侧。 */
    for (let no = 1; no <= lines.length; no += 1) {
      const before = current(no);
      if (before === null) continue;
      const after = stripTrailingSpace(before);
      if (after === null) continue;
      set(no, after);
      fixes.push({ ruleId: null, line: no, action: "strip-trailing-space", before, after });
    }

    /* ③ 闭合标签：只追加闭合标签，不新增样式（交叉嵌套不修）。 */
    for (const cue of list) {
      const numbers = cue.textLineNumbers || [];
      const texts = cue.textLines || [];
      for (let k = 0; k < texts.length; k += 1) {
        const no = numbers[k];
        const before = current(no);
        if (before === null) continue;
        const after = closeTags(before);
        if (after === null || after === before) continue;
        set(no, after);
        fixes.push({ ruleId: "hygiene.unclosed-tag", line: no, action: "close-tag", before, after });
      }
    }

    /* ④ 序号重编（仅 SRT）：按时间序重排块 + 连续编号；不满足保守前提则整条跳过。 */
    const edited = [];
    for (let no = 1; no <= lines.length; no += 1) edited.push(current(no));
    const plan = planReorder(edited, list);
    let out = edited;
    if (plan) {
      const { blocks, sorted } = plan;
      const alreadyOrdered = sorted.every((block, k) => block === blocks[k]);
      const indexOk = blocks.every((block, k) => {
        const parts = INDEX_PARTS.exec(edited[block.start - 1]);
        return parts && Number(parts[2]) === k + 1;
      });
      if (!alreadyOrdered || !indexOk) {
        const trailingBlanks = countTrailingBlanks(edited);
        const rebuilt = [];
        const moved = [];
        sorted.forEach((block, k) => {
          const chunk = edited.slice(block.start - 1, block.end);
          const parts = INDEX_PARTS.exec(chunk[0]);
          const oldNumber = parts ? Number(parts[2]) : null;
          if (parts) chunk[0] = parts[1] + String(k + 1) + parts[3];
          if (oldNumber !== k + 1 || block.start !== blocks[k].start) moved.push({ block, oldNumber, newNumber: k + 1 });
          if (k > 0) rebuilt.push("");
          for (const line of chunk) rebuilt.push(line);
        });
        for (let k = 0; k < trailingBlanks; k += 1) rebuilt.push("");
        out = rebuilt;
        // 只记**真的变了**的块：没变的块不该出现在 fixes[]（否则等于报了一次假修复）
        for (const entry of moved) {
          fixes.push({
            ruleId: "parse.index-mismatch",
            line: entry.block.start,
            action: "renumber-index",
            before: edited[entry.block.start - 1],
            after: "序号 " + entry.oldNumber + " → " + entry.newNumber,
          });
        }
      }
    }

    let result = out.join("\n");
    if (opts.eol === "crlf") result = result.replace(/\n/g, "\r\n");
    return { fixes, text: result };
  }

  function countTrailingBlanks(lines) {
    let n = 0;
    for (let i = lines.length - 1; i >= 0 && lines[i] === ""; i -= 1) n += 1;
    return n;
  }

  return { apply, rewriteTimeLine, closeTags, stripTrailingSpace, formatMs, shapeOf, planReorder };
});
