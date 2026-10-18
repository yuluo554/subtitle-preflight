/**
 * 可读性标注样本（200 条 cue）+ 真值。
 *
 * 标注方式：**逐条手写期望**（recipe 里显式声明该 cue 应报哪些 ruleId），
 * 再由 `readabilityoracle.mjs`（独立实现）复算并逐条对账——不一致就抛错。
 * 因此真值既不是"被测实现算出来的"，也不是"随手写的"，而是两者必须互相印证。
 *
 * 行号口径（M1 定稿）：`timing.*` 取 timeLine；`readability.*` / `hygiene.*` 属**文本类**，
 * 取 sourceLine（对应 plan/02 §3.1）。
 */
import { buildSrt, annotateSrtLines } from "./srtbuild.mjs";
import { runReadabilityOracle, READABILITY_RULES } from "./readabilityoracle.mjs";
import { assertClean } from "./whitelist.mjs";
import { measureCue, dominantLang, lineWidthMilli, readRuleset } from "./util.mjs";

const RULESET = readRuleset();

/* ---------- 文本池（全部自造，内容白名单） ---------- */

const ZH_POOL = "夜航灯塔浪风沙礁石帆船月潮汐港口码头灯影礁声船舷海雾桅杆星群";
const JA_POOL = "のうみのよるひかりとうだいなみかぜさざなみふねつきよかすみほし";
const EN_POOL = "night lighthouse waves wind sail rock tide harbor moon star fog mast";

/** 恰好 n 个全角/半角字符，起点由 seed 决定（保证相邻 cue 文本不同）。 */
export function fullText(n, seed) {
  let out = "";
  for (let k = 0; k < n; k += 1) out += ZH_POOL[(seed + k) % ZH_POOL.length];
  return out;
}

export function jaText(n, seed) {
  let out = "";
  for (let k = 0; k < n; k += 1) out += JA_POOL[(seed + k) % JA_POOL.length];
  return out;
}

export function halfText(n, seed) {
  const letters = EN_POOL.replace(/ /g, "");
  let out = "";
  for (let k = 0; k < n; k += 1) out += letters[(seed + k) % letters.length];
  return out;
}

/* ---------- recipe 构造 ---------- */

/** @type {Array<{file:string, lang:string, cues:Array<{text:string[], dur:number, expect:string[]}>}>} */
const FILES = [];

function push(file, lang, cues) {
  FILES.push({ file, lang, cues });
}

/* ---------- ① 中文（60 条） ---------- */

{
  const cues = [];
  // cps 扫描：单行 n 个全角字，时长 1000ms（zh 上限 9 cps）
  for (let n = 5; n <= 12; n += 1) {
    cues.push({ text: [fullText(n, n)], dur: 1000, expect: n > 9 ? ["readability.cps"] : [] });
  }
  // 行长扫描：单行 n 个全角字，时长 3000ms（zh 行长上限 16 全角）
  for (let n = 14; n <= 18; n += 1) {
    cues.push({ text: [fullText(n, n + 3)], dur: 3000, expect: n > 16 ? ["readability.line-length"] : [] });
  }
  // 行数扫描：1/2/3 行，每行 4 字，时长 3000ms
  for (let lines = 1; lines <= 3; lines += 1) {
    const arr = [];
    for (let k = 0; k < lines; k += 1) arr.push(fullText(4, lines * 7 + k));
    cues.push({ text: arr, dur: 3000, expect: lines > 2 ? ["readability.too-many-lines"] : [] });
  }
  // 可见字符下限（2 全角字）：1/2/3 字
  for (let n = 1; n <= 3; n += 1) {
    cues.push({ text: [fullText(n, n + 11)], dur: 2000, expect: n < 2 ? ["readability.too-few-chars"] : [] });
  }
  // 时长扫描：6 字，799/800/7000/7001（每条文本各不相同，避免误触 repeated-text）
  for (let k = 0; k < 4; k += 1) {
    const d = [799, 800, 7000, 7001][k];
    const expect = [];
    if (d < RULESET["duration.min"]) expect.push("readability.duration-short");
    if (d > RULESET["duration.max"]) expect.push("readability.duration-long");
    cues.push({ text: [fullText(6, 17 + k)], dur: d, expect });
  }
  // 重复文本：相邻两条文本相同、时间不同
  for (let k = 0; k < 3; k += 1) {
    const t = [fullText(5, 23 + k)];
    cues.push({ text: t, dur: 2000, expect: [] });
    cues.push({ text: t.slice(), dur: 3000, expect: ["readability.repeated-text"] });
  }
  // 装饰不计入可见字符
  cues.push({ text: ["<i>" + fullText(4, 31) + "</i>"], dur: 2000, expect: [] });
  cues.push({ text: ["{\\an8}" + fullText(4, 33)], dur: 2000, expect: [] });
  cues.push({ text: ["[music] " + fullText(3, 35)], dur: 2000, expect: [] });
  // 多规则并发
  cues.push({ text: [fullText(10, 37), fullText(10, 41)], dur: 1000, expect: ["readability.cps"] });
  cues.push({
    text: [fullText(17, 43), fullText(17, 47), fullText(17, 51)],
    dur: 7001,
    expect: ["readability.line-length", "readability.too-many-lines", "readability.duration-long"],
  });
  cues.push({
    text: [fullText(12, 53)],
    dur: 900,
    expect: ["readability.cps"],
  });
  // 干净补齐
  let seed = 61;
  while (cues.length < 60) {
    const n = 4 + (seed % 9);
    cues.push({ text: [fullText(n, seed)], dur: 2000, expect: [] });
    seed += 1;
  }
  push("readability-zh.srt", "zh", cues.slice(0, 60));
}

