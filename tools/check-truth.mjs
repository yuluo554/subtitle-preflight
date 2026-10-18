#!/usr/bin/env node
/**
 * 真值门：样本 ↔ 真值的一一对应、禁字段、覆盖度、内容白名单、行号可定位。
 *
 * 判据一律落**仓库内文件**；真值不取自单一副本——规则清单在两个独立来源里各写一份
 * （`data/truth/README.md` §3 的人类可读表 + 本文件的机器清单），二者不一致即报红。
 *
 * 退出码：0 全绿 / 1 有 FAIL / 2 用法错误。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length) {
  process.stderr.write("用法: node tools/check-truth.mjs\n");
  process.exit(2);
}

/* ---------- 本文件内置的机器清单（与 README §3 表互为独立来源） ---------- */

const INVENTORY = {
  timing: [
    "timing.overlap",
    "timing.zero-duration",
    "timing.negative-duration",
    "timing.gap-too-small",
    "timing.non-monotonic",
    "timing.duplicate-cue",
    "timing.negative-start",
    "timing.past-media-end",
    "timing.unparsable-timecode",
    "timing.file-order-mismatch",
    "timing.timecode-precision",
    "timing.fps-drift",
  ],
  readability: [
    "readability.cps",
    "readability.line-length",
    "readability.too-many-lines",
    "readability.too-few-chars",
    "readability.duration-short",
    "readability.duration-long",
    "readability.repeated-text",
  ],
  hygiene: [
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
  ],
};

/**
 * 8 类变体的**等价替换**（plan/04 §一 表）：
 * 序号缺失/跳号在 VTT 是「无 cue id / NOTE 块」、在 ASS 是「Format: 乱序 / Comment: 行」；
 * 逗号点号混用在 VTT 是「毫秒点号」、在 ASS 是「厘秒」。
 */
const FORMAT_VARIANTS = {
  srt: ["bom", "crlf", "missing-index", "jumped-index", "comma-dot", "gbk", "trailing-space", "blank-noise"],
  vtt: ["bom", "crlf", "no-cue-id", "note-block", "ms-dot", "gbk", "trailing-space", "blank-noise"],
  ass: ["bom", "crlf", "format-order", "comment-line", "centiseconds", "gbk", "trailing-space", "blank-noise"],
};
const FORMATS = ["srt", "vtt", "ass"];
const TIMING_CLASSES = ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10", "T11", "T12"];

const FORBIDDEN_KEYS = ["observed", "actual", "message"];
const EXPECTION_KEYS = new Set(["ruleId", "line", "field"]);

const BANNED = [
  "流浪地球", "三体", "甄嬛传", "琅琊榜", "知否", "庆余年", "陈情令",
  "权力的游戏", "绝命毒师", "怪奇物语", "老友记", "生活大爆炸",
  "Game of Thrones", "Breaking Bad", "Stranger Things", "The Office",
  "Friends", "The Matrix", "Inception", "Interstellar", "Pulp Fiction",
];

/* ---------- 工具 ---------- */

const checks = [];
const add = (id, ok, detail) => checks.push({ id, ok, detail });
const scanned = { samples: 0, truths: 0, findings: 0, cues: 0 };

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function rel(abs) {
  return relative(ROOT, abs).split("\\").join("/");
}

