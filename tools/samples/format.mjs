/**
 * 格式变体样本（3 格式 × 8 变体 = 24 份）+ 真值。
 *
 * 真值生成纪律（plan/04 §三）：标注器是**独立实现**（不 import src/core 的解析器），
 * 因此 M2 的解析器与这里的标注构成差分对照，而不是"比对两份预先算好的答案"。
 * 真值只存**输入与期望**：cue 边界、行号映射、诊断码；不写 observed/actual。
 *
 * 表（plan/04 §一）定义了"8 类变体"每格式的等价形态；本模块逐格落成文件。
 */
import { Builder, encodeText, encodeGbk } from "./util.mjs";
import { assertClean } from "./whitelist.mjs";
import { buildSrt, annotateSrtLines, srtTime, pad } from "./srtbuild.mjs";

/* ---------- 内容（全部虚构；中/英/日各一组） ---------- */

const ZH = [
  { startMs: 1000, endMs: 3000, text: ["角色甲：夜航开始了。"] },
  { startMs: 3500, endMs: 6000, text: ["角色乙：灯塔在哪边？", "风比昨天大。"] },
  { startMs: 6500, endMs: 9000, text: ["角色甲：跟着浪走。"] },
  { startMs: 9500, endMs: 12000, text: ["旁白：这是示例剧的第一集。"] },
];

const EN = [
  { startMs: 1000, endMs: 3000, text: ["Character A: The night flight begins."] },
  {
    startMs: 3500,
    endMs: 6000,
    text: ["Character B: Which way is the lighthouse?", "The wind is stronger today."],
  },
  { startMs: 6500, endMs: 9000, text: ["Character A: Follow the waves."] },
  { startMs: 9500, endMs: 12000, text: ["Narrator: This is episode one of Sample Show."] },
];

const JA = [
  { startMs: 1000, endMs: 3000, text: ["登場人物甲：夜の航海が始まる。"] },
  { startMs: 3500, endMs: 6000, text: ["登場人物乙：灯台はどっちだ？", "風が強い。"] },
  { startMs: 6500, endMs: 9000, text: ["登場人物甲：波について行こう。"] },
  { startMs: 9500, endMs: 12000, text: ["ナレーター：サンプル番組の第一話です。"] },
];

/* ---------- 时间码（VTT / ASS） ---------- */

function vttTime(ms, short) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ((ms % 1000) + 1000) % 1000;
  if (short && h === 0) return `${pad(m, 2)}:${pad(s, 2)}.${pad(milli, 3)}`;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(milli, 3)}`;
}

export function assTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((((ms % 1000) + 1000) % 1000) / 10);
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(cs, 2)}`;
}

/* ---------- 独立标注器：VTT ---------- */

const VTT_TIME_RE =
  /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})\.(\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})\.(\d{3})/;

function vttMs(h, m, s, frac) {
  return Number(h || 0) * 3600000 + Number(m) * 60000 + Number(s) * 1000 + Number(frac);
}

export function annotateVttLines(lines) {
  const cues = [];
  const diagnostics = [];
  let i = lines.length && /WEBVTT/.test(lines[0]) ? 1 : 0;
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i += 1;
      continue;
    }
    if (/^\s*(NOTE|STYLE|REGION)\b/.test(lines[i])) {
      const blockStart = i + 1;
      i += 1;
      while (i < lines.length && lines[i].trim() !== "") i += 1;
      diagnostics.push({ code: "parse.skipped-block", line: blockStart });
      continue;
    }
    const sourceLine = i + 1;
    let identifier = null;
    let timeLineIdx = i;
    if (!VTT_TIME_RE.test(lines[i]) && i + 1 < lines.length && VTT_TIME_RE.test(lines[i + 1])) {
      identifier = lines[i].trim();
      timeLineIdx = i + 1;
    }
    const match = VTT_TIME_RE.exec(lines[timeLineIdx]);
    if (!match) {
      i += 1;
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
      startMs: vttMs(match[1], match[2], match[3], match[4]),
      endMs: vttMs(match[5], match[6], match[7], match[8]),
      textLines,
      textLineNumbers,
      sourceLine,
      endLine: textLines.length ? j : timeLine,
    });
    i = j;
  }
  return { cues, diagnostics };
}

/* ---------- 独立标注器：ASS ---------- */

const ASS_TIME_RE = /^(\d+):(\d{1,2}):(\d{1,2})\.(\d{1,2})$/;

export function assMs(token) {
  const m = ASS_TIME_RE.exec(String(token).trim());
  if (!m) throw new Error("ASS 时间码无法解析: " + token);
  return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4]) * 10;
}

