#!/usr/bin/env node
/**
 * 布局门（方法论装订的第②件）：把"项目还长在方法论上"变成可跑红的断言。
 *
 * 判据一律落**仓库内文件**（不读 git 元数据——浅克隆下 git tag / 历史深度会翻转）。
 * 纪律：
 *  - 非空跑自证：打印"这轮扫到了几个"。
 *  - 枚举式而非抽查式：状态副本由扫描命中驱动，并断言下界。
 *  - 超集宽容：只断言"必需节都在"，不断言节数恰好相等。
 *  - 永不崩：被检查对象不存在时报 FAIL 并继续。
 *
 * 退出码：0 全绿 / 1 有 FAIL / 2 用法错误。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length) {
  process.stderr.write("用法: node tools/check-sprint-layout.mjs\n");
  process.exit(2);
}

const checks = [];
const add = (id, ok, detail) => checks.push({ id, ok, detail });
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);

const scanned = { docs: 0, handoffs: 0, copies: 0, statusRows: 0 };

const REQUIRED_FILES = [
  "AGENTS.md",
  "README.md",
  "LICENSE",
  "package.json",
  "data/README.md",
  "data/ruleset.v1.json",
  "plan/00-README总览.md",
  "plan/01-题目文档.md",
  "plan/02-架构与技术选型.md",
  "plan/03-模块详设.md",
  "plan/04-数据计划.md",
  "plan/05-里程碑与发布.md",
  "plan/06-交付对标与决策.md",
  "tools/check-sprint-layout.mjs",
  "tools/check-ruleset.mjs",
  "tools/bundle.mjs",
  "tools/build.mjs",
];

/**
 * 装订行判据：三个锚点**必须同现于一行**（方法论名 + 布局门命令 + 装订日期）。
 * 用前瞻而不是 `A.*B.*C`：写死顺序会把合法写法判成缺。
 * 不用"或"关系：残句也会被判绿。
 */
const BINDING_LINE = /^>(?=.*ai-tool-project-sprint)(?=.*check-sprint-layout)(?=.*20\d{2}-\d{2}-\d{2}).*$/m;

const REQUIRED_SECTIONS = {
  "plan/00-README总览.md": ["文档索引", "决策记录", "承诺-证据台账", "里程碑"],
  "plan/01-题目文档.md": ["任务要求", "评分标准", "边界与非目标"],
  "plan/02-架构与技术选型.md": ["分层", "构建"],
  "plan/03-模块详设.md": ["时序体检", "可读性", "卫生"],
  "plan/04-数据计划.md": ["数据清单", "真值纪律", "数值口径"],
  "plan/05-里程碑与发布.md": ["DoD", "已知未验证项"],
  "plan/06-交付对标与决策.md": ["评分对标", "缺口表", "决策记录"],
  "data/README.md": ["依据查证记录", "数值口径"],
  "AGENTS.md": ["强制布局", "既定口径", "关键命令"],
};

const HANDOFF_SECTIONS = ["当前进度", "下一棒待办", "K 编号", "环境坑", "DoD", "命令速查"];

/** 项目**已声明**的豁免：M0 的收尾记录就是计划套件本身，不要求 HANDOFF-M0。 */
const EXEMPT_MILESTONES = [0];
/** 交接单格式冻结起点：从这一棒起六节齐必须成立（M1 之前是补记，允许节少）。 */
const HANDOFF_FORMAT_FROM = 1;

/** 状态副本：同一里程碑在这几处的状态必须**互相一致**。 */
const STATUS_COPIES = [
  { file: "plan/00-README总览.md", kind: "里程碑表" },
  { file: "plan/05-里程碑与发布.md", kind: "状态表" },
  { file: "README.md", kind: "状态表" },
];
const STATUS_COPIES_MIN = 3;

/** 只认"状态行"：表格行且首格就是里程碑号（不扫自由文本）。 */
const STATUS_LINE = /^\|\s*\*{0,2}M(\d+)\b/;
const PENDING_MARKERS = ["⬜", "🟡", "未开始", "未执行", "待执行", "待确认"];