/* ---------- ② 英文（60 条） ---------- */

{
  const cues = [];
  // cps 扫描：单行 n 个半角字，时长 1000ms（en 上限 17 cps → 34 半角字）
  for (let n = 32; n <= 37; n += 1) {
    cues.push({ text: [halfText(n, n)], dur: 1000, expect: n > 34 ? ["readability.cps"] : [] });
  }
  // 行长扫描：单行 n 个半角字，时长 3000ms（en 行长上限 42 半角）
  for (let n = 40; n <= 44; n += 1) {
    cues.push({ text: [halfText(n, n + 5)], dur: 3000, expect: n > 42 ? ["readability.line-length"] : [] });
  }
  // 行数扫描
  for (let lines = 1; lines <= 3; lines += 1) {
    const arr = [];
    for (let k = 0; k < lines; k += 1) arr.push(halfText(6, lines * 9 + k));
    cues.push({ text: arr, dur: 3000, expect: lines > 2 ? ["readability.too-many-lines"] : [] });
  }
  // 可见字符下限（2 全角字 = 4 半角字）：2/3/4 半角字
  for (let n = 2; n <= 4; n += 1) {
    cues.push({ text: [halfText(n, n + 13)], dur: 2000, expect: n < 4 ? ["readability.too-few-chars"] : [] });
  }
  // 时长扫描（每条文本各不相同，避免误触 repeated-text）
  for (let k = 0; k < 4; k += 1) {
    const d = [799, 800, 7000, 7001][k];
    const expect = [];
    if (d < RULESET["duration.min"]) expect.push("readability.duration-short");
    if (d > RULESET["duration.max"]) expect.push("readability.duration-long");
    cues.push({ text: [halfText(12, 19 + k)], dur: d, expect });
  }
  // 重复文本
  for (let k = 0; k < 3; k += 1) {
    const t = [halfText(7, 27 + k)];
    cues.push({ text: t, dur: 2000, expect: [] });
    cues.push({ text: t.slice(), dur: 3000, expect: ["readability.repeated-text"] });
  }
  // 装饰不计入
  cues.push({ text: ["<i>" + halfText(8, 39) + "</i>"], dur: 2000, expect: [] });
  cues.push({ text: ["[music] " + halfText(6, 43)], dur: 2000, expect: [] });
  // 多规则并发
  cues.push({ text: [halfText(36, 47)], dur: 1000, expect: ["readability.cps"] });
  cues.push({
    text: [halfText(44, 51), halfText(44, 57), halfText(44, 63)],
    dur: 7001,
    expect: ["readability.line-length", "readability.too-many-lines", "readability.duration-long"],
  });
  // 干净补齐
  let seed = 71;
  while (cues.length < 60) {
    const n = 6 + (seed % 20);
    cues.push({ text: [halfText(n, seed)], dur: 2000, expect: [] });
    seed += 1;
  }
  push("readability-en.srt", "en", cues.slice(0, 60));
}

/* ---------- ③ 日文（40 条） ---------- */

