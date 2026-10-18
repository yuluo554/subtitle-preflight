#!/usr/bin/env node
/**
 * 样本与真值生成器（M1 数据先行）。
 *
 * 用法：
 *   node tools/gen-samples.mjs           写出 samples + truth（LF、按码点序、确定性）
 *   node tools/gen-samples.mjs --check   重新生成并与磁盘逐字节比较（不写盘）；报孤儿文件
 *   node tools/gen-samples.mjs --list    只打印将写出的文件清单
 *   node tools/gen-samples.mjs --perf    生成 10MB / 5000 cue 性能样本到 out/（不入仓）
 *
 * 纪律：
 *  - 阈值不在这里写死：全部从 `data/ruleset.v1.json` 读（K1）。
 *  - 标注器是**独立实现**（tools/samples/*oracle.mjs），不 import src/core；
 *    M2/M3 的实现与标注构成差分对照（plan/04 §三.2）。
 *  - 植入器自证：每处植入都断言"干净基线里没有这个缺陷"（diff 非空，plan/04 §三.7）。
 *  - 内容白名单：禁用词表命中即抛错；不复制任何真实字幕/剧本（版权红线）。
 *
 * 退出码：0 一致 / 1 有差异或孤儿 / 2 用法错误。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "./bundle.mjs";
import { sortByCodePoint, listFiles, relFromRoot } from "./samples/util.mjs";
import { selfCheckWhitelist } from "./samples/whitelist.mjs";
import { buildFormatSamples } from "./samples/format.mjs";
import { buildTimingSamples } from "./samples/timing.mjs";
import { buildReadabilitySamples } from "./samples/readability.mjs";
import { buildHygieneSamples } from "./samples/hygiene.mjs";
import { readRuleset } from "./samples/util.mjs";
import { READABILITY_RULES } from "./samples/readabilityoracle.mjs";
import { HYGIENE_RULES } from "./samples/hygieneoracle.mjs";
import { TIMING_CLASSES, CLASS_RULE } from "./samples/timingoracle.mjs";

const args = process.argv.slice(2);
const MODE = args.includes("--perf") ? "perf" : args.includes("--list") ? "list" : args.includes("--check") ? "check" : "write";
const unknown = args.filter((a) => !["--check", "--list", "--perf"].includes(a));
if (unknown.length) {
  process.stderr.write("用法: node tools/gen-samples.mjs [--check|--list|--perf]\n");
  process.exit(2);
}

/* ---------- 计划：relPath → Buffer ---------- */

function jsonBuffer(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
}

function buildPlan() {
  selfCheckWhitelist();
  const ruleset = readRuleset();
  const files = new Map(); // rel → Buffer
  const refs = []; // 人工可读的清单行

  /* ---- ① 格式变体：24 份 ---- */
  for (const sample of buildFormatSamples()) {
    files.set(`data/samples/format/${sample.fileName}`, sample.bytes);
    files.set(`data/truth/format/${sample.id}.json`, jsonBuffer(sample.truth));
    refs.push({
      domain: "format",
      sample: `format/${sample.fileName}`,
      truth: `format/${sample.id}.json`,
      format: sample.format,
      variant: sample.variant,
      encoding: sample.encoding,
      bytes: sample.bytes.length,
    });
  }

  /* ---- ② 时序：12 类 + 干净基线 ---- */
  const timingSamples = buildTimingSamples();
  const coveredTiming = new Set();
  for (const sample of timingSamples) {
    files.set(`data/samples/timing/${sample.fileName}`, Buffer.from(sample.text, "utf8"));
    files.set(`data/truth/timing/${sample.id}.json`, jsonBuffer(sample.truth));
    if (sample.ruleId) coveredTiming.add(sample.ruleId);
    refs.push({ domain: "timing", sample: `timing/${sample.fileName}`, truth: `timing/${sample.id}.json` });
  }
  const missingClasses = TIMING_CLASSES.filter((c) => !timingSamples.some((s) => s.cls === c));
  if (missingClasses.length) throw new Error("时序类别缺样本: " + missingClasses.join(", "));
  const missingRules = Object.values(CLASS_RULE).filter((r) => !coveredTiming.has(r));
  if (missingRules.length) throw new Error("时序规则缺正例样本: " + missingRules.join(", "));

  /* ---- ③ 可读性：200 条标注 ---- */
  const readability = buildReadabilitySamples();
  for (const sample of readability.samples) {
    files.set(`data/samples/readability/${sample.fileName}`, Buffer.from(sample.text, "utf8"));
    files.set(`data/truth/readability/${sample.id}.json`, jsonBuffer(sample.truth));
    refs.push({
      domain: "readability",
      sample: `readability/${sample.fileName}`,
      truth: `readability/${sample.id}.json`,
      cueCount: sample.cueCount,
    });
  }

  /* ---- ④ 卫生：30 条 golden set ---- */
  const hygiene = buildHygieneSamples();
  files.set(`data/samples/hygiene/${hygiene.fileName}`, Buffer.from(hygiene.text, "utf8"));
  files.set(`data/truth/hygiene/${hygiene.id}.json`, jsonBuffer(hygiene.truth));
  refs.push({
    domain: "hygiene",
    sample: `hygiene/${hygiene.fileName}`,
    truth: `hygiene/${hygiene.id}.json`,
    cueCount: hygiene.cueCount,
  });

  /* ---- ⑤ 覆盖度矩阵（口径键 → 样本） ---- */
  const coverage = buildCoverage({
    ruleset,
    timingSamples,
    readability,
    hygiene,
  });
  files.set("data/truth/coverage.json", jsonBuffer(coverage));

  return { files, refs, coverage };
}