function decodeSample(truth) {
  const bytes = readFileSync(join(ROOT, "data/samples", truth.sample));
  const encoding = truth.encoding === "gbk" ? "gbk" : "utf-8";
  let text;
  try {
    text = new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch (error) {
    throw new Error(`样本 ${truth.sample} 无法按 ${encoding} 解码: ${error.message}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/* ---------- ① 一一对应（无孤儿） ---------- */

function loadAll() {
  const samples = walk(join(ROOT, "data/samples")).map(rel);
  const truths = walk(join(ROOT, "data/truth")).filter((p) => p.endsWith(".json")).map(rel);
  return { samples, truths };
}

function checkPairs(samples, truths) {
  // 派生/人工维护的非样本文件：coverage 矩阵与标注准则 README
  const NON_SAMPLE = new Set(["data/truth/coverage.json", "data/truth/README.md"]);
  const expectedTruth = samples.map((s) => {
    const m = /^data\/samples\/(.+)\.(srt|vtt|ass)$/.exec(s);
    return m ? `data/truth/${m[1]}.json` : null;
  });
  const effectiveTruths = truths.filter((t) => !NON_SAMPLE.has(t));
  const orphanTruth = effectiveTruths.filter((t) => !expectedTruth.includes(t));
  const missing = expectedTruth.filter((t) => t && !effectiveTruths.includes(t));
  const nonMapped = samples.filter((s) => !/^data\/samples\/.+\/(.+)\.(srt|vtt|ass)$/.test(s));
  add(
    "TRUTH.PAIRS",
    orphanTruth.length === 0 && missing.length === 0 && nonMapped.length === 0 && samples.length > 0,
    orphanTruth.length || missing.length || nonMapped.length
      ? `孤儿真值: [${orphanTruth.join(", ")}]；缺真值: [${missing.join(", ")}]；命名不符: [${nonMapped.join(", ")}]`
      : `${samples.length} 份样本 ↔ ${effectiveTruths.length} 份真值，一一对应`
  );
}

/* ---------- ② 禁字段 ---------- */

function deepFindForbidden(value, path, hits) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => deepFindForbidden(v, `${path}[${i}]`, hits));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.includes(k)) hits.push(`${path}.${k}`);
      deepFindForbidden(v, `${path}.${k}`, hits);
    }
  }
}

function checkNoObserved(truthFiles) {
  const hits = [];
  for (const { rel: r, data } of truthFiles) {
    const found = [];
    deepFindForbidden(data, r, found);
    hits.push(...found);
  }
  add("TRUTH.NO_OBSERVED", hits.length === 0, hits.length ? `真值里出现观测字段: ${hits.join(", ")}` : `无 observed/actual/message 字段（${truthFiles.length} 份）`);
}

/* ---------- ③ 期望项形态 + 域前缀 + 行号 ---------- */

function checkFindings(truthFiles) {
  const problems = [];
  let count = 0;
  for (const { rel: r, data, sampleLines } of truthFiles) {
    const domain = (data.sample || "").split("/")[0];
    for (const [key, list] of [
      ["expectFindings", data.expectFindings],
      ["expectNoFindings", data.expectNoFindings],
    ]) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        count += 1;
        for (const k of Object.keys(item)) {
          if (!EXPECTION_KEYS.has(k) && !(key === "expectNoFindings" && k === "why")) {
            problems.push(`${r}: ${key} 出现不该有的键 "${k}"`);
          }
        }
        if (typeof item.ruleId !== "string" || !item.ruleId.includes(".")) {
          problems.push(`${r}: ${key} 缺 ruleId`);
        }
        if (item.line !== undefined) {
          if (!Number.isInteger(item.line) || item.line < 1) problems.push(`${r}: ${key} line 非法 (${item.line})`);
          else if (sampleLines && item.line > sampleLines) {
            problems.push(`${r}: ${key} line=${item.line} 超出样本行数 ${sampleLines}`);
          }
        }
      }
    }
  }
  add("TRUTH.FINDINGS_SHAPE", problems.length === 0, problems.length ? problems.slice(0, 8).join("；") : `${count} 条期望项形态合法（只含 ruleId/line/field）`);
  scanned.findings = count;
}

/* ---------- ④ 覆盖度 ---------- */

function checkCoverage(truthFiles) {
  const problems = [];
  const byDomain = { format: 0, timing: 0, readability: 0, hygiene: 0 };
  const formatGrid = new Set();
  const timingClasses = new Set();
  const timingRulesPos = new Set();
  let readabilityCues = 0;
  let hygieneCues = 0;
  const readPos = new Map(INVENTORY.readability.map((r) => [r, 0]));
  const readNeg = new Map(INVENTORY.readability.map((r) => [r, 0]));
  const hygPos = new Map(INVENTORY.hygiene.map((r) => [r, 0]));
  const hygNeg = new Map(INVENTORY.hygiene.map((r) => [r, 0]));
  const timingPos = new Map(INVENTORY.timing.map((r) => [r, 0]));
  let mutations = 0;
  let baselines = 0;

  for (const { data } of truthFiles) {
    const domain = (data.sample || "").split("/")[0];
    if (!(domain in byDomain)) {
      problems.push(`${data.sample}: 未知域 ${domain}`);
      continue;
    }
    byDomain[domain] += 1;

    if (domain === "format") {
      formatGrid.add(`${data.format}/${data.variant}`);
      if (!Array.isArray(data.cues) || data.cues.length === 0) problems.push(`${data.sample}: cues 为空`);
      else {
        scanned.cues += data.cues.length;
        for (const cue of data.cues) {
          for (const key of ["index", "startMs", "endMs", "textLines", "sourceLine", "endLine", "textLineNumbers"]) {
            if (cue[key] === undefined) problems.push(`${data.sample}#cue${cue.index}: 缺字段 ${key}`);
          }
        }
      }
      // 植入器自证：每个变体都要有 diff 断言；变异类必须 diff 非空
      const plants = data.plants;
      if (!Array.isArray(plants) || plants.length === 0) {
        problems.push(`${data.sample}: 缺 plants 植入自证记录`);
      } else {
        for (const pl of plants) {
          if (pl.mode === "mutation") {
            mutations += 1;
            if (pl.diffNonEmpty !== true) problems.push(`${data.sample}: 变异类植入的 diffNonEmpty 不为 true`);
          } else if (pl.mode === "baseline") {
            baselines += 1;
          } else {
            problems.push(`${data.sample}: plants.mode 非法（${pl.mode}）`);
          }
        }
      }
    } else if (domain === "timing") {
      if (data.class) timingClasses.add(data.class);
      for (const f of data.expectFindings || []) {
        if ((f.ruleId || "").startsWith("timing.")) timingPos.set(f.ruleId, (timingPos.get(f.ruleId) || 0) + 1);
      }
      if (!Array.isArray(data.planted) && data.class !== "BASELINE") {
        problems.push(`${data.sample}: 缺 planted 自证记录`);
      }
    } else if (domain === "readability") {
      if (!Array.isArray(data.cues)) problems.push(`${data.sample}: 缺 cues`);
      else {
        readabilityCues += data.cues.length;
        scanned.cues += data.cues.length;
        if (data.cueCount !== data.cues.length) problems.push(`${data.sample}: cueCount ≠ cues.length`);
        for (const cue of data.cues) {
          const expect = cue.expectFindings || [];
          for (const r of INVENTORY.readability) {
            if (expect.includes(r)) readPos.set(r, readPos.get(r) + 1);
            else readNeg.set(r, readNeg.get(r) + 1);
          }
        }
        // 植入器自证：有正例的规则必须给出"干净孪生"证明
        const plantedRules = new Set((data.planted || []).map((pl) => pl.ruleId));
        if (!Array.isArray(data.planted) || data.planted.length === 0) {
          problems.push(`${data.sample}: 缺 planted 植入自证记录`);
        } else {
          let totalPlants = 0;
          for (const pl of data.planted) {
            totalPlants += 1;
            if (pl.diffNonEmpty !== true) problems.push(`${data.sample}: planted(${pl.ruleId}) 的 diffNonEmpty 不为 true`);
          }
          if (totalPlants < INVENTORY.readability.length) {
            problems.push(`${data.sample}: planted 只覆盖 ${totalPlants} 条规则（应 ≥ ${INVENTORY.readability.length}）`);
          }
        }
        for (const cue of data.cues) {
          for (const r of cue.expectFindings || []) {
            if (!plantedRules.has(r)) problems.push(`${data.sample}: 正例规则 ${r} 缺干净孪生证明`);
          }
        }
      }
    } else if (domain === "hygiene") {
      if (!Array.isArray(data.cues)) problems.push(`${data.sample}: 缺 cues`);
      else {
        hygieneCues += data.cues.length;
        scanned.cues += data.cues.length;
        for (const cue of data.cues) {
          const rule = cue.rule;
          if (!INVENTORY.hygiene.includes(rule)) problems.push(`${data.sample}#cue${cue.index}: 未知规则 ${rule}`);
          if ((cue.expectFindings || []).includes(rule)) hygPos.set(rule, hygPos.get(rule) + 1);
          else hygNeg.set(rule, hygNeg.get(rule) + 1);
        }
      }
    }
  }

  if (byDomain.format !== 24) problems.push(`格式样本 ${byDomain.format} 份 ≠ 24`);
  if (mutations < 20) problems.push(`格式变体的变异类植入只有 ${mutations} 处（下界 20，防"自证空跑"）`);
  if (baselines < 1) problems.push("格式变体里没有任何 baseline 声明（ASS 厘秒是基准形态，应显式声明）");
  for (const fmt of FORMATS) {
    for (const variant of FORMAT_VARIANTS[fmt]) {
      if (!formatGrid.has(`${fmt}/${variant}`)) problems.push(`格式矩阵缺格: ${fmt} × ${variant}`);
    }
  }
  const missingClasses = TIMING_CLASSES.filter((c) => !timingClasses.has(c));
  if (missingClasses.length) problems.push(`时序缺类: ${missingClasses.join(", ")}`);
  for (const r of INVENTORY.timing) {
    if ((timingPos.get(r) || 0) === 0) problems.push(`时序规则无正例: ${r}`);
  }
  if (readabilityCues !== 200) problems.push(`可读性标注 cue ${readabilityCues} 条 ≠ 200`);
  if (hygieneCues !== 30) problems.push(`卫生 golden set ${hygieneCues} 条 ≠ 30`);
  for (const r of INVENTORY.readability) {
    if (readPos.get(r) === 0) problems.push(`可读性规则无正例: ${r}`);
    if (readNeg.get(r) === 0) problems.push(`可读性规则无反例: ${r}`);
  }
  for (const r of INVENTORY.hygiene) {
    if (hygPos.get(r) === 0) problems.push(`卫生规则无正例: ${r}`);
    if (hygNeg.get(r) === 0) problems.push(`卫生规则无反例: ${r}`);
  }
  scanned.samples = byDomain.format + byDomain.timing + byDomain.readability + byDomain.hygiene;

  add(
    "TRUTH.COVERAGE",
    problems.length === 0,
    problems.length
      ? problems.slice(0, 8).join("；")
      : `格式 ${byDomain.format}（3×8 全格，变异 ${mutations} + 基准 ${baselines}）/ 时序 ${byDomain.timing}（12 类齐）/ 可读性 ${readabilityCues} 条 / 卫生 ${hygieneCues} 条`
  );
}

