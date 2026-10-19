/**
 * 卫生规则（模块 ④）：S01–S10 全部实现。
 *
 * 口径（`data/README.md` §4.6，`plan/03` §四）：
 *  - 阈值与白名单**全部读 `data/ruleset.v1.json`**（K1），本文件不出现阈值字面量。
 *  - `hygiene.*` 属**文本类** finding，`line` 取 cue 的 `sourceLine`（K15）。
 *  - 同一条 cue 的多行命中同一条规则时只报一条（`line` 相同 → 重复项只是噪声），
 *    报告因此保持确定性、可读。
 *  - 白名单命中次数随报告输出（`summary.whitelist`），不得静默。
 *  - 纯函数层（K2）：不碰 DOM / 不发网络 / 不读时钟 / 不读 locale / 不用随机。
 *  - 与 `tools/samples/hygieneoracle.mjs`（不 import src/core）构成**差分对照**（K13）。
 */
SP.define("core/rules/hygiene", ["core/ruleset"], function (ruleset) {
  "use strict";

  const RULE_IDS = [
    "hygiene.cjk-latin-spacing",
    "hygiene.punctuation-width",
    "hygiene.trailing-punctuation",
    "hygiene.unclosed-tag",
    "hygiene.ass-override-residue",
    "hygiene.placeholder-residue",
    "hygiene.font-tag-residue",
    "hygiene.sdh-marker",
    "hygiene.all-caps",
    "hygiene.repeated-punctuation",
  ];

  const IMPLEMENTED = new Set(RULE_IDS);

  /** CJK 码点（含中文标点区与假名区，与真值侧判定式同口径）。 */
  const CJK = /[\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  const LATIN_OR_DIGIT = /[A-Za-z0-9]/;
  const HAN = /[\u4e00-\u9fff]/;
  const TAG_RE = /<\/?([ibu])\s*\/?>/gi;
  const ASS_OVERRIDE_RE = /\{\\[^}]*\}/;
  const PLACEHOLDER_RE = /%(\d+\$)?[sdf]/;
  const BRACE_INDEX_RE = /\{\d+\}/;
  const BRACE_NAMED_RE = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;
  const FONT_TAG_RE = /<font\b[^>]*>/i;
  const SDH_BRACKET_RE = /\[music\]/i;
  const SDH_PAREN_RE = /（[^）]*(笑声|掌声|音乐|歌唱|欢呼)[^）]*）/;
  const SONG_RE = /^♪[\s\S]*♪$/;
  const REPEATED_PUNCT_RE = /([,.;!?，。！？：；、])\1+/g;
  const NUMERIC_RE = /\d+\.\d+/g;
  const ELLIPSIS_RE = /\.\.\./g;
  const EN_FULLWIDTH_PUNCT_RE = /[，。！？：；（）]/;
  const ZH_HALFWIDTH_PUNCT_RE = /[,!?:;]/;

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

  function whitelist() {
    const list = ruleset.get("hygiene.whitelist");
    return Array.isArray(list) ? list : [];
  }

  function isWhitelisted(token, list) {
    return list.indexOf(token) >= 0;
  }

  /** S01：CJK 与拉丁/数字直接相邻，且该拉丁词不在白名单。命中时返回该词。 */
  function cjkLatinSpacing(raw, list) {
    const text = raw;
    for (let i = 0; i + 1 < text.length; i += 1) {
      const a = text[i];
      const b = text[i + 1];
      let latinStart = -1;
      if (CJK.test(a) && LATIN_OR_DIGIT.test(b)) {
        latinStart = i + 1;
      } else if (LATIN_OR_DIGIT.test(a) && CJK.test(b)) {
        latinStart = i;
        while (latinStart > 0 && LATIN_OR_DIGIT.test(text[latinStart - 1])) latinStart -= 1;
      }
      if (latinStart < 0) continue;
      let end = latinStart;
      while (end < text.length && LATIN_OR_DIGIT.test(text[end])) end += 1;
      const token = text.slice(latinStart, end);
      if (isWhitelisted(token, list)) continue;
      return token;
    }
    return null;
  }

  /** S02：中文语境出现半角 `, . ! ? : ;`，或英文语境出现全角标点。命中时返回该标点。 */
  function punctuationWidth(raw, list) {
    if (HAN.test(raw)) {
      let text = raw;
      for (const token of list) text = text.split(token).join("");
      text = text.replace(NUMERIC_RE, "").replace(ELLIPSIS_RE, "");
      const m = ZH_HALFWIDTH_PUNCT_RE.exec(text);
      return m ? m[0] : null;
    }
    const m = EN_FULLWIDTH_PUNCT_RE.exec(raw);
    return m ? m[0] : null;
  }

  /** S03：行尾为 `。` / `.`（问号感叹号不报）；省略号与白名单缩写不报。 */
  function trailingPunctuation(raw, list) {
    const text = String(raw).trim();
    if (/[。]$/.test(text)) return "。";
    if (!/\.$/.test(text)) return null;
    if (/\.\.\.$/.test(text)) return null;
    for (const token of list) {
      if (text.endsWith(token)) return null;
    }
    return ".";
  }

  /** S04：`<i>/<b>/<u>` 未闭合或交叉嵌套；自闭合形态不报。 */
  function unclosedTag(raw) {
    const stack = [];
    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(raw))) {
      const tag = m[1].toLowerCase();
      const whole = m[0];
      if (/\/\s*>$/.test(whole) && !/^<\//.test(whole)) continue; // 自闭合 <i/>
      if (/^<\//.test(whole)) {
        if (stack.length === 0 || stack[stack.length - 1] !== tag) return whole;
        stack.pop();
      } else {
        stack.push(tag);
      }
    }
    return stack.length > 0 ? "<" + stack[stack.length - 1] + ">" : null;
  }

  /** S05：非 ASS 输出含 `{\...}` 覆写块，或 `{` 未闭合。 */
  function assOverrideResidue(raw) {
    const m = ASS_OVERRIDE_RE.exec(raw);
    if (m) return m[0];
    let depth = 0;
    for (const ch of raw) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      if (depth < 0) return "}";
    }
    return depth !== 0 ? "{" : null;
  }

  /** S06：残留 `%s` / `%1$s` / `{0}` / `{name}`；单字母数学表达式 `{x}` 不报。 */
  function placeholderResidue(raw) {
    const percent = PLACEHOLDER_RE.exec(raw);
    if (percent) return percent[0];
    const index = BRACE_INDEX_RE.exec(raw);
    if (index) return index[0];
    BRACE_NAMED_RE.lastIndex = 0;
    const named = raw.match(BRACE_NAMED_RE) || [];
    for (const token of named) {
      if (!/^\{[a-z]\}$/.test(token)) return token;
    }
    return null;
  }

  /** S07：残留 `<font ...>`。 */
  function fontTagResidue(raw) {
    const m = FONT_TAG_RE.exec(raw);
    return m ? m[0] : null;
  }

  /** S08：SDH 标记 `[music]` / `（笑声）` 一类 / `♪`；整条以 `♪` 起止的歌词语境不报。 */
  function sdhMarker(raw) {
    const text = String(raw).trim();
    if (text.length > 2 && SONG_RE.test(text)) return null;
    const bracket = SDH_BRACKET_RE.exec(raw);
    if (bracket) return bracket[0];
    const paren = SDH_PAREN_RE.exec(raw);
    if (paren) return paren[0];
    return /♪/.test(raw) ? "♪" : null;
  }

  /** S09：全大写且可见长度 ≥ `hygiene.allCapsMinLength`（半角字符数）。 */
  function allCaps(raw, list, minLength) {
    const visible = stripDecorations(raw).replace(/\s/g, "");
    if (visible.length < minLength) return null;
    if (!/[A-Za-z]/.test(visible)) return null;
    if (visible !== visible.toUpperCase()) return null;
    if (isWhitelisted(visible, list)) return null;
    return visible;
  }

  /** S10：同类标点连续 ≥ `hygiene.repeatPunctMin` 次。 */
  function repeatedPunctuation(raw, minRepeat) {
    REPEATED_PUNCT_RE.lastIndex = 0;
    let m;
    while ((m = REPEATED_PUNCT_RE.exec(raw))) {
      if (m[0].length >= minRepeat) return m[0];
    }
    return null;
  }

  /** 每条规则的判定式 → 命中详情（`null` = 不报）。 */
  function checksFor(line, opts) {
    const list = opts.whitelist;
    return [
      ["hygiene.cjk-latin-spacing", cjkLatinSpacing(line, list), "spacing", "warn"],
      ["hygiene.punctuation-width", punctuationWidth(line, list), "punctuation", "warn"],
      ["hygiene.trailing-punctuation", trailingPunctuation(line, list), "textEnd", "warn"],
      ["hygiene.unclosed-tag", unclosedTag(line), "tags", "error"],
      ["hygiene.ass-override-residue", assOverrideResidue(line), "override", "error"],
      ["hygiene.placeholder-residue", placeholderResidue(line), "placeholder", "error"],
      ["hygiene.font-tag-residue", fontTagResidue(line), "fontTag", "error"],
      ["hygiene.sdh-marker", sdhMarker(line), "sdh", "error"],
      ["hygiene.all-caps", allCaps(line, list, opts.allCapsMinLength), "casing", "warn"],
      ["hygiene.repeated-punctuation", repeatedPunctuation(line, opts.repeatPunctMin), "punctuation", "warn"],
    ];
  }

  /** 每类规则的报告文案（`actual` 由判定式给出，这里是 `expected` 与 `message`）。 */
  const COPY = {
    "hygiene.cjk-latin-spacing": {
      expected: "CJK 与拉丁/数字之间留空格",
      message: "中日韩文字与拉丁/数字直接相邻（排版卫生）",
    },
    "hygiene.punctuation-width": {
      expected: "标点宽度与语境一致（中文用全角 / 英文用半角）",
      message: "标点宽度与所在语境不符（排版卫生）",
    },
    "hygiene.trailing-punctuation": {
      expected: "行尾不使用 。/.",
      message: "行尾出现句号（问号、感叹号不属口径范围）",
    },
    "hygiene.unclosed-tag": {
      expected: "标签成对闭合且不交叉嵌套",
      message: "内联标签未闭合或交叉嵌套",
    },
    "hygiene.ass-override-residue": {
      expected: "不含 ASS 覆写块",
      message: "残留 ASS 覆写块或花括号未闭合",
    },
    "hygiene.placeholder-residue": {
      expected: "不含未替换占位符",
      message: "残留未替换的占位符",
    },
    "hygiene.font-tag-residue": {
      expected: "不含 <font> 内联样式",
      message: "残留 <font> 内联样式标签",
    },
    "hygiene.sdh-marker": {
      expected: "不含 SDH 标记",
      message: "残留听障辅助标记（方括号 / 圆括号情绪 / 音符）",
    },
    "hygiene.all-caps": {
      expected: "非全大写（专有名词、缩写除外）",
      message: "整行全大写，超过口径长度下限",
    },
    "hygiene.repeated-punctuation": {
      expected: "同类标点不连续重复",
      message: "同类标点连续重复达到口径下限",
    },
  };

  /** 白名单命中次数（按词计数，只列命中 > 0 的词，键按字典序）。 */
  function countWhitelist(cues) {
    const list = whitelist();
    const counts = new Map();
    for (const cue of cues) {
      for (const line of cue.textLines || []) {
        for (const token of list) {
          const parts = String(line).split(token);
          const hits = parts.length - 1;
          if (hits > 0) counts.set(token, (counts.get(token) || 0) + hits);
        }
      }
    }
    const out = {};
    for (const key of Array.from(counts.keys()).sort()) out[key] = counts.get(key);
    return out;
  }

  /**
   * @param {Array<{textLines:string[], sourceLine:number}>} cues
   * @returns {{findings:Array, skipped:Array, implemented:string[], whitelist:Object}}
   */
  function run(cues) {
    const list = whitelist();
    const allCapsMinLength = ruleset.get("hygiene.allCapsMinLength");
    const repeatPunctMin = ruleset.get("hygiene.repeatPunctMin");
    const findings = [];

    for (const cue of cues) {
      const seen = new Set();
      for (const line of cue.textLines || []) {
        for (const entry of checksFor(line, { whitelist: list, allCapsMinLength, repeatPunctMin })) {
          const ruleId = entry[0];
          const detail = entry[1];
          if (detail === null || detail === undefined) continue;
          if (seen.has(ruleId)) continue; // 同 cue 同规则只报一条（line 相同）
          seen.add(ruleId);
          const copy = COPY[ruleId];
          findings.push({
            ruleId,
            severity: entry[3],
            line: cue.sourceLine,
            field: entry[2],
            expected: copy.expected,
            actual: String(detail),
            message: copy.message,
          });
        }
      }
    }

    return {
      findings,
      skipped: [],
      implemented: RULE_IDS.slice(),
      whitelist: countWhitelist(cues),
    };
  }

  return {
    run,
    RULE_IDS,
    IMPLEMENTED,
    countWhitelist,
    cjkLatinSpacing,
    punctuationWidth,
    trailingPunctuation,
    unclosedTag,
    assOverrideResidue,
    placeholderResidue,
    fontTagResidue,
    sdhMarker,
    allCaps,
    repeatedPunctuation,
    stripDecorations,
  };
});