{
  const cues = [];
  for (let n = 5; n <= 12; n += 1) {
    cues.push({ text: [jaText(n, n)], dur: 1000, expect: n > 9 ? ["readability.cps"] : [] });
  }
  for (let n = 14; n <= 18; n += 1) {
    cues.push({ text: [jaText(n, n + 4)], dur: 3000, expect: n > 16 ? ["readability.line-length"] : [] });
  }
  for (let lines = 1; lines <= 3; lines += 1) {
    const arr = [];
    for (let k = 0; k < lines; k += 1) arr.push(jaText(4, lines * 5 + k));
    cues.push({ text: arr, dur: 3000, expect: lines > 2 ? ["readability.too-many-lines"] : [] });
  }
  for (let n = 1; n <= 3; n += 1) {
    cues.push({ text: [jaText(n, n + 9)], dur: 2000, expect: n < 2 ? ["readability.too-few-chars"] : [] });
  }
  for (let k = 0; k < 4; k += 1) {
    const d = [799, 800, 7000, 7001][k];
    const expect = [];
    if (d < RULESET["duration.min"]) expect.push("readability.duration-short");
    if (d > RULESET["duration.max"]) expect.push("readability.duration-long");
    cues.push({ text: [jaText(6, 15 + k)], dur: d, expect });
  }
  for (let k = 0; k < 3; k += 1) {
    const t = [jaText(5, 21 + k)];
    cues.push({ text: t, dur: 2000, expect: [] });
    cues.push({ text: t.slice(), dur: 3000, expect: ["readability.repeated-text"] });
  }
  cues.push({ text: ["<i>" + jaText(4, 29) + "</i>"], dur: 2000, expect: [] });
  let seed = 40;
  while (cues.length < 40) {
    const n = 4 + (seed % 9);
    cues.push({ text: [jaText(n, seed)], dur: 2000, expect: [] });
    seed += 1;
  }
  push("readability-ja.srt", "ja", cues.slice(0, 40));
}

/* ---------- ④ 混排（40 条） ---------- */

{
  const cues = [];
  // 全角主导（zh 档）：全角多、半角少
  cues.push({ text: [fullText(9, 3)], dur: 1000, expect: [] });
  cues.push({ text: [fullText(10, 5)], dur: 1000, expect: ["readability.cps"] });
  cues.push({ text: [fullText(16, 7)], dur: 3000, expect: [] });
  cues.push({ text: [fullText(17, 9)], dur: 3000, expect: ["readability.line-length"] });
  // 半角主导（en 档）：半角多、全角少（+1 个全角字用于确认主导文字类别判定）
  cues.push({ text: [halfText(32, 11) + "灯"], dur: 1000, expect: [] });
  cues.push({ text: [halfText(35, 13) + "灯"], dur: 1000, expect: ["readability.cps"] });
  cues.push({ text: [halfText(40, 15) + "灯"], dur: 3000, expect: [] });
  cues.push({ text: [halfText(43, 17) + "灯"], dur: 3000, expect: ["readability.line-length"] });
  // 混排 + 行数
  cues.push({
    text: [fullText(6, 19), halfText(8, 21), fullText(6, 23)],
    dur: 3000,
    expect: ["readability.too-many-lines"],
  });
  // 混排 + 字符下限
  cues.push({ text: ["灯"], dur: 2000, expect: ["readability.too-few-chars"] });
  cues.push({ text: ["a"], dur: 2000, expect: ["readability.too-few-chars"] });
  // 混排 + 时长
  cues.push({ text: [fullText(4, 27) + halfText(4, 29)], dur: 799, expect: ["readability.duration-short"] });
  cues.push({ text: [fullText(4, 31) + halfText(4, 33)], dur: 7001, expect: ["readability.duration-long"] });
  // 混排重复文本
  for (let k = 0; k < 2; k += 1) {
    const t = [fullText(5, 35 + k) + halfText(4, 37 + k)];
    cues.push({ text: t, dur: 2000, expect: [] });
    cues.push({ text: t.slice(), dur: 3000, expect: ["readability.repeated-text"] });
  }
  // 干净补齐
  let seed = 50;
  while (cues.length < 40) {
    const n = 3 + (seed % 7);
    cues.push({ text: [fullText(n, seed) + halfText(2, seed)], dur: 2000, expect: [] });
    seed += 1;
  }
  push("readability-mixed.srt", "mixed", cues.slice(0, 40));
}

/* ---------- 植入器自证：给每条正例造一个"干净孪生" ---------- */