function checkRequiredFiles() {
  const missing = REQUIRED_FILES.filter((rel) => !existsSync(join(ROOT, rel)));
  scanned.docs = REQUIRED_FILES.length - missing.length;
  add(
    "LAYOUT.FILES",
    missing.length === 0,
    missing.length ? `缺: ${missing.join(", ")}` : `${scanned.docs} 份必备文件齐备`
  );
}

function checkBindingHead() {
  const text = read("plan/00-README总览.md") ?? "";
  const ok = BINDING_LINE.test(text);
  add(
    "LAYOUT.BINDING_HEAD",
    ok,
    ok
      ? "plan/00 顶部有装订行（方法论名 + 布局门命令 + 日期 同现）"
      : "plan/00 顶部缺装订行（需同一行同现：ai-tool-project-sprint + check-sprint-layout + 日期）"
  );
}

function checkSections() {
  const bad = [];
  let checked = 0;
  for (const [rel, needles] of Object.entries(REQUIRED_SECTIONS)) {
    const text = read(rel);
    if (text === null) continue;
    checked += 1;
    const missing = needles.filter((n) => !text.includes(n));
    if (missing.length) bad.push(`${rel}: 缺 ${missing.join(" / ")}`);
  }
  add("LAYOUT.SECTIONS", bad.length === 0 && checked === Object.keys(REQUIRED_SECTIONS).length,
    bad.length ? bad.join("；") : `${checked} 份文档的必需小节齐备`);
}

/**
 * 逐副本采集状态：`Map<k, Set<"done"|"pending">>`。
 * **真值不取自任何一个副本**——以某个副本为真值会让它自己的漂移不可见（自我参照 → 恒真）。
 */
function collectStates() {
  const states = new Map();
  const perCopy = [];
  const note = (k, state) => {
    if (!states.has(k)) states.set(k, new Set());
    states.get(k).add(state);
  };
  for (const copy of STATUS_COPIES) {
    const text = read(copy.file);
    if (text === null) continue;
    scanned.copies += 1;
    let rows = 0;
    for (const line of text.split("\n")) {
      const m = STATUS_LINE.exec(line);
      if (!m) continue;
      rows += 1;
      scanned.statusRows += 1;
      const pending = PENDING_MARKERS.some((mark) => line.includes(mark));
      note(Number(m[1]), pending ? "pending" : "done");
    }
    perCopy.push({ file: copy.file, rows });
  }
  return { states, perCopy };
}

function checkStatusAgreement(collected) {
  const { states, perCopy } = collected;
  const conflicts = [];
  for (const [k, set] of [...states.entries()].sort((a, b) => a[0] - b[0])) {
    if (set.size > 1) conflicts.push(`M${k} 在副本间状态不一致（${[...set].join(" vs ")}）`);
  }
  if (scanned.copies < STATUS_COPIES_MIN) {
    conflicts.push(`只扫到 ${scanned.copies} 处状态副本（下界 ${STATUS_COPIES_MIN}）`);
  }
  // 非空跑自证：每处副本都必须真的贡献状态行，否则"副本存在但没有状态"会静默通过
  const emptyCopies = perCopy.filter((c) => c.rows === 0).map((c) => c.file);
  if (emptyCopies.length) {
    conflicts.push(`副本里没有状态行（等于没扫）: ${emptyCopies.join(", ")}`);
  }
  add(
    "LAYOUT.STATUS",
    conflicts.length === 0,
    conflicts.length
      ? conflicts.join("；")
      : `${scanned.copies} 处副本（${perCopy.map((c) => `${c.file.split("/").pop()}:${c.rows}行`).join(" / ")}） × ${states.size} 个里程碑 全一致`
  );
}

