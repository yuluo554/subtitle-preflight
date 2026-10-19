import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, fileOf } from "./helpers/load.mjs";

const SP = loadCore();
const pipeline = SP.get("core/pipeline");
const fix = SP.get("core/fix");

/** 跑一次体检，返回该文件的报告与修复后文本。 */
function analyze(name, text, options) {
  return pipeline.run([fileOf(name, text)], options || {}).results[0];
}

/** 对修复后的文本再跑一次体检（同名文件，保证报告口径一致）。 */
function rerun(name, fixedText, options) {
  return analyze(name, fixedText, options);
}

/** 按规则统计违规数（只统计 timing./readability./hygiene. 三个规则域）。 */
function countByRule(result) {
  const counts = {};
  for (const f of result.report.findings) {
    if (!/^(timing|readability|hygiene)\./.test(f.ruleId)) continue;
    counts[f.ruleId] = (counts[f.ruleId] || 0) + 1;
  }
  return counts;
}

function ruleTotal(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/**
 * 可修样本：重叠 + 间隔过小 + 未闭合标签 + 行尾空白 + 序号跳号。
 * 每条缺陷都按白名单有对应动作。
 */
const FIXABLE = [
  "1",
  "00:00:01,000 --> 00:00:03,000",
  "<i>斜体没关  ",
  "",
  "2",
  "00:00:02,000 --> 00:00:04,000",
  "重叠的一条",
  "",
  "3",
  "00:00:04,050 --> 00:00:06,000",
  "间隔过小",
  "",
  "5",
  "00:00:07,000 --> 00:00:09,000",
  "序号跳号",
  "",
].join("\n");

/** 不可修样本：文本层面的缺陷不在修复白名单内（占位符 / ASS 覆写块 / 全大写 / SDH）。 */
const UNFIXABLE = [
  "1",
  "00:00:01,000 --> 00:00:03,000",
  "你好 %s 世界",
  "",
  "2",
  "00:00:04,000 --> 00:00:06,000",
  "{\\an8}顶部字幕",
  "",
  "3",
  "00:00:07,000 --> 00:00:09,000",
  "[music] 背景音乐",
  "",
  "4",
  "00:00:10,000 --> 00:00:12,000",
  "THIS IS A VERY LONG ALL CAPS LINE",
  "",
].join("\n");

/* ---------- 可修样本：违规数单调下降 ---------- */

test("可逆修复：可修样本上违规数单调下降（after < before，且每条规则不增加）", () => {
  const before = analyze("fixable.srt", FIXABLE);
  assert.ok(before.report.fixes.length >= 1, "可修样本却没有任何 fixes[]（修复白名单没接上）");

  const after = rerun("fixable.srt", before.fixedText);
  const beforeCounts = countByRule(before);
  const afterCounts = countByRule(after);

  // ① 总违规数严格下降
  assert.ok(
    ruleTotal(afterCounts) < ruleTotal(beforeCounts),
    `总违规数没有下降：${ruleTotal(beforeCounts)} → ${ruleTotal(afterCounts)}`
  );
  // ② 每条规则都不增加
  for (const ruleId of Object.keys(afterCounts)) {
    const b = beforeCounts[ruleId] || 0;
    assert.ok(afterCounts[ruleId] <= b, `${ruleId} 违规数增加了：${b} → ${afterCounts[ruleId]}`);
  }
  // ③ 每条 fixes[] 记录的规则确实被修掉了（不是"记了但没修"）
  for (const item of before.report.fixes) {
    if (!item.ruleId) continue; // 行尾空白 / 换行归一没有对应 ruleId
    if (item.ruleId.startsWith("parse.")) {
      // parse.* 是**诊断码**（K14），不是 finding：它不在 countByRule 里，
      // 因此要用诊断计数验"确实被修掉"，而不是用 finding 计数。
      const beforeDiag = before.report.diagnostics.filter((d) => d.code === item.ruleId).length;
      const afterDiag = after.report.diagnostics.filter((d) => d.code === item.ruleId).length;
      assert.ok(afterDiag < beforeDiag, `fixes[] 记了诊断 ${item.ruleId} 但诊断数没降：${beforeDiag} → ${afterDiag}`);
      continue;
    }
    assert.ok(
      (afterCounts[item.ruleId] || 0) < (beforeCounts[item.ruleId] || 0),
      `fixes[] 记了 ${item.ruleId} 但违规数没降`
    );
  }
  // ④ 具体：重叠 / 间隔 / 未闭合标签 / 行尾空白 都被处理
  const beforeRules = Object.keys(beforeCounts);
  assert.ok(beforeRules.includes("timing.overlap"), "可修样本应含重叠: " + beforeRules.join(", "));
  assert.ok(after.fixedText.includes("<i>斜体没关</i>"), "未闭合标签没有被补上");
  assert.equal(/[ \t]+\n/.test(after.fixedText), false, "行尾空白没被删干净");
});

test("可逆修复：修完之后重跑两次结果一致（修复是确定的）", () => {
  const before = analyze("fixable.srt", FIXABLE);
  const after1 = rerun("fixable.srt", before.fixedText);
  const after2 = rerun("fixable.srt", before.fixedText);
  assert.equal(after1.json, after2.json, "同一份修复后文本两次体检结果不一致");
  assert.equal(after1.fixedText, after2.fixedText, "二次修复产出了不同文本");
});

test("可逆修复：修复不改文本内容（只改时间码/标签/空白/序号）", () => {
  const before = analyze("fixable.srt", FIXABLE);
  const originalTexts = before.cues.map((c) => c.textLines.join("\n"));
  const after = rerun("fixable.srt", before.fixedText);
  const fixedTexts = after.cues.map((c) => c.textLines.join("\n"));
  // 逐条文本必须一致——不许改字、不许重排语序、不许合并拆分 cue。
  // 归一化掉**白名单内的**两处改动：行尾空白（§5.2 明列）与补上的闭合标签。
  assert.equal(after.cues.length, before.cues.length, "cue 数被改动");
  const normalize = (s) =>
    s
      .replace(/<\/?[ibu]\s*\/?>/gi, "")
      .replace(/[ \t]+$/gm, "");
  for (let i = 0; i < originalTexts.length; i += 1) {
    assert.equal(normalize(fixedTexts[i]), normalize(originalTexts[i]), `第 ${i + 1} 条文本被改动`);
  }
  // 白名单之外一个字都不许动：把两处白名单改动**还原**后，逐条文本必须逐字节相等
  for (let i = 0; i < originalTexts.length; i += 1) {
    const restored = fixedTexts[i]
      .replace(/<\/?[ibu]\s*\/?>/gi, "")
      .replace(/(\S)$/gm, "$1  ");
    const expect = originalTexts[i].replace(/<\/?[ibu]\s*\/?>/gi, "");
    if (/[ \t]+$/.test(originalTexts[i])) {
      assert.equal(restored, expect, `第 ${i + 1} 条除行尾空白外还有改动`);
    }
  }
});

test("可逆修复：时间码重写保留原行的分隔符与小数位数（不猜格式）", () => {
  assert.equal(fix.rewriteTimeLine("00:00:01,000 --> 00:00:03,000", 1000, 1920), "00:00:01,000 --> 00:00:01,920");
  assert.equal(fix.rewriteTimeLine("00:00:01.000 --> 00:00:03.000", 1000, 1920), "00:00:01.000 --> 00:00:01.920");
  // ASS 厘秒形态：小数位 2 位
  assert.equal(
    fix.rewriteTimeLine("Dialogue: 0,0:00:01.00,0:00:03.00,Default,hi", 1000, 1920),
    "Dialogue: 0,0:00:01.00,0:00:01.92,Default,hi"
  );
  // 找不到两个时间码 token → 不修（返回 null，不猜）
  assert.equal(fix.rewriteTimeLine("没有时间码的一行", 0, 1), null);
});

/* ---------- 不可修样本：after === before 且 fixes[] 为空 ---------- */

test("可逆修复：不可修样本 after === before 且 fixes[] 为空", () => {
  const before = analyze("unfixable.srt", UNFIXABLE);
  assert.ok(before.report.summary.total >= 4, "不可修样本应至少有 4 条 finding: " + before.report.summary.total);
  assert.deepEqual(before.report.fixes, [], "不可修样本不该产出任何 fixes[]: " + JSON.stringify(before.report.fixes));

  const after = rerun("unfixable.srt", before.fixedText);
  assert.equal(after.fixedText, before.fixedText, "不可修样本的文本被改动了");
  assert.deepEqual(countByRule(after), countByRule(before), "不可修样本的违规数变了");
  assert.equal(after.report.summary.total, before.report.summary.total);
});

test("可逆修复：不可修样本里确实有 finding（不是「没缺陷所以没得修」）", () => {
  const before = analyze("unfixable.srt", UNFIXABLE);
  const rules = Object.keys(countByRule(before));
  assert.ok(rules.includes("hygiene.placeholder-residue"), "缺占位符 finding: " + rules.join(", "));
  assert.ok(rules.includes("hygiene.ass-override-residue"));
  assert.ok(rules.includes("hygiene.sdh-marker"));
  assert.ok(rules.includes("hygiene.all-caps"));
});

/* ---------- 修复记录形态：报告可见、键序固定 ---------- */

test("可逆修复：fixes[] 记录进报告且形态固定（ruleId/line/action/before/after）", () => {
  const before = analyze("fixable.srt", FIXABLE);
  for (const item of before.report.fixes) {
    assert.deepEqual(Object.keys(item), ["ruleId", "line", "action", "before", "after"]);
    assert.ok(typeof item.action === "string" && item.action.length > 0);
    assert.ok(typeof item.before === "string");
    assert.ok(typeof item.after === "string");
    assert.notEqual(item.before, item.after, "fixes[] 记录了一条没产生变化的修复");
  }
  // 报告 JSON 里也必须有（不是只活在内存里）
  assert.equal(JSON.parse(before.json).fixes.length, before.report.fixes.length);
});

test("可逆修复：修复后的文本确实能被重新解析（产物可用，不是坏文件）", () => {
  const before = analyze("fixable.srt", FIXABLE);
  const after = rerun("fixable.srt", before.fixedText);
  assert.equal(after.file.format, "srt");
  assert.equal(after.file.cueCount, before.file.cueCount, "修复后 cue 数变了");
  assert.equal(after.report.diagnostics.filter((d) => d.code === "parse.unparsable-timecode").length, 0,
    "修复后出现了新的解析失败");
});

/* ---------- 护栏：修复不得引入新的 duration-short ---------- */

test("可逆修复：缩短时间码时以 duration.min 作护栏，不制造新的时长违规", () => {
  const before = analyze("fixable.srt", FIXABLE);
  const after = rerun("fixable.srt", before.fixedText);
  const beforeShort = (countByRule(before)["readability.duration-short"] || 0);
  const afterShort = (countByRule(after)["readability.duration-short"] || 0);
  assert.ok(afterShort <= beforeShort, `修复引入了新的 duration-short：${beforeShort} → ${afterShort}`);
});

/* ---------- 序号重编：仅 SRT，且只改序号行 ---------- */

test("可逆修复：序号重编只改序号行，不重排块（保守前提不满足就不修）", () => {
  // 时间顺序与文件顺序一致、只有序号跳号 → 只改数字
  const text = [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "第一条",
    "",
    "3",
    "00:00:04,000 --> 00:00:06,000",
    "第二条",
    "",
  ].join("\n");
  const before = analyze("renumber.srt", text);
  const renumber = before.report.fixes.filter((f) => f.action === "renumber-index");
  assert.equal(renumber.length, 1, "应有一条序号重编: " + JSON.stringify(before.report.fixes));
  assert.equal(renumber[0].line, 5);
  const after = rerun("renumber.srt", before.fixedText);
  assert.ok(after.fixedText.includes("\n2\n"), "序号没被改成 2: " + after.fixedText);
  assert.equal(after.report.diagnostics.filter((d) => d.code === "parse.index-mismatch").length, 0,
    "修复后仍有 index-mismatch");
});

test("可逆修复：缺序号行的样本不做序号重编（不凭空造序号）", () => {
  const text = [
    "00:00:01,000 --> 00:00:03,000",
    "第一条",
    "",
    "00:00:04,000 --> 00:00:06,000",
    "第二条",
    "",
  ].join("\n");
  const before = analyze("noindex.srt", text);
  assert.deepEqual(before.report.fixes.filter((f) => f.action === "renumber-index"), []);
});