/**
 * 把 recipe 里对应规则的缺陷中和掉，得到**干净基线**。
 * 断言两件事：① 孪生与原件 diff 非空；② 孪生在独立判定式下**不再**报该规则。
 * 这就是 plan/04 §三.7 的"该位置在干净基线里确实没有这个缺陷"。
 */
function cleanTwin(ruleId, recipe) {
  const text = recipe.text.slice();
  const dur = recipe.dur;
  const limitOf = (lang) => (lang === "en" ? RULESET["line.maxWidthHalf"] * 500 : RULESET["line.maxWidthFull"] * 1000);

  switch (ruleId) {
    case "readability.cps":
      return { text, dur: dur * 3 };
    case "readability.line-length": {
      const lang = dominantLang(text);
      const limit = limitOf(lang);
      const trimmed = text.map((line) => {
        let out = line;
        // 逐字符裁到上限以内（至少留 1 个字符，避免变成空行改变其它规则语义）
        while (lineWidthMilli(out) > limit && out.length > 1) out = out.slice(0, -1);
        return out;
      });
      return { text: trimmed, dur };
    }
    case "readability.too-many-lines":
      return { text: text.slice(0, RULESET["line.maxLines"]), dur };
    case "readability.too-few-chars": {
      const min = RULESET["line.minChars"] * 1000;
      let out = text[0];
      while (measureCue([out]).charsMilli < min) out += "灯";
      return { text: [out].concat(text.slice(1)), dur };
    }
    case "readability.duration-short":
      return { text, dur: RULESET["duration.min"] };
    case "readability.duration-long":
      return { text, dur: RULESET["duration.max"] };
    case "readability.repeated-text":
      return { text: [text[0] + "灯"].concat(text.slice(1)), dur };
    default:
      throw new Error("cleanTwin 未覆盖规则: " + ruleId);
  }
}

function assertCleanTwin(fileName, recipes, k) {
  const recipe = recipes[k];
  const prev = k > 0 ? recipes[k - 1] : null;
  const language = dominantLang(recipe.text);
  const plantedCue = { textLines: recipe.text, startMs: 0, endMs: recipe.dur };
  // repeated-text 是跨条规则：评估时必须带上前一条作上下文
  const context = prev ? [{ textLines: prev.text, startMs: -10000, endMs: -5000 }] : [];
  const withContext = (cue) => context.concat([cue]);
  const hitsAtLast = (cue) => {
    const list = withContext(cue);
    const lines = list.map((_, i) => i + 1);
    return runReadabilityOracle(list, lines)
      .filter((f) => f.index === list.length)
      .map((f) => f.ruleId);
  };
  const errors = [];
  for (const ruleId of recipe.expect) {
    const twin = cleanTwin(ruleId, recipe);
    const twinCue = { textLines: twin.text, startMs: 0, endMs: twin.dur };
    const sameText = twin.text.join("\n") === recipe.text.join("\n");
    const sameDur = twin.dur === recipe.dur;
    if (sameText && sameDur) {
      errors.push(`${ruleId}: 干净孪生与植入件完全相同（diff 为空，样本不得计入检出率分母）`);
      continue;
    }
    if (hitsAtLast(twinCue).includes(ruleId)) {
      errors.push(`${ruleId}: 干净孪生仍然报该规则（${JSON.stringify(twin.text)} dur=${twin.dur}）`);
    }
    if (!hitsAtLast(plantedCue).includes(ruleId)) {
      errors.push(`${ruleId}: 植入件没有复算命中`);
    }
  }
  if (errors.length) {
    throw new Error(`${fileName} #${k + 1}（${language}）的植入自证失败：\n  ` + errors.join("\n  "));
  }
  return errors.length === 0;
}

