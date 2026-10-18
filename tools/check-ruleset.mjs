#!/usr/bin/env node
/**
 * 口径门：`data/README.md` §4（人类可读唯一定义处）↔ `data/ruleset.v1.json`（机器镜像）。
 *
 * 三件事：
 *  1. 双向键集相等——§4 有的键 ruleset 必须有，ruleset 有的键 §4 必须写（防第二份口径）。
 *  2. 逐值相等——按 §4 表格里的**原始文本**解析成值再比较，不在这里写任何阈值字面量。
 *  3. 区分性字面量扫描——`src/**` 不得出现阈值数字（单位换算常数与已登记的豁免除外）。
 *
 * 退出码：0 全绿 / 1 有 FAIL / 2 用法错误。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length) {
  process.stderr.write("用法: node tools/check-ruleset.mjs\n");
  process.exit(2);
}

const checks = [];
const add = (id, ok, detail) => checks.push({ id, ok, detail });
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);

const DOC = "data/README.md";
const MIRROR = "data/ruleset.v1.json";

/** §4 之外出现的口径键（ruleset 内部结构键），不要求 §4 表格有行。 */
const MIRROR_ONLY_KEYS = new Set();

/**
 * 值解析：只看 §4 表格里那一格的**原始文本**，不写任何阈值字面量。
 * 形态覆盖：`9` / `16 全角` / `800 ms` / `−30000 … +30000 ms` / `0.90 … 1.10` /
 *          `false（默认）` / `(line, ruleId)` / `见 ruleset 文件` / 自由文本。
 */
function parseCell(raw) {
  const text = String(raw).trim().replace(/^`(.*)`$/, "$1").trim();
  if (text === "") return { kind: "empty" };

  if (/^(true|false)\b/i.test(text)) {
    return { kind: "value", value: /^true/i.test(text) };
  }

  const list = text.match(/^\(([^)]+)\)$/);
  if (list) {
    return {
      kind: "value",
      value: list[1].split(",").map((s) => s.trim()).filter(Boolean),
    };
  }

  const range = text.match(/^(−|-|\+)?\s*([\d.]+)\s*(?:…|\.\.\.)\s*([+\-−])?\s*([\d.]+)/);
  if (range) {
    const low = Number((range[1] === "−" || range[1] === "-" ? -1 : 1) * Number(range[2]));
    const high = Number((range[3] === "-" || range[3] === "−" ? -1 : 1) * Number(range[4]));
    return { kind: "value", value: [low, high] };
  }

  const num = text.match(/^([+\-−]?[\d.]+)\s*(?:ms|全角|半角|半角字符)?\s*$/);
  if (num) {
    const value = Number(num[1].replace("−", "-"));
    return { kind: "value", value };
  }

  if (text.includes("ruleset")) return { kind: "delegated" };
  return { kind: "prose", value: text };
}

