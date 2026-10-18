/**
 * 卫生 golden set（30 条 cue）+ 真值。
 *
 * 结构：10 条正例（每条规则 1 条）+ 10 条已知不报（白名单/近似形态，每条规则 1 条）
 *      + 10 条边界与口径形态（每条规则 1 条）。
 * 每条都由 `hygieneoracle.mjs`（独立实现）复算对账；不一致即抛错。
 *
 * 植入器自证：每条正例都带一个"干净基线"文本，断言（① 与植入文本 diff 非空、
 * ② 干净基线在独立判定式下确实不报该规则）。
 */
import { buildSrt, annotateSrtLines } from "./srtbuild.mjs";
import { runHygieneOracle, HYGIENE_RULES } from "./hygieneoracle.mjs";
import { assertClean } from "./whitelist.mjs";
import { plant } from "./util.mjs";

/* 干净基线（不含任何规则触发形态） */
const CLEAN = "夜航灯塔浪风沙";

/**
 * 每条：{ rule, kind: "pos" | "clean" | "boundary", text: [行...], clean: 干净基线文本,
 *         expect: [ruleId...], why }
 */
const CASES = [
  /* ---- 正例：每条规则一条 ---- */
  { rule: "hygiene.cjk-latin-spacing", kind: "pos", text: ["用Python写的脚本"], clean: "用 Python 写的脚本", expect: ["hygiene.cjk-latin-spacing"], why: "CJK 与拉丁直接相邻" },
  { rule: "hygiene.punctuation-width", kind: "pos", text: ["你好,世界"], clean: "你好，世界", expect: ["hygiene.punctuation-width"], why: "中文语境出现半角逗号" },
  { rule: "hygiene.trailing-punctuation", kind: "pos", text: ["这句话结束了。"], clean: "这句话结束了", expect: ["hygiene.trailing-punctuation"], why: "行尾为 。" },
  { rule: "hygiene.unclosed-tag", kind: "pos", text: ["<i>斜体没关"], clean: "<i>斜体已关</i>", expect: ["hygiene.unclosed-tag"], why: "<i> 未闭合" },
  { rule: "hygiene.ass-override-residue", kind: "pos", text: ["{\\an8}顶部字幕"], clean: "顶部字幕", expect: ["hygiene.ass-override-residue"], why: "残留 ASS 覆写块" },
  { rule: "hygiene.placeholder-residue", kind: "pos", text: ["你好 %s 世界"], clean: "你好 世界", expect: ["hygiene.placeholder-residue"], why: "残留 %s 占位符" },
  { rule: "hygiene.font-tag-residue", kind: "pos", text: ['<font color="red">红字</font>'], clean: "普通红字", expect: ["hygiene.font-tag-residue"], why: "残留 <font> 内联样式" },
  { rule: "hygiene.sdh-marker", kind: "pos", text: ["[music] 背景音乐"], clean: "背景音乐", expect: ["hygiene.sdh-marker"], why: "残留 [music] 标记" },
  { rule: "hygiene.all-caps", kind: "pos", text: ["THIS IS A VERY LONG ALL CAPS LINE"], clean: "This is a short line", expect: ["hygiene.all-caps"], why: "全大写且长度 ≥ 20 半角" },
  { rule: "hygiene.repeated-punctuation", kind: "pos", text: ["等一下！！！"], clean: "等一下！", expect: ["hygiene.repeated-punctuation"], why: "感叹号连续 3 次" },

  /* ---- 已知不报：每条规则一条 ---- */
  { rule: "hygiene.cjk-latin-spacing", kind: "clean", text: ["用 Python 写的脚本"], clean: CLEAN, expect: [], why: "中英之间已有空格" },
  { rule: "hygiene.punctuation-width", kind: "clean", text: ["你好，世界"], clean: CLEAN, expect: [], why: "中文语境用全角标点" },
  { rule: "hygiene.trailing-punctuation", kind: "clean", text: ["真的结束了吗？"], clean: CLEAN, expect: [], why: "行尾问号不属口径范围" },
  { rule: "hygiene.unclosed-tag", kind: "clean", text: ["<i>斜体已关</i>"], clean: CLEAN, expect: [], why: "标签成对闭合" },
  { rule: "hygiene.ass-override-residue", kind: "clean", text: ["顶部字幕"], clean: CLEAN, expect: [], why: "无覆写块残留" },
  { rule: "hygiene.placeholder-residue", kind: "clean", text: ["数学表达式 {x}"], clean: CLEAN, expect: [], why: "单字母 {x} 属数学表达式白名单" },
  { rule: "hygiene.font-tag-residue", kind: "clean", text: ["普通文字"], clean: CLEAN, expect: [], why: "无 <font> 残留" },
  { rule: "hygiene.sdh-marker", kind: "clean", text: ["\u266a 整条歌词 \u266a"], clean: CLEAN, expect: [], why: "整条以 ♪ 起止，属歌词语境白名单" },
  { rule: "hygiene.all-caps", kind: "clean", text: ["iPhone and iPad 都很轻"], clean: CLEAN, expect: [], why: "专有名词在白名单且非全大写" },
  { rule: "hygiene.repeated-punctuation", kind: "clean", text: ["他说省略号…后面还有话"], clean: CLEAN, expect: [], why: "单字符省略号不是连续同类标点" },

  /* ---- 边界与口径形态：每条规则一条 ---- */
  { rule: "hygiene.cjk-latin-spacing", kind: "boundary", text: ["用 iPhone 拍的"], clean: CLEAN, expect: [], why: "iPhone 在白名单，整词不报" },
  { rule: "hygiene.punctuation-width", kind: "boundary", text: ["This is fine，really"], clean: CLEAN, expect: ["hygiene.punctuation-width"], why: "英文语境出现全角逗号（反向判定）" },
  { rule: "hygiene.trailing-punctuation", kind: "boundary", text: ["Sample text."], clean: CLEAN, expect: ["hygiene.trailing-punctuation"], why: "英文行尾 `.` 同样报" },
  { rule: "hygiene.unclosed-tag", kind: "boundary", text: ["<i><b>交叉</i></b>"], clean: CLEAN, expect: ["hygiene.unclosed-tag"], why: "交叉嵌套" },
  { rule: "hygiene.ass-override-residue", kind: "boundary", text: ["花开{未闭合"], clean: CLEAN, expect: ["hygiene.ass-override-residue"], why: "`{` 未闭合" },
  { rule: "hygiene.placeholder-residue", kind: "boundary", text: ["编号 {name} 未替换"], clean: CLEAN, expect: ["hygiene.placeholder-residue"], why: "多字母命名占位符报（仅单字母 {x} 豁免）" },
  { rule: "hygiene.font-tag-residue", kind: "boundary", text: ["<font size=12>小字</font>"], clean: CLEAN, expect: ["hygiene.font-tag-residue"], why: "<font size=...> 同样报" },
  { rule: "hygiene.sdh-marker", kind: "boundary", text: ["（掌声）他走过来了"], clean: CLEAN, expect: ["hygiene.sdh-marker"], why: "全角括号情绪标记在口径白名单词表内即报" },
  { rule: "hygiene.all-caps", kind: "boundary", text: ["ABCDEFGHIJKLMNOPQRST"], clean: CLEAN, expect: ["hygiene.all-caps"], why: "恰好 20 个半角大写（= 口径下限，达到即报）" },
  { rule: "hygiene.repeated-punctuation", kind: "boundary", text: ["真的吗？？？"], clean: CLEAN, expect: ["hygiene.repeated-punctuation"], why: "问号连续 3 次（= 口径下限，达到即报）" },
];