function splitAssFields(payload, count) {
  // Text 是最后一列，可含逗号：前 count-1 列按逗号切，其余全部归 Text
  const parts = [];
  let rest = payload;
  for (let k = 0; k < count - 1; k += 1) {
    const idx = rest.indexOf(",");
    if (idx < 0) throw new Error("ASS 字段数不足: " + payload);
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  parts.push(rest);
  return parts;
}

export function annotateAssLines(lines) {
  const cues = [];
  const diagnostics = [];
  let inEvents = false;
  let order = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (section) {
      inEvents = section[1].toLowerCase() === "events";
      order = null;
      continue;
    }
    if (!inEvents) continue;
    const formatLine = /^\s*Format:\s*(.+)$/i.exec(line);
    if (formatLine) {
      order = formatLine[1].split(",").map((s) => s.trim().toLowerCase());
      continue;
    }
    const dialogue = /^\s*Dialogue:\s*(.*)$/i.exec(line);
    if (dialogue) {
      if (!order) throw new Error("ASS：Dialogue 出现在 Format 之前");
      const values = splitAssFields(dialogue[1], order.length);
      const map = {};
      order.forEach((name, k) => {
        map[name] = values[k];
      });
      cues.push({
        index: cues.length + 1,
        style: (map.style || "").trim(),
        startMs: assMs(map.start),
        endMs: assMs(map.end),
        textLines: String(map.text).split(/\\N/),
        textLineNumbers: [i + 1],
        sourceLine: i + 1,
        endLine: i + 1,
      });
      continue;
    }
    if (/^\s*Comment:\s*/i.test(line)) {
      diagnostics.push({ code: "parse.skipped-comment", line: i + 1 });
    }
  }
  return { cues, diagnostics };
}

/* ---------- 序列化：SRT ---------- */

function srtSpec(content, opts) {
  const o = opts || {};
  return content.map((cue, k) => {
    const spec = {
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text,
    };
    if (o.indexMode === "jumped") spec.declaredIndex = [1, 3, 7, 9][k];
    else spec.declaredIndex = k + 1;
    if (o.commaDot && k % 2 === 1) {
      spec.timecode = `${srtTime(cue.startMs, true)} --> ${srtTime(cue.endMs, true)}`;
    }
    return spec;
  });
}

function srtVariant(content, opts) {
  const o = opts || {};
  const specs = content.map((cue, k) => {
    const spec = { startMs: cue.startMs, endMs: cue.endMs, text: cue.text, declaredIndex: null };
    if (o.indexMode === "sequential") spec.declaredIndex = k + 1;
    else if (o.indexMode === "jumped") spec.declaredIndex = [1, 3, 7, 9][k];
    if (o.commaDot && k % 2 === 1) {
      spec.timecode = `${srtTime(cue.startMs, true)} --> ${srtTime(cue.endMs, true)}`;
    }
    return spec;
  });
  return buildSrt(specs, { blankNoise: Boolean(o.blankNoise), trailingSpace: Boolean(o.trailingSpace) })
    .lines;
}

/* ---------- 序列化：VTT ---------- */

function vttVariant(content, opts) {
  const o = opts || {};
  const b = new Builder();
  b.push("WEBVTT");
  b.push("");
  for (let k = 0; k < content.length; k += 1) {
    const cue = content[k];
    if (!o.noCueId) b.push("cue-" + (k + 1) + (o.trailingSpace ? "  " : ""));
    const line = `${vttTime(cue.startMs, o.shortTime)} --> ${vttTime(cue.endMs, o.shortTime)}`;
    b.push(line + (o.trailingSpace ? "   " : ""));
    for (const text of cue.text) b.push(text + (o.trailingSpace ? "  " : ""));
    b.push("");
    if (o.noteBlock && k === 1) {
      b.push("NOTE 示例剧·夜航 的转场备注");
      b.push("");
    }
    if (o.blankNoise) b.push("");
  }
  return b.lines;
}

/* ---------- 序列化：ASS ---------- */

function assVariant(content, opts) {
  const o = opts || {};
  const b = new Builder();
  b.push("[Script Info]");
  b.push("Title: 示例剧·夜航");
  b.push("ScriptType: v4.00+");
  b.push("WrapStyle: 0");
  b.push("");
  b.push("[V4+ Styles]");
  b.push("Format: Name, Fontname, Fontsize, PrimaryColour, Alignment");
  b.push("Style: Default,DejaVu Sans,20,&H00FFFFFF,2");
  b.push("");
  b.push("[Events]");
  const order = o.formatOrder
    ? ["Start", "End", "Layer", "Style", "Text"]
    : ["Layer", "Start", "End", "Style", "Text"];
  b.push("Format: " + order.join(", "));
  for (let k = 0; k < content.length; k += 1) {
    const cue = content[k];
    const fields = {
      Layer: "0",
      Start: assTime(cue.startMs),
      End: assTime(cue.endMs),
      Style: "Default",
      Text: cue.text.join("\\N"),
    };
    b.push("Dialogue: " + order.map((name) => fields[name]).join(",") + (o.trailingSpace ? "  " : ""));
    if (o.commentLine && k === 1) {
      b.push("Comment: 0,0:00:00.00,0:00:00.00,Default,被跳过的注释行");
    }
    if (o.blankNoise) b.push("");
  }
  return b.lines;
}