/** 从 §4 各小节的表格里抽出 `key → cell`。CPS 表按语言列取值。 */
function parseDoc() {
  const text = read(DOC);
  if (text === null) return null;
  const lines = text.split("\n");
  const entries = new Map();
  let section = "";

  for (const line of lines) {
    const heading = line.match(/^###\s*4\.(\d+)/);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells[0] 与末位是空串；键在 cells[1]
    const keyCell = cells[1] || "";
    const keyMatch = keyCell.match(/^`([^`]+)`$/);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    if (!key.includes(".")) continue;

    let cell = cells[2] || "";
    if (section === "2") {
      // 4.2 CPS 表：口径键 | 中文 | 英文 | 日文 | 说明
      if (key === "cps.zh") cell = cells[2];
      else if (key === "cps.en") cell = cells[3];
      else if (key === "cps.ja") cell = cells[4];
      else cell = cells[2];
    }
    entries.set(key, cell);
  }
  return entries;
}

function deepEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "number" && typeof b === "number") return Object.is(a, b) || Math.abs(a - b) < 1e-12;
  return a === b;
}

function checkMirror() {
  const mirrorText = read(MIRROR);
  if (mirrorText === null) {
    add("RULESET.MIRROR", false, `缺 ${MIRROR}`);
    return null;
  }
  let mirror;
  try {
    mirror = JSON.parse(mirrorText);
  } catch (error) {
    add("RULESET.MIRROR", false, `${MIRROR} 不是合法 JSON: ${error.message}`);
    return null;
  }
  const doc = parseDoc();
  if (doc === null) {
    add("RULESET.MIRROR", false, `缺 ${DOC}`);
    return null;
  }

  const mirrorKeys = Object.keys(mirror).filter((k) => !k.startsWith("$"));
  const docKeys = [...doc.keys()];
  const onlyDoc = docKeys.filter((k) => !mirrorKeys.includes(k));
  const onlyMirror = mirrorKeys.filter((k) => !docKeys.includes(k) && !MIRROR_ONLY_KEYS.has(k));

  add(
    "RULESET.KEYS",
    onlyDoc.length === 0 && onlyMirror.length === 0 && docKeys.length > 0,
    onlyDoc.length || onlyMirror.length
      ? `§4 独有: [${onlyDoc.join(", ")}]；ruleset 独有: [${onlyMirror.join(", ")}]`
      : `${docKeys.length} 个口径键双向一致`
  );

  const mismatches = [];
  let compared = 0;
  for (const [key, rawCell] of doc.entries()) {
    if (!(key in mirror)) continue;
    const parsed = parseCell(rawCell);
    if (parsed.kind !== "value") continue;
    compared += 1;
    if (!deepEqual(parsed.value, mirror[key])) {
      mismatches.push(`${key}: §4=${JSON.stringify(parsed.value)} vs ruleset=${JSON.stringify(mirror[key])}`);
    }
  }
  add(
    "RULESET.VALUES",
    mismatches.length === 0 && compared > 0,
    mismatches.length ? mismatches.join("；") : `${compared} 个口径值逐项相等`
  );

  const version = mirror["report.rulesetVersion"];
  const docVersion = doc.get("report.rulesetVersion");
  add(
    "RULESET.VERSION",
    typeof version === "number" && docVersion !== undefined && String(version) === String(parseCell(docVersion).value ?? ""),
    `rulesetVersion: ruleset=${version} / §4=${docVersion}`
  );

  return mirror;
}

/** 区分性字面量：这些值一旦出现在 src/ 就说明阈值被复制进了代码。 */
const DISTINCTIVE = [7000, 800, 42, 80, 30000, 0.00005, 0.001, 0.9, 1.1, 40, 20, 16, 17];

/** 已登记的豁免：文件 + 理由（必须具体，不许写"历史原因"）。 */
const LITERAL_EXEMPTIONS = [
  { file: "src/core/sha256.js", reason: "SHA-256 的循环位移位数与常量，不是口径阈值" },
];

function listJs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listJs(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

function checkLiterals() {
  const files = listJs(join(ROOT, "src"));
  const hits = [];
  let scanned = 0;
  for (const file of files) {
    const rel = relative(ROOT, file).split("\\").join("/");
    if (LITERAL_EXEMPTIONS.some((e) => e.file === rel)) continue;
    scanned += 1;
    const text = readFileSync(file, "utf8");
    for (const value of DISTINCTIVE) {
      const pattern = new RegExp(`(?<![\\w.\\-])${String(value).replace(".", "\\.")}(?![\\w.\\-])`, "g");
      const found = text.match(pattern);
      if (found) hits.push(`${rel}: ${value} ×${found.length}`);
    }
  }
  add(
    "RULESET.LITERALS",
    hits.length === 0 && scanned > 0,
    hits.length
      ? `源码里出现阈值字面量（应改读 ruleset）: ${hits.join("；")}`
      : `${scanned} 个源文件未出现区分性阈值字面量（豁免 ${LITERAL_EXEMPTIONS.length} 个并已登记理由）`
  );
}

function main() {
  try {
    checkMirror();
  } catch (error) {
    add("RULESET.MIRROR", false, "门内异常: " + error.message);
  }
  try {
    checkLiterals();
  } catch (error) {
    add("RULESET.LITERALS", false, "门内异常: " + error.message);
  }

  const failed = checks.filter((c) => !c.ok);
  process.stdout.write("口径门（§4 ↔ ruleset 镜像）\n");
  process.stdout.write("=".repeat(64) + "\n");
  for (const c of checks) process.stdout.write(`${c.ok ? "PASS" : "FAIL"}  ${c.id}  ${c.detail}\n`);
  process.stdout.write("=".repeat(64) + "\n");
  process.stdout.write(`结论: ${failed.length === 0 ? "全绿" : `${failed.length} 项 FAIL`}\n`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main();