export function buildHygieneSamples() {
  const specs = CASES.map((c, k) => ({
    declaredIndex: k + 1,
    startMs: 1000 + k * 5000,
    endMs: 1000 + k * 5000 + 2000,
    text: c.text,
  }));
  const built = buildSrt(specs);
  const text = built.lines.join("\n") + "\n";
  for (const line of built.lines) assertClean(line, "hygiene-golden");

  const annotated = annotateSrtLines(built.lines);
  if (annotated.cues.length !== CASES.length) {
    throw new Error(`卫生 golden set cue 数 ${annotated.cues.length} ≠ ${CASES.length}`);
  }
  for (let k = 0; k < annotated.cues.length; k += 1) {
    annotated.cues[k].startMs = specs[k].startMs;
    annotated.cues[k].endMs = specs[k].endMs;
  }
  const lines = annotated.cues.map((c) => c.sourceLine);
  const oracle = runHygieneOracle(annotated.cues, lines);

  const mismatches = [];
  CASES.forEach((c, k) => {
    const actual = oracle.filter((f) => f.index === k + 1).map((f) => f.ruleId).sort();
    const expect = c.expect.slice().sort();
    if (JSON.stringify(actual) !== JSON.stringify(expect)) {
      mismatches.push(`#${k + 1} ${JSON.stringify(c.text)} [${c.rule}]：期望 [${expect}] 实算 [${actual}]`);
    }
  });
  if (mismatches.length) {
    throw new Error("卫生 golden set 标注与独立判定式不一致\n  " + mismatches.join("\n  "));
  }

  // 植入器自证：每处植入都要有非空 diff，且干净基线在独立判定式下不报该规则
  const planted = [];
  CASES.forEach((c, k) => {
    if (c.kind !== "pos") return;
    const id = `hygiene-${c.rule.split(".")[1]}-pos`;
    const p = plant(id, c.clean, c.text.join("\n"));
    const cleanCues = [{ textLines: c.clean.split("\n") }];
    const cleanHits = runHygieneOracle(cleanCues, [1]);
    if (cleanHits.some((f) => f.ruleId === c.rule)) {
      throw new Error(`${id}: 干净基线在独立判定式下仍然报 ${c.rule}`);
    }
    planted.push({ id, ruleId: c.rule, line: lines[k], diffNonEmpty: p.diffNonEmpty });
  });

  // 覆盖度硬门：每条规则 ≥1 正例、≥1 反例
  for (const rule of HYGIENE_RULES) {
    const pos = CASES.filter((c) => c.rule === rule && c.expect.includes(rule)).length;
    const neg = CASES.filter((c) => c.rule === rule && !c.expect.includes(rule)).length;
    if (pos < 1) throw new Error(`卫生规则无正例: ${rule}`);
    if (neg < 1) throw new Error(`卫生规则无反例: ${rule}`);
  }
  if (CASES.length !== 30) throw new Error(`卫生 golden set ${CASES.length} ≠ 30 条`);

  const truth = {
    sample: "hygiene/hygiene-golden.srt",
    domain: "hygiene",
    cueCount: CASES.length,
    lineConvention: "sourceLine（文本类 finding）",
    cues: CASES.map((c, k) => ({
      index: k + 1,
      line: lines[k],
      rule: c.rule,
      kind: c.kind,
      expectFindings: c.expect.slice().sort(),
      expectNoFindings: c.expect.length === 0 ? [{ ruleId: c.rule, why: c.why }] : [],
      why: c.why,
    })),
    expectFindings: oracle.map((f) => ({ ruleId: f.ruleId, line: f.line })),
    expectNoFindings: CASES.filter((c) => c.expect.length === 0).map((c, k) => ({
      ruleId: c.rule,
      why: c.why,
    })),
    planted,
  };

  return {
    id: "hygiene-golden",
    fileName: "hygiene-golden.srt",
    text,
    cueCount: CASES.length,
    truth,
  };
}

export { HYGIENE_RULES };
