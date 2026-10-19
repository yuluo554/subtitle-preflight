/**
 * 可读性规则（模块 ③）：R01–R07 全部实现。
 *
 * 口径（`data/README.md` §4.2–§4.4，`plan/03` §三）：
 *  - 可见字符一律**定点千分字符**（milli）：全角 = 1000，半角 = 500；空白、换行、
 *    ASS 覆写块 `{...}`、HTML 标签 `<...>`、SDH 标记（方括号 / 圆括号 / `♪`）不计入。
 *  - 档位由 cue 的**主导文字类别**决定（全角为主 → zh；假名过半 → ja；半角为主 → en）。
 *  - 行长上限的单位是"该档字符数"，折成千分字符：中/日 = `line.maxWidthFull × 1000`，
 *    英 = `line.maxWidthHalf × 500`。
 *  - `readability.*` 属**文本类** finding，`line` 取 cue 的 `sourceLine`（K15）。
 *
 * 阈值全部读 `data/ruleset.v1.json`（K1）；本文件不出现阈值字面量。
 * 纯函数层（K2）：不碰 DOM / 不发网络 / 不读时钟 / 不读 locale / 不用随机。
 * 与 `tools/samples/readabilityoracle.mjs`（不 import src/core）构成**差分对照**（K13）。
 */