/* ---------- ⑤ 与 README §3 人类可读清单对账 ---------- */

function parseReadmeInventory() {
  const text = readFileSync(join(ROOT, "data/truth/README.md"), "utf8");
  const found = { timing: new Set(), readability: new Set(), hygiene: new Set() };
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const m = /^`((?:timing|readability|hygiene)\.[^`]+)`$/.exec(cells[1] || "");
    if (!m) continue;
    const key = m[1].split(".")[0];
    found[key].add(m[1]);
  }
  return found;
}

function checkInventory() {
  const problems = [];
  const readme = parseReadmeInventory();
  for (const domain of ["timing", "readability", "hygiene"]) {
    const expected = new Set(INVENTORY[domain]);
    const onlyCode = INVENTORY[domain].filter((r) => !readme[domain].has(r));
    const onlyDoc = [...readme[domain]].filter((r) => !expected.has(r));
    if (onlyCode.length) problems.push(`${domain}: 机器清单有而 README 缺 → ${onlyCode.join(", ")}`);
    if (onlyDoc.length) problems.push(`${domain}: README 有而机器清单缺 → ${onlyDoc.join(", ")}`);
  }
  add(
    "TRUTH.INVENTORY",
    problems.length === 0,
    problems.length
      ? problems.join("；")
      : `README §3 与机器清单逐项一致（timing ${INVENTORY.timing.length} / readability ${INVENTORY.readability.length} / hygiene ${INVENTORY.hygiene.length}）`
  );
}

/* ---------- ⑥ 内容白名单（禁用词表） ---------- */

function checkContent(texts) {
  const hits = [];
  for (const { rel: r, text } of texts) {
    for (const word of BANNED) {
      if (text.includes(word)) hits.push(`${r}: 命中禁用词 "${word}"`);
    }
  }
  add("TRUTH.CONTENT", hits.length === 0, hits.length ? hits.slice(0, 6).join("；") : `${texts.length} 份样本未命中禁用词表（${BANNED.length} 个词）`);
}

/* ---------- ⑦ 覆盖度矩阵 ↔ 真值 ---------- */

function checkCoverageMatrix(truthFiles) {
  const path = join(ROOT, "data/truth/coverage.json");
  if (!existsSync(path)) {
    add("TRUTH.MATRIX", false, "缺 data/truth/coverage.json（先跑 node tools/gen-samples.mjs）");
    return;
  }
  const matrix = JSON.parse(readFileSync(path, "utf8"));
  const problems = [];
  let entries = 0;
  for (const domain of ["timing", "readability", "hygiene"]) {
    const list = matrix.domains && matrix.domains[domain];
    if (!Array.isArray(list)) {
      problems.push(`矩阵缺域 ${domain}`);
      continue;
    }
    const ids = list.map((e) => e.ruleId).sort();
    const expected = INVENTORY[domain].slice().sort();
    if (JSON.stringify(ids) !== JSON.stringify(expected)) {
      problems.push(`${domain} 矩阵键与清单不一致`);
    }
    for (const entry of list) {
      entries += 1;
      if (!Array.isArray(entry.positiveSamples) || entry.positiveSamples.length === 0) {
        problems.push(`${entry.ruleId}: 矩阵里没有正例样本（任一规则无正例即覆盖不足）`);
      }
      if (entry.ruleId === "timing.fps-drift" && !String(entry.notes || "").includes("M3")) {
        problems.push("timing.fps-drift: 待实现规则必须在矩阵里写明 M3");
      }
    }
  }
  // 反向：矩阵引用的样本 id 必须真的存在
  const known = new Set();
  for (const { data } of truthFiles) {
    known.add((data.sample || "").replace(/\.(srt|vtt|ass)$/, ""));
  }
  for (const domain of ["timing", "readability", "hygiene"]) {
    for (const entry of (matrix.domains && matrix.domains[domain]) || []) {
      for (const ref of entry.positiveSamples) {
        const id = ref.split("#")[0];
        if (!known.has(id)) problems.push(`矩阵引用不存在的样本: ${ref}`);
      }
    }
  }
  add("TRUTH.MATRIX", problems.length === 0, problems.length ? problems.slice(0, 6).join("；") : `矩阵 ${entries} 条规则，引用样本全部存在`);
}

/* ---------- 主流程 ---------- */

try {
  const { samples, truths } = loadAll();
  checkPairs(samples, truths);

  const truthFiles = [];
  const texts = [];
  for (const r of truths) {
    const abs = join(ROOT, r);
    let data;
    try {
      data = JSON.parse(readFileSync(abs, "utf8"));
    } catch (error) {
      checks.push({ id: "TRUTH.PAIRS", ok: false, detail: `${r} 不是合法 JSON: ${error.message}` });
      continue;
    }
    let text = null;
    let sampleLines = null;
    if (data.sample && existsSync(join(ROOT, "data/samples", data.sample))) {
      text = decodeSample(data);
      sampleLines = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
      texts.push({ rel: r, text });
    } else if (data.sample) {
      checks.push({ id: "TRUTH.PAIRS", ok: false, detail: `${r} 指向不存在的样本 ${data.sample}` });
    }
    // 只有"样本真值"进入覆盖度统计；coverage.json 是派生矩阵，单独校验
    if (data.sample) truthFiles.push({ rel: r, data, sampleLines });
  }
  scanned.truths = truthFiles.length;

  checkNoObserved(truthFiles);
  checkFindings(truthFiles);
  checkCoverage(truthFiles);
  checkInventory();
  checkContent(texts);
  checkCoverageMatrix(truthFiles);
} catch (error) {
  add("TRUTH.RUNTIME", false, "门内异常: " + error.message);
}

const failed = checks.filter((c) => !c.ok);
process.stdout.write("真值门（样本 ↔ 真值 / 覆盖度 / 内容白名单）\n");
process.stdout.write("=".repeat(64) + "\n");
for (const c of checks) process.stdout.write(`${c.ok ? "PASS" : "FAIL"}  ${c.id}  ${c.detail}\n`);
process.stdout.write("=".repeat(64) + "\n");
process.stdout.write(
  `这轮扫到：样本 ${scanned.samples} / 真值 ${scanned.truths} / cue ${scanned.cues} / 期望项 ${scanned.findings}\n`
);
process.stdout.write(`结论: ${failed.length === 0 ? "全绿" : `${failed.length} 项 FAIL`}\n`);
process.exitCode = failed.length === 0 ? 0 : 1;