/* ---------- 变体清单 ---------- */

const VARIANTS = {
  srt: [
    { id: "srt-v1-bom", variant: "bom", content: ZH, opts: { indexMode: "sequential" }, bytesOpts: { bom: true } },
    { id: "srt-v2-crlf", variant: "crlf", content: ZH, opts: { indexMode: "sequential" }, bytesOpts: { crlf: true } },
    { id: "srt-v3-missing-index", variant: "missing-index", content: ZH, opts: { indexMode: "none" } },
    { id: "srt-v4-jumped-index", variant: "jumped-index", content: ZH, opts: { indexMode: "jumped" } },
    { id: "srt-v5-comma-dot", variant: "comma-dot", content: ZH, opts: { indexMode: "sequential", commaDot: true } },
    { id: "srt-v6-gbk", variant: "gbk", content: ZH, opts: { indexMode: "sequential" }, encoding: "gbk" },
    { id: "srt-v7-trailing-space", variant: "trailing-space", content: ZH, opts: { indexMode: "sequential", trailingSpace: true } },
    { id: "srt-v8-blank-noise", variant: "blank-noise", content: ZH, opts: { indexMode: "sequential", blankNoise: true } },
  ],
  vtt: [
    { id: "vtt-v1-bom", variant: "bom", content: EN, opts: {}, bytesOpts: { bom: true } },
    { id: "vtt-v2-crlf", variant: "crlf", content: EN, opts: {}, bytesOpts: { crlf: true } },
    { id: "vtt-v3-no-cue-id", variant: "no-cue-id", content: EN, opts: { noCueId: true } },
    { id: "vtt-v4-note-block", variant: "note-block", content: EN, opts: { noteBlock: true } },
    { id: "vtt-v5-ms-dot", variant: "ms-dot", content: EN, opts: { shortTime: true } },
    { id: "vtt-v6-gbk", variant: "gbk", content: ZH, opts: {}, encoding: "gbk" },
    { id: "vtt-v7-trailing-space", variant: "trailing-space", content: EN, opts: { trailingSpace: true } },
    { id: "vtt-v8-blank-noise", variant: "blank-noise", content: EN, opts: { blankNoise: true } },
  ],
  ass: [
    { id: "ass-v1-bom", variant: "bom", content: JA, opts: {}, bytesOpts: { bom: true } },
    { id: "ass-v2-crlf", variant: "crlf", content: JA, opts: {}, bytesOpts: { crlf: true } },
    { id: "ass-v3-format-order", variant: "format-order", content: JA, opts: { formatOrder: true } },
    { id: "ass-v4-comment-line", variant: "comment-line", content: JA, opts: { commentLine: true } },
    { id: "ass-v5-centiseconds", variant: "centiseconds", content: JA, opts: {} },
    { id: "ass-v6-gbk", variant: "gbk", content: ZH, opts: {}, encoding: "gbk" },
    { id: "ass-v7-trailing-space", variant: "trailing-space", content: JA, opts: { trailingSpace: true } },
    { id: "ass-v8-blank-noise", variant: "blank-noise", content: JA, opts: { blankNoise: true } },
  ],
};

const EXT = { srt: "srt", vtt: "vtt", ass: "ass" };
const SERIALIZER = { srt: srtVariant, vtt: vttVariant, ass: assVariant };
const ANNOTATOR = { srt: annotateSrtLines, vtt: annotateVttLines, ass: annotateAssLines };

/**
 * 每个格式的**基准渲染**（全部默认选项）。植入器自证 =
 * "本变体与该格式基准的字节不同"，再加上该变体的专属形态断言。
 */
const BASE_OPTS = {
  srt: { indexMode: "sequential" },
  vtt: {},
  ass: {},
};

const isNotUtf8 = (text, bytes) => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
};

const hasTrailingSpace = (text) => text.split("\n").some((l) => l.endsWith(" "));
const hasBlankNoise = (text) => text.startsWith("\n\n") || text.includes("\n\n\n");