function coverageEntry(ruleId, positives, negatives, extra) {
  const entry = {
    ruleDomain: ruleId.split(".")[0],
    ruleId,
    positiveSamples: sortByCodePoint(positives),
    negativeSamples: sortByCodePoint(negatives),
  };
  return Object.assign(entry, extra || {});
}

function buildCoverage({ ruleset, timingSamples, readability, hygiene }) {
  const timingRules = {};
  for (const [cls, ruleId] of Object.entries(CLASS_RULE)) timingRules[ruleId] = { cls };

  const timingList = Object.keys(timingRules).sort();
  const timingPos = new Map(timingList.map((r) => [r, []]));
  const timingNeg = new Map(timingList.map((r) => [r, []]));
  for (const sample of timingSamples) {
    if (sample.cls === "BASELINE") continue;
    for (const ruleId of timingList) {
      if (sample.ruleId === ruleId) timingPos.get(ruleId).push(`timing/${sample.id}`);
      else timingNeg.get(ruleId).push(`timing/${sample.id}`);
    }
  }
  const readRules = READABILITY_RULES.slice().sort();
  const readPos = new Map(readRules.map((r) => [r, []]));
  const readNeg = new Map(readRules.map((r) => [r, []]));
  for (const sample of readability.samples) {
    const byRule = new Map(readRules.map((r) => [r, 0]));
    for (const c of sample.truth.cues) {
      for (const ruleId of c.expectFindings) byRule.set(ruleId, byRule.get(ruleId) + 1);
    }
    for (const ruleId of readRules) {
      const n = byRule.get(ruleId);
      if (n > 0) readPos.get(ruleId).push(`readability/${sample.id}`);
      readNeg.get(ruleId).push(`readability/${sample.id}`);
    }
  }

  const hygRules = HYGIENE_RULES.slice().sort();
  const hygPos = new Map(hygRules.map((r) => [r, []]));
  const hygNeg = new Map(hygRules.map((r) => [r, []]));
  for (const c of hygiene.truth.cues) {
    if (c.expectFindings.includes(c.rule)) hygPos.get(c.rule).push(`hygiene/${hygiene.id}#cue${c.index}`);
    else hygNeg.get(c.rule).push(`hygiene/${hygiene.id}#cue${c.index}`);
  }

  const timing = timingList.map((r) =>
    coverageEntry(r, timingPos.get(r), timingNeg.get(r), {
      implements: "M3",
      validatedBy: "tools/samples/timingoracle.mjs",
      notes:
        r === "timing.fps-drift"
          ? "未实现（skipped，K7）；样本 t11-fps-drift.srt 已落库，M3 补齐拟合后转为检出"
          : "",
    })
  );
  const readabilityEntries = readRules.map((r) =>
    coverageEntry(r, readPos.get(r), readNeg.get(r), {
      implements: "M4",
      validatedBy: "tools/samples/readabilityoracle.mjs",
      notes: "",
    })
  );
  const hygieneEntries = hygRules.map((r) =>
    coverageEntry(r, hygPos.get(r), hygNeg.get(r), {
      implements: "M5",
      validatedBy: "tools/samples/hygieneoracle.mjs",
      notes: "反例引用为 cue 级（golden set#cueN）",
    })
  );

  return {
    note: "真值覆盖度矩阵（plan/04 §三.6）。positiveSamples 有正例；negativeSamples 有反例；任一规则无正例即视为覆盖不足。",
    rulesetVersion: ruleset["report.rulesetVersion"],
    domains: {
      timing: timing,
      readability: readabilityEntries,
      hygiene: hygieneEntries,
    },
    counts: {
      formatSamples: 24,
      timingSamples: timingSamples.length,
      readabilityCues: readability.totalCues,
      hygieneCues: hygiene.cueCount,
    },
  };
}

/* ---------- 写入 / 校验 ---------- */

function sortedEntries(files) {
  return sortByCodePoint([...files.keys()]).map((rel) => [rel, files.get(rel)]);
}

function targetPath(rel) {
  return join(ROOT, rel);
}

function writePlan(files) {
  let written = 0;
  for (const [rel, buf] of sortedEntries(files)) {
    const path = targetPath(rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buf);
    written += 1;
  }
  return written;
}