function checkHandoffs(states) {
  const done = [...states.entries()].filter(([, set]) => set.has("done")).map(([k]) => k).sort((a, b) => a - b);
  const pending = [...states.entries()].filter(([, set]) => set.has("pending")).map(([k]) => k).sort((a, b) => a - b);  const problems = [];
  const seen = new Set();

  for (const k of done) {
    if (EXEMPT_MILESTONES.includes(k)) continue;
    seen.add(k);
    const rel = `plan/HANDOFF-M${k}.md`;
    const text = read(rel);
    if (text === null) {
      problems.push(`${rel}(缺)`);
      continue;
    }
    if (k >= HANDOFF_FORMAT_FROM) {
      const lack = HANDOFF_SECTIONS.filter((n) => !text.includes(n));
      if (lack.length) problems.push(`${rel}(缺节: ${lack.join("/")})`);
    }
  }

  // 硬约束①：完成一棒必须在本对话内写完下一棒 HANDOFF
  if (pending.length) {
    const next = pending[0];
    const rel = `plan/HANDOFF-M${next}.md`;
    if (!existsSync(join(ROOT, rel))) {
      problems.push(`${rel}(下一棒待办的交接单未落盘)`);
    } else {
      seen.add(next);
    }
  }

  scanned.handoffs = seen.size;
  add(
    "LAYOUT.HANDOFFS",
    problems.length === 0,
    problems.length
      ? problems.join("；")
      : `${scanned.handoffs} 份交接单齐（M0 已声明豁免；已完成 ${done.length} / 待办 ${pending.length}）`
  );
}

/**
 * plan/06 的「缺口」列是状态的隐蔽副本。
 * **按表头定位列号再取单元格**，不是"行里含『缺口』二字"。
 * 文件里有多张含「缺口」列的表（评分对标表 + 缺口表），**逐张扫描**——
 * 只看第一张会漏掉真实故障（实测：首版只取第一张，变异后仍绿 = 假门）。
 */
function checkStaleGaps(states) {
  const done = [...states.entries()].filter(([, set]) => set.has("done")).map(([k]) => k);
  const lines = (read("plan/06-交付对标与决策.md") ?? "").split("\n");
  const stale = [];
  let tables = 0;
  let rows = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i];
    if (!header.startsWith("|") || !header.includes("缺口")) continue;
    const next = lines[i + 1] || "";
    if (!/^\|[\s:|-]+\|?$/.test(next)) continue; // 不是表头（缺分隔行）
    tables += 1;

    const headerCells = header.split("|").map((c) => c.trim());
    const col = headerCells.findIndex((c) => c.includes("缺口"));
    if (col < 1) {
      add("LAYOUT.GAPS", false, "plan/06 缺口表头列定位失败");
      return;
    }

    for (const line of lines.slice(i + 2)) {
      if (!line.startsWith("|")) break;
      rows += 1;
      const cells = line.split("|");
      const cell = (cells[col] ?? "").trim();
      for (const k of done) {
        if (new RegExp(`(^|[^0-9A-Za-z])M${k}([^0-9]|$)`).test(cell)) {
          stale.push(`plan/06 缺口列仍提 M${k}: ${cell}`);
        }
      }
    }
  }

  if (tables === 0) {
    add("LAYOUT.GAPS", false, "plan/06 找不到含『缺口』表头的表（判据表搬走了？）");
    return;
  }
  add(
    "LAYOUT.GAPS",
    stale.length === 0 && rows > 0,
    stale.length
      ? stale.join("；")
      : `${tables} 张缺口表 × ${rows} 行，无已 ✅ 里程碑`
  );
}

function checkReleaseDoc(states) {
  const done = [...states.entries()].filter(([, set]) => set.has("done")).map(([k]) => k);
  if (done.length === 0) {
    add("LAYOUT.RELEASE", true, "尚无 ✅ 里程碑，跳过");
    return;
  }
  const last = Math.max(...done);
  // 发布留档只在收尾里程碑（M6）✅ 后强制——M0–M5 期间不存在是正常状态，不是缺口
  if (last < 6) {
    add("LAYOUT.RELEASE", true, `收尾里程碑尚未 ✅（当前最高 ✅ = M${last}），发布留档按 M6 强制`);
    return;
  }
  const release = read(`plan/RELEASE-M${last}.md`);
  const wrapup = read(`plan/WRAPUP-M${last}.md`);
  if (!release && !wrapup) {
    add("LAYOUT.RELEASE", false, `缺 plan/RELEASE-M${last}.md 或 plan/WRAPUP-M${last}.md`);
    return;
  }
  if (release) {
    const cols = /^##\s*一、tag 前事实/m.test(release) && /^##\s*二、tag 后追加/m.test(release);
    const heading = /^#{2,3}.*覆盖对账/m.test(release);
    const rows = (release.match(/^\|.*(实现|不适用|待首推).*\|$/gm) ?? []).length;
    add("LAYOUT.RELEASE", cols && heading && rows >= 3,
      `两栏:${cols} 覆盖对账小节:${heading} 三态行数:${rows}`);
    return;
  }
  add("LAYOUT.RELEASE", true, "WRAPUP 形态");
}