export function buildReadabilitySamples() {
  const samples = [];
  let totalCues = 0;
  const perRule = new Map(READABILITY_RULES.map((r) => [r, { pos: 0, neg: 0 }]));

  for (const file of FILES) {
    const specs = file.cues.map((c, k) => ({
      declaredIndex: k + 1,
      startMs: 1000 + k * 5000,
      endMs: 1000 + k * 5000 + c.dur,
      text: c.text,
    }));
    const built = buildSrt(specs);
    const text = built.lines.join("\n") + "\n";
    for (const line of built.lines) assertClean(line, file.file);
    const annotated = annotateSrtLines(built.lines);
    if (annotated.cues.length !== file.cues.length) {
      throw new Error(`${file.file}: cue 数 ${annotated.cues.length} ≠ recipe ${file.cues.length}`);
    }
    // 真实时长按建行结果回读（endMs - startMs 由 recipe 的 dur 决定，保持一致）
    for (let k = 0; k < annotated.cues.length; k += 1) {
      annotated.cues[k].startMs = specs[k].startMs;
      annotated.cues[k].endMs = specs[k].endMs;
    }
    const lines = annotated.cues.map((c) => c.sourceLine);

    const oracle = runReadabilityOracle(annotated.cues, lines);

    // 逐条对账：手写期望 vs 独立判定式
    const mismatches = [];
    file.cues.forEach((recipe, k) => {
      const actual = oracle.filter((f) => f.index === k + 1).map((f) => f.ruleId).sort();
      const expect = recipe.expect.slice().sort();
      if (JSON.stringify(actual) !== JSON.stringify(expect)) {
        mismatches.push(
          `#${k + 1} ${JSON.stringify(recipe.text)} dur=${recipe.dur}: 期望 [${expect}] 实算 [${actual}]`
        );
      }
    });
    if (mismatches.length) {
      throw new Error(`${file.file}: 标注与独立判定式不一致\n  ` + mismatches.join("\n  "));
    }

    // 植入器自证：每条正例都要有非空的干净孪生，且孪生不复现该规则
    let plantCount = 0;
    file.cues.forEach((recipe, k) => {
      if (recipe.expect.length === 0) return;
      assertCleanTwin(file.file, file.cues, k);
      plantCount += recipe.expect.length;
    });

    // 覆盖度：每条规则的正例/反例
    const cues = annotated.cues.map((c, k) => {
      const errs = oracle.filter((f) => f.index === k + 1);
      const expect = file.cues[k].expect;
      const measured = measureCue(c.textLines);
      return {
        index: k + 1,
        line: lines[k],
        timeLine: c.timeLine,
        lang: dominantLang(c.textLines),
        durationMs: specs[k].endMs - specs[k].startMs,
        charsMilli: measured.charsMilli,
        maxLineWidthMilli: measured.maxLineWidthMilli,
        visibleLineCount: measured.visibleLineCount,
        expectFindings: expect.slice().sort(),
        expectNoFindings: READABILITY_RULES.filter((r) => !expect.includes(r)).map((ruleId) => ({
          ruleId,
          why: "本条未设计该缺陷，且独立判定式复核一致",
        })),
        errsCount: errs.length,
      };
    });

    for (const recipe of file.cues) {
      for (const r of READABILITY_RULES) {
        const entry = perRule.get(r);
        if (recipe.expect.includes(r)) entry.pos += 1;
        else entry.neg += 1;
      }
    }

    totalCues += cues.length;
    samples.push({
      id: file.file.replace(/\.srt$/, ""),
      fileName: file.file,
      lang: file.lang,
      text,
      cueCount: cues.length,
      truth: {
        sample: "readability/" + file.file,
        domain: "readability",
        lang: file.lang,
        cueCount: cues.length,
        lineConvention: "sourceLine（文本类 finding）",
        cues: cues.map((c) => {
          const { errsCount, ...rest } = c;
          return rest;
        }),
        expectFindings: oracle.map((f) => ({ ruleId: f.ruleId, line: f.line })),
        expectNoFindings: [],
        planted: READABILITY_RULES.filter((r) => file.cues.some((c) => c.expect.includes(r))).map(
          (ruleId) => ({
            id: `${file.file}#${ruleId}`,
            ruleId,
            mode: "clean-twin",
            diffNonEmpty: true,
            why: "干净孪生（中和该规则的最小改动）在独立判定式下不再报该规则",
          })
        ),
        plantedCount: plantCount,
      },
    });
  }

  // 覆盖度硬门：任一规则无正例即视为覆盖不足（plan/04 §三.6）
  const uncovered = READABILITY_RULES.filter((r) => perRule.get(r).pos === 0);
  if (uncovered.length) throw new Error("可读性规则无正例: " + uncovered.join(", "));
  const noNeg = READABILITY_RULES.filter((r) => perRule.get(r).neg === 0);
  if (noNeg.length) throw new Error("可读性规则无反例: " + noNeg.join(", "));
  if (totalCues !== 200) throw new Error(`可读性标注 cue 总数 ${totalCues} ≠ 200`);

  return { samples, totalCues, perRule };
}

export { READABILITY_RULES };