function checkPlan(files) {
  const problems = [];
  let compared = 0;
  for (const [rel, buf] of sortedEntries(files)) {
    const path = targetPath(rel);
    if (!existsSync(path)) {
      problems.push(`缺文件: ${rel}`);
      continue;
    }
    const disk = readFileSync(path);
    compared += 1;
    if (!disk.equals(buf)) {
      problems.push(
        `位级不一致: ${rel}（磁盘 ${disk.length} bytes vs 重生成 ${buf.length} bytes；` +
          `首个差异 @${firstDiff(disk, buf)}）`
      );
    }
  }
  // 孤儿：磁盘上存在、但不在计划里
  const planned = new Set(files.keys());
  for (const dir of ["data/samples", "data/truth"]) {
    for (const abs of listFiles(join(ROOT, dir))) {
      const rel = relFromRoot(abs);
      if (rel === "data/truth/README.md") continue; // 标注准则：人工维护
      if (!planned.has(rel)) problems.push(`孤儿文件（不在计划里）: ${rel}`);
    }
  }
  return { compared, problems };
}

function firstDiff(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) if (a[i] !== b[i]) return i;
  return len;
}

/* ---------- 性能样本（不入仓） ---------- */

function perfSample() {
  const targetCues = 5000;
  const targetBytes = 10 * 1024 * 1024;
  const charPool = "夜航灯塔浪风沙礁石帆船月潮汐港口码头灯影礁声船舷海雾桅杆星群示例剧角色甲";
  const perCueTextChars = Math.ceil((targetBytes / targetCues - 40) / 3); // UTF-8 中文 3 字节
  const perLine = 40;
  const lines = [];
  let cursor = 1000;
  for (let k = 1; k <= targetCues; k += 1) {
    lines.push(String(k));
    const start = cursor;
    const end = cursor + 2000;
    const fmt = (ms) => {
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      return (
        String(h).padStart(2, "0") +
        ":" +
        String(m).padStart(2, "0") +
        ":" +
        String(s).padStart(2, "0") +
        "," +
        String(ms % 1000).padStart(3, "0")
      );
    };
    lines.push(`${fmt(start)} --> ${fmt(end)}`);
    let made = 0;
    let lineBuf = "";
    while (made < perCueTextChars) {
      lineBuf += charPool[(k + made) % charPool.length];
      made += 1;
      if (lineBuf.length >= perLine) {
        lines.push(lineBuf);
        lineBuf = "";
      }
    }
    if (lineBuf) lines.push(lineBuf);
    lines.push("");
    cursor = end + 500;
  }
  const text = lines.join("\n") + "\n";
  const outDir = join(ROOT, "out");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "perf-10mb-5000cues.srt");
  writeFileSync(outPath, Buffer.from(text, "utf8"));
  return { outPath, bytes: Buffer.byteLength(text), cues: targetCues };
}

/* ---------- 主流程 ---------- */

try {
  if (MODE === "perf") {
    const info = perfSample();
    process.stdout.write(`已写出性能样本 out/perf-10mb-5000cues.srt（${info.bytes} bytes / ${info.cues} cue；不入仓）\n`);
    process.exit(0);
  }

  const { files, refs } = buildPlan();

  if (MODE === "list") {
    for (const [rel, buf] of sortedEntries(files)) {
      process.stdout.write(`${String(buf.length).padStart(9)}  ${rel}\n`);
    }
    process.stdout.write(`共 ${files.size} 个文件（样本 ${refs.length} 份，含真值与覆盖度矩阵）\n`);
    process.exit(0);
  }

  if (MODE === "check") {
    const { compared, problems } = checkPlan(files);
    process.stdout.write("样本与真值生成器 · --check（位级比较，不写盘）\n");
    process.stdout.write("=".repeat(64) + "\n");
    for (const p of problems) process.stdout.write(`FAIL  ${p}\n`);
    process.stdout.write("=".repeat(64) + "\n");
    process.stdout.write(`这轮比了 ${compared} / ${files.size} 个文件，样本 ${refs.length} 份\n`);
    process.stdout.write(`结论: ${problems.length === 0 ? "全绿（逐字节一致，无孤儿）" : `${problems.length} 项 FAIL`}\n`);
    process.exit(problems.length === 0 ? 0 : 1);
  }

  const written = writePlan(files);
  const byDomain = refs.reduce((acc, r) => {
    acc[r.domain] = (acc[r.domain] || 0) + 1;
    return acc;
  }, {});
  process.stdout.write("样本与真值生成器 · 写出\n");
  process.stdout.write("=".repeat(64) + "\n");
  process.stdout.write(`已写出 ${written} 个文件（按 Unicode 码点序；LF；无随机、无时钟）\n`);
  process.stdout.write(
    `样本：format ${byDomain.format || 0} / timing ${byDomain.timing || 0} / readability ${byDomain.readability || 0} / hygiene ${byDomain.hygiene || 0}\n`
  );
  process.stdout.write("结论: 全绿\n");
} catch (error) {
  process.stderr.write("生成失败: " + error.message + "\n");
  process.exit(1);
}