/**
 * 测试清单门：`package.json` 的 test 脚本必须**逐文件列出** tests/**\/*.test.mjs，
 * 不多不少。Node 的目录形式在不同环境下会挂，逐文件列出是既定口径。
 */
function listTests() {
  const dir = join(ROOT, "tests");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => `tests/${name}`);
}

function checkTestManifest() {
  const text = read("package.json");
  if (text === null) {
    add("LAYOUT.TESTS", false, "缺 package.json");
    return;
  }
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch (error) {
    add("LAYOUT.TESTS", false, "package.json 不是合法 JSON: " + error.message);
    return;
  }
  const script = (pkg.scripts && pkg.scripts.test) || "";
  const actual = listTests();
  if (actual.length === 0) {
    add("LAYOUT.TESTS", false, "tests/ 下没有任何 *.test.mjs（空跑）");
    return;
  }
  const missing = actual.filter((rel) => !script.includes(rel));
  add(
    "LAYOUT.TESTS",
    missing.length === 0,
    missing.length
      ? `package.json 的 test 脚本漏列: ${missing.join(", ")}`
      : `${actual.length} 个测试文件全部逐项列入 test 脚本`
  );
}

function checkRulesetMirror() {
  const text = read("data/ruleset.v1.json");
  if (text === null) {
    add("LAYOUT.RULESET", false, "缺 data/ruleset.v1.json");
    return;
  }
  try {
    const ruleset = JSON.parse(text);
    const keys = Object.keys(ruleset).filter((k) => !k.startsWith("$"));
    const hasVersion = ruleset["report.rulesetVersion"] === 1;
    const hasSortKeys = Array.isArray(ruleset["report.sortKeys"]);
    add("LAYOUT.RULESET", keys.length >= 20 && hasVersion && hasSortKeys,
      `${keys.length} 个口径键，rulesetVersion=${ruleset["report.rulesetVersion"]}，sortKeys=${JSON.stringify(ruleset["report.sortKeys"])}`);
  } catch (error) {
    add("LAYOUT.RULESET", false, "ruleset 不是合法 JSON: " + error.message);
  }
}

function main() {
  const safe = (fn, id) => {
    try {
      fn();
    } catch (error) {
      add(id, false, "门内异常: " + error.message);
    }
  };

  safe(checkRequiredFiles, "LAYOUT.FILES");
  safe(checkBindingHead, "LAYOUT.BINDING_HEAD");
  safe(checkSections, "LAYOUT.SECTIONS");
  safe(checkRulesetMirror, "LAYOUT.RULESET");
  safe(checkTestManifest, "LAYOUT.TESTS");

  let collected = { states: new Map(), perCopy: [] };
  try {
    collected = collectStates();
  } catch (error) {
    add("LAYOUT.STATUS", false, "采集状态副本失败: " + error.message);
  }
  const states = collected.states;
  safe(() => checkStatusAgreement(collected), "LAYOUT.STATUS");
  safe(() => checkHandoffs(states), "LAYOUT.HANDOFFS");
  safe(() => checkStaleGaps(states), "LAYOUT.GAPS");
  safe(() => checkReleaseDoc(states), "LAYOUT.RELEASE");

  const failed = checks.filter((c) => !c.ok);
  process.stdout.write("布局门（方法论装订） · 判据只落仓库内文件\n");
  process.stdout.write("=".repeat(64) + "\n");
  for (const c of checks) process.stdout.write(`${c.ok ? "PASS" : "FAIL"}  ${c.id}  ${c.detail}\n`);
  process.stdout.write("=".repeat(64) + "\n");
  process.stdout.write(
    `这轮扫到：必备文件 ${scanned.docs} / 交接单 ${scanned.handoffs} / 状态副本 ${scanned.copies} / 状态行 ${scanned.statusRows}\n`
  );
  process.stdout.write(`结论: ${failed.length === 0 ? "全绿" : `${failed.length} 项 FAIL`}\n`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main();