SP.define("core/rules/readability", ["core/ruleset"], function (ruleset) {
  "use strict";

  const RULE_IDS = [
    "readability.cps",
    "readability.line-length",
    "readability.too-many-lines",
    "readability.too-few-chars",
    "readability.duration-short",
    "readability.duration-long",
    "readability.repeated-text",
  ];

  const IMPLEMENTED = new Set(RULE_IDS);

  /** 千分字符换算基数（口径 §4.3 的计数单位，不是阈值）：全角 1000 / 半角 500。 */
  const FULL_MILLI = 1000;
  const HALF_MILLI = 500;

  /** 全角码点区间；区间外一律按半角计。 */
  const FULL_RANGES = [
    [0x1100, 0x115f],
    [0x2e80, 0x303e],
    [0x3041, 0x33ff],
    [0x3400, 0x4dbf],
    [0x4e00, 0x9fff],
    [0xa000, 0xa4cf],
    [0xac00, 0xd7a3],
    [0xf900, 0xfaff],
    [0xfe30, 0xfe4f],
    [0xff01, 0xff60],
    [0xffe0, 0xffe6],
    [0x20000, 0x2fffd],
    [0x30000, 0x3fffd],
  ];

  const KANA_RE = /[\u3041-\u30ff]/;

  function isFullWidth(ch) {
    const cp = ch.codePointAt(0);
    for (let i = 0; i < FULL_RANGES.length; i += 1) {
      const range = FULL_RANGES[i];
      if (cp >= range[0] && cp <= range[1]) return true;
    }
    return false;
  }

  /** 剥离不计入可见字符的装饰：ASS 覆写块 / HTML 标签 / SDH 方括号、圆括号 / 音符。 */
  function stripDecorations(line) {
    return String(line)
      .replace(/\{[^}]*\}/g, "")
      .replace(/<[^>]*>/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/（[^）]*）/g, "")
      .replace(/\([^)]*\)/g, "")
      .replace(/♪/g, "");
  }

  /** 一行 → 千分字符宽度（空白与换行不计）。 */
  function lineWidthMilli(line) {
    let milli = 0;
    const chars = Array.from(stripDecorations(line));
    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i];
      if (/\s/.test(ch)) continue;
      milli += isFullWidth(ch) ? FULL_MILLI : HALF_MILLI;
    }
    return milli;
  }

  /** 一条 cue 的可见字符度量：总宽 / 最长行 / 可见行数。 */
  function measureCue(textLines) {
    let charsMilli = 0;
    let maxLineWidthMilli = 0;
    let visibleLineCount = 0;
    const lines = textLines || [];
    for (let i = 0; i < lines.length; i += 1) {
      const width = lineWidthMilli(lines[i]);
      if (width > 0) visibleLineCount += 1;
      if (width > maxLineWidthMilli) maxLineWidthMilli = width;
      charsMilli += width;
    }
    return { charsMilli, maxLineWidthMilli, visibleLineCount };
  }

  /**
   * 主导文字类别 → 档位：全角计数为 0 → en；假名 ≥ 全角半数 → ja；
   * 全角 ≥ 半角 → zh；否则 en。逐码点判定，不调用分词或模型。
   */
  function dominantLang(textLines) {
    let full = 0;
    let half = 0;
    let kana = 0;
    const lines = textLines || [];
    for (let i = 0; i < lines.length; i += 1) {
      const chars = Array.from(stripDecorations(lines[i]));
      for (let k = 0; k < chars.length; k += 1) {
        const ch = chars[k];
        if (/\s/.test(ch)) continue;
        if (isFullWidth(ch)) {
          full += 1;
          if (KANA_RE.test(ch)) kana += 1;
        } else {
          half += 1;
        }
      }
    }
    if (full === 0) return "en";
    if (kana * 2 >= full) return "ja";
    if (full >= half) return "zh";
    return "en";
  }

  /**
   * finding 严格保持 plan/02 §3.2 的 7 键形态（ruleId/severity/line/field/expected/actual/message）；
   * 语言档位（zh/en/ja）写进 `expected` 与 `message` 文案，不新增键（避免数据契约漂移）。
   */
  function finding(ruleId, cue, field, expected, actual, message, severity) {
    return {
      ruleId,
      severity: severity || "error",
      line: cue.sourceLine,
      field,
      expected: String(expected),
      actual: String(actual),
      message,
    };
  }

  function langLabel(lang) {
    return lang === "en" ? "英" : lang === "ja" ? "日" : "中";
  }

  /**
   * @param {Array<{textLines:string[], startMs:number, endMs:number, sourceLine:number}>} cues
   * @returns {{findings:Array, skipped:Array, implemented:string[]}}
   */
  function run(cues, options) {
    const findings = [];
    const cpsZh = ruleset.get("cps.zh");
    const cpsEn = ruleset.get("cps.en");
    const cpsJa = ruleset.get("cps.ja");
    const maxLines = ruleset.get("line.maxLines");
    const minCharsMilli = ruleset.get("line.minChars") * FULL_MILLI;
    const durMin = ruleset.get("duration.min");
    const durMax = ruleset.get("duration.max");

    const fullLimitMilli = ruleset.get("line.maxWidthFull") * FULL_MILLI;
    const halfLimitMilli = ruleset.get("line.maxWidthHalf") * HALF_MILLI;

    function cpsLimitOf(lang) {
      if (lang === "en") return cpsEn;
      if (lang === "ja") return cpsJa;
      return cpsZh;
    }

    function lineLimitMilli(lang) {
      return lang === "en" ? halfLimitMilli : fullLimitMilli;
    }

    for (let i = 0; i < cues.length; i += 1) {
      const cue = cues[i];
      const prev = i > 0 ? cues[i - 1] : null;
      const lang = dominantLang(cue.textLines);
      const measured = measureCue(cue.textLines);
      const durationMs = cue.endMs - cue.startMs;

      const cpsLimit = cpsLimitOf(lang);
      if (durationMs > 0 && measured.charsMilli > cpsLimit * durationMs) {
        findings.push(
          finding(
            "readability.cps",
            cue,
            "cps",
            "<= " + cpsLimit + " cps（档位 " + lang + "）",
            "charsMilli=" + measured.charsMilli + " / " + durationMs + "ms",
            "阅读速度超过口径上限（档位 " + lang + "，" + langLabel(lang) + "文）"
          )
        );
      }

      const lineLimit = lineLimitMilli(lang);
      if (measured.maxLineWidthMilli > lineLimit) {
        findings.push(
          finding(
            "readability.line-length",
            cue,
            "maxLineWidthMilli",
            "<= " + lineLimit + " 千分字符（档位 " + lang + "）",
            "最长行 " + measured.maxLineWidthMilli,
            "单行长度超过该档行长上限（档位 " + lang + "，" + langLabel(lang) + "文）"
          )
        );
      }

      if (measured.visibleLineCount > maxLines) {
        findings.push(
          finding(
            "readability.too-many-lines",
            cue,
            "visibleLineCount",
            "<= " + maxLines,
            measured.visibleLineCount,
            "可见行数超过显示行数上限（档位 " + lang + "）"
          )
        );
      }

      if (measured.charsMilli < minCharsMilli) {
        findings.push(
          finding(
            "readability.too-few-chars",
            cue,
            "charsMilli",
            ">= " + minCharsMilli + " 千分字符",
            measured.charsMilli,
            "可见字符数低于口径下限（档位 " + lang + "）"
          )
        );
      }

      if (durationMs < durMin) {
        findings.push(
          finding(
            "readability.duration-short",
            cue,
            "durationMs",
            ">= " + durMin + " ms",
            durationMs,
            "显示时长低于口径下限（档位 " + lang + "）",
            "warn"
          )
        );
      }

      if (durationMs > durMax) {
        findings.push(
          finding(
            "readability.duration-long",
            cue,
            "durationMs",
            "<= " + durMax + " ms",
            durationMs,
            "显示时长超过口径上限（档位 " + lang + "）",
            "warn"
          )
        );
      }

      if (
        prev &&
        textOf(cue) === textOf(prev) &&
        (cue.startMs !== prev.startMs || cue.endMs !== prev.endMs)
      ) {
        findings.push(
          finding(
            "readability.repeated-text",
            cue,
            "text",
            "与上一条文本不同",
            "与上一条文本相同（时间不同）",
            "相邻 cue 文本重复（档位 " + lang + "）",
            "warn"
          )
        );
      }
    }

    return { findings, skipped: [], implemented: RULE_IDS.slice() };
  }

  function textOf(cue) {
    return (cue.textLines || []).join("\n");
  }

  return {
    run,
    RULE_IDS,
    IMPLEMENTED,
    dominantLang,
    measureCue,
    lineWidthMilli,
    stripDecorations,
    isFullWidth,
  };
});