/** 变体专属形态断言：证明这份样本**真的**带着它声称的那个变体。 */
const VARIANTS_PREDICATE = {
  srt: {
    bom: (t, b) => b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf,
    crlf: (t) => t.includes("\r\n"),
    "missing-index": (t) => !/^\d+\r?\n/.test(t),
    "jumped-index": (t) => /^1\r?\n/.test(t) && /^7\r?\n/m.test(t),
    "comma-dot": (t) => /,\d{3}\s*-->/.test(t) && /\.\d{3}\s*-->/.test(t),
    gbk: isNotUtf8,
    "trailing-space": hasTrailingSpace,
    "blank-noise": hasBlankNoise,
  },
  vtt: {
    bom: (t, b) => b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf,
    crlf: (t) => t.includes("\r\n"),
    "no-cue-id": (t) => !/^cue-\d+/.test(t.split("\n").filter((l) => l && l !== "WEBVTT").join("\n")),
    "note-block": (t) => /\nNOTE /.test(t),
    "ms-dot": (t) => /^\d{2}:\d{2}\.\d{3}\s*-->/m.test(t) && !/^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->/m.test(t),
    gbk: isNotUtf8,
    "trailing-space": hasTrailingSpace,
    "blank-noise": hasBlankNoise,
  },
  ass: {
    bom: (t, b) => b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf,
    crlf: (t) => t.includes("\r\n"),
    "format-order": (t) => /^Format:\s*Start,\s*End,\s*Layer/m.test(t),
    "comment-line": (t) => /^Comment: /m.test(t),
    centiseconds: (t) => /^\d+:\d{2}:\d{2}\.\d{2}$/m.test(t.split("Dialogue: ")[1].split(",")[1] || ""),
    gbk: isNotUtf8,
    "trailing-space": hasTrailingSpace,
    // ASS 基准的事件区是连续的；空行噪声 = 事件之间多出空行
    "blank-noise": (t) => /\n\nDialogue: /.test(t),
  },
};

/** 声明为"基准形态"而非变异：该格式原生就是这个形态，没有可植入的缺陷。 */
const BASELINE_VARIANTS = new Set(["ass/centiseconds"]);

/**
 * @returns {Array<{id, format, variant, encoding, bom, eol, fileName, bytes, text, truth}>}
 */
export function buildFormatSamples() {
  const out = [];
  for (const format of ["srt", "vtt", "ass"]) {
    const baseLines = SERIALIZER[format](VARIANTS[format][0].content, BASE_OPTS[format]);
    const baseBytes = encodeText(baseLines.join("\n") + "\n", {});
    for (const spec of VARIANTS[format]) {
      const lines = SERIALIZER[format](spec.content, spec.opts);
      const text = lines.join("\n") + "\n";
      for (const line of lines) assertClean(line, spec.id);
      const encoding = spec.encoding || "utf-8";
      const bom = spec.bytesOpts && spec.bytesOpts.bom ? "utf-8" : null;
      const eol = spec.bytesOpts && spec.bytesOpts.crlf ? "crlf" : "lf";
      let bytes;
      if (encoding === "gbk") {
        bytes = encodeGbk(text, { bom: false, crlf: false });
      } else {
        bytes = encodeText(text, { bom: Boolean(bom), crlf: eol === "crlf" });
      }

      // ---- 植入器自证：diff 非空 + 变体形态断言 ----
      // 形态断言跑在"从产出字节解回来的文本"上（CRLF / BOM 都活在字节里）
      const rawText = encoding === "gbk" ? new TextDecoder("gbk").decode(bytes) : bytes.toString("utf8");
      const key = `${format}/${spec.variant}`;
      const isBaseline = BASELINE_VARIANTS.has(key);
      const diffNonEmpty = !baseBytes.equals(bytes);
      if (!isBaseline && !diffNonEmpty) {
        throw new Error(`${spec.id}: 与 ${format} 基准渲染逐字节相同 → 该变体没有植入任何差异`);
      }
      const predicate = VARIANTS_PREDICATE[format][spec.variant];
      if (typeof predicate !== "function") throw new Error(`${spec.id}: 缺变体形态断言`);
      if (!predicate(rawText, bytes)) {
        throw new Error(`${spec.id}: 变体形态断言未通过（样本没有真的带上这个变体）`);
      }

      const annotated = ANNOTATOR[format](lines);
      const diagnostics = annotated.diagnostics.slice();
      if (encoding === "gbk") diagnostics.unshift({ code: "decode.gbk-fallback" });
      out.push({
        id: spec.id,
        format,
        variant: spec.variant,
        encoding,
        bom,
        eol,
        fileName: spec.id + "." + EXT[format],
        bytes,
        text,
        truth: {
          sample: "format/" + spec.id + "." + EXT[format],
          format,
          variant: spec.variant,
          encoding,
          bom,
          eol,
          cueCount: annotated.cues.length,
          cues: annotated.cues,
          diagnostics,
          plants: [
            {
              id: spec.id,
              variant: spec.variant,
              mode: isBaseline ? "baseline" : "mutation",
              diffNonEmpty,
              baseBytes: baseBytes.length,
              variantBytes: bytes.length,
            },
          ],
        },
      });
    }
  }
  return out;
}

export const VARIANTS_BY_FORMAT = VARIANTS;
