#!/usr/bin/env node
/**
 * 脱敏扫描（入仓可复跑工具）。三种模式 + 一组自检：
 *
 *   node tools/check-desensitize.mjs            # tracked：扫描已跟踪文本文件
 *   node tools/check-desensitize.mjs --history  # history：扫描全部历史提交里的 blob
 *   node tools/check-desensitize.mjs --messages # messages：提交元数据（作者/提交者邮箱、tag tagger）
 *   node tools/check-desensitize.mjs --selftest # 阳性对照：程序化合成的敏感串必须被抓到
 *
 * 纪律（照 sprint 阶段 7 脱敏条）：
 *  - **判据 token 一律运行时实算**，源码与留档里零词面：用户名取自 `os.userInfo()`，
 *    家目录模式由 `os.homedir()` 拼出，仓库根路径由 `import.meta.url` 实算。
 *    这样扫描器源码自身过 tracked 扫描也不会自命中。
 *  - **输出不回显敏感串原文**，只给「文件:行号 [类别]」——扫描报告因此可随仓留档。
 *  - **命中分级**：个人路径 / 用户名 / 真实邮箱 = HARD（exit 1）；
 *    其余（系统目录、占位路径）= REVIEW（打印供人工看，不阻断）。
 *  - **公开元数据豁免**：GitHub noreply 邮箱是发布固有公开元数据，不计命中。
 *
 * 退出码：0 无 HARD 命中 / 1 有 HARD 命中 / 2 用法错误 / 3 环境缺失（无 git 时 --history/--messages）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { userInfo, homedir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const MODES = ["--tracked", "--history", "--messages", "--selftest"];
const mode = args.length === 0 ? "--tracked" : args[0];
if (!MODES.includes(mode) || args.length > 1) {
  process.stderr.write("用法: node tools/check-desensitize.mjs [--tracked|--history|--messages|--selftest]\n");
  process.exit(2);
}

/* ---------------- token 实算（源码零词面） ---------------- */

function computeTokens() {
  const user = userInfo().username;
  const home = homedir();
  // 仓库盘符（形如 "D:"），家目录盘符（形如 "C:"）
  const repoDrive = ROOT.slice(0, 2);
  const homeDrive = home.slice(0, 2);
  // 家目录模式：把反斜杠/斜杠两种写法都算出来（不含用户名之外的字面量）
  const homePatterns = [
    home,
    home.split(sep).join("/"),
  ];
  // 用户名「词边界」形态：避免 midasuser / caucasus 之类子串误报
  const userPatterns = [
    new RegExp(`(?<![A-Za-z0-9])${escapeRe(user)}(?![A-Za-z0-9])`),
  ];
  return { user, home, homePatterns, userPatterns, repoDrive, homeDrive };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 敏感判据。**所有实算 token 由这里注入**，本文件源码里不出现任何具体值。 */
function buildCriteria(t) {
  return [
    // ---- HARD ----
    {
      id: "personal-home-path",
      level: "HARD",
      test: (text) => t.homePatterns.some((p) => text.includes(p)),
      why: "家目录绝对路径（含用户名）——组合路径签名，非裸词",
    },
    {
      id: "personal-email",
      level: "HARD",
      test: (text) => findPersonalEmails(text).length > 0,
      why: "非 noreply 的邮箱",
    },
    {
      id: "phone-cn",
      level: "HARD",
      test: (text) => /(?<!\d)1[3-9]\d{9}(?!\d)/.test(text),
      why: "中国大陆手机号",
    },
    {
      id: "id-card-cn",
      level: "HARD",
      test: (text) => /(?<!\d)\d{17}[\dXx](?!\d)/.test(text),
      why: "身份证号",
    },
    {
      id: "secret-assignment",
      level: "HARD",
      test: (text) => /(?<![A-Za-z0-9])(sk|ghp|gho|xox[baprs])[-_][A-Za-z0-9_-]{16,}/.test(text),
      why: "疑似密钥/令牌字面量",
    },
    // ---- REVIEW ----
    // 裸用户名**只作复核项**：该取值随构建环境变（CI runner 上是 `runner`/`root`），
    // 若也阻断会让同一仓库在不同 runner 上时红时绿（环境决定的假红）。
    // 真正的个人标记以**组合路径签名**（家目录路径）判定。
    {
      id: "bare-username",
      level: "REVIEW",
      test: (text) => t.userPatterns.some((re) => re.test(text)),
      why: "裸用户名（词边界；可能只是环境通用名，人工复核）",
    },
    {
      id: "other-drive-abs-path",
      level: "REVIEW",
      test: (text) => hasForeignAbsPath(text, t),
      why: "非本仓/本机盘符的绝对路径（可能只是系统目录，人工复核）",
    },
  ];
}

/** 只认「非 noreply」的邮箱：GitHub noreply 是发布固有公开元数据。 */
function findPersonalEmails(text) {
  const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const hits = [];
  let m;
  while ((m = re.exec(text))) {
    const addr = m[0].toLowerCase();
    if (addr.endsWith("@users.noreply.github.com")) continue;
    if (addr.endsWith("@example.com")) continue;
    if (addr.endsWith("@example.org")) continue;
    hits.push(addr);
  }
  return hits;
}

function hasForeignAbsPath(text, t) {
  const re = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/g;
  let m;
  while ((m = re.exec(text))) {
    const drive = text.slice(m.index, m.index + 2).toUpperCase();
    if (drive !== t.repoDrive.toUpperCase() && drive !== t.homeDrive.toUpperCase()) return true;
  }
  return false;
}

/* ---------------- 扫描面 ---------------- */

function isText(buffer) {
  // 与 `git grep -I` 同口径：含 NUL 字节的文件跳过（GBK/二进制样本）
  return !buffer.includes(0);
}

function listTracked() {
  const out = execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function scanText(label, text, criteria, report) {
  const lines = text.split(/\r?\n/);
  for (const c of criteria) {
    for (let i = 0; i < lines.length; i += 1) {
      if (c.test(lines[i])) report(c, label, i + 1);
    }
  }
}

function runTracked(criteria, report) {
  let scanned = 0;
  for (const rel of listTracked()) {
    const full = join(ROOT, rel);
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    const buf = readFileSync(full);
    if (!isText(buf)) continue;
    scanned += 1;
    scanText(rel, buf.toString("utf8"), criteria, report);
  }
  return scanned;
}

function runHistory(criteria, report) {
  let revs;
  try {
    revs = execFileSync("git", ["-C", ROOT, "rev-list", "--all"], { encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
  } catch (error) {
    process.stderr.write("SKIP 环境缺失：读不到 git 历史（" + error.message + "）\n");
    process.exit(3);
  }
  let scanned = 0;
  for (const rev of revs) {
    const names = execFileSync("git", ["-C", ROOT, "ls-tree", "-r", "--name-only", rev], { encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
    for (const name of names) {
      let buf;
      try {
        buf = execFileSync("git", ["-C", ROOT, "cat-file", "-p", `${rev}:${name}`], { maxBuffer: 64 * 1024 * 1024 });
      } catch { continue; }
      if (!isText(buf)) continue;
      scanned += 1;
      scanText(`${rev.slice(0, 7)}:${name}`, buf.toString("utf8"), criteria, report);
    }
  }
  return scanned;
}

function runMessages(criteria, report) {
  let log;
  try {
    log = execFileSync("git", ["-C", ROOT, "log", "--all", "--format=%H%n%an <%ae>%n%cn <%ce>%n%B%x00"], { encoding: "utf8" });
  } catch (error) {
    process.stderr.write("SKIP 环境缺失：读不到 git 元数据（" + error.message + "）\n");
    process.exit(3);
  }
  const entries = log.split("\x00").filter((s) => s.trim());
  for (const entry of entries) {
    const sha = entry.split("\n")[0];
    scanText(`commit ${sha.slice(0, 7)}`, entry, criteria, report);
  }
  // tag tagger 邮箱（annotated tag 才有）
  let tags = "";
  try {
    tags = execFileSync("git", ["-C", ROOT, "for-each-ref", "--format=%(refname:short) %(taggeremail)", "refs/tags"], { encoding: "utf8" });
  } catch { /* 无 tag */ }
  if (tags.trim()) scanText("refs/tags", tags, criteria, report);
  return entries.length;
}

/* ---------------- 输出（不回显敏感串原文） ---------------- */

function makeReport() {
  const rows = [];
  return {
    rows,
    report(criterion, label, line) {
      rows.push({ level: criterion.level, id: criterion.id, label, line });
    },
  };
}

function printReport(rep, scanned, modeLabel) {
  const hard = rep.rows.filter((r) => r.level === "HARD");
  const review = rep.rows.filter((r) => r.level === "REVIEW");
  process.stdout.write("脱敏扫描 · " + modeLabel + "\n");
  process.stdout.write("=".repeat(64) + "\n");
  for (const r of rep.rows) {
    process.stdout.write(`${r.level === "HARD" ? "HIT " : "REVIEW"}  ${r.label}:${r.line} [${r.id}]\n`);
  }
  if (!rep.rows.length) process.stdout.write("(无命中)\n");
  process.stdout.write("=".repeat(64) + "\n");
  process.stdout.write(`扫描面 ${scanned} 项；HARD ${hard.length} / REVIEW ${review.length}\n`);
  process.stdout.write(`结论: ${hard.length === 0 ? "无 HARD 命中" : `${hard.length} 项 HARD 命中`}\n`);
  return hard.length;
}

/* ---------------- 自检：阳性对照（程序化合成，无字面敏感串） ---------------- */

function runSelftest() {
  const t = computeTokens();
  const criteria = buildCriteria(t);
  const synth = {
    homePath: t.home,
    username: t.user,
    email: "nobody" + "@" + "private-mail.test",
    phone: "1" + "3900139000",
    idcard: "11010119900307" + "1234",
    secret: "gh" + "p_" + "A".repeat(24),
    noreply: "99999+someone" + "@users.noreply.github.com",
  };
  const cases = [
    ["personal-home-path", synth.homePath, true],
    ["bare-username", "见 " + synth.username + " 目录", true],
    ["bare-username", "x" + synth.username + "x", false], // 夹在字母数字里 = 非词边界，不算
    ["personal-email", "联系 " + synth.email, true],
    ["phone-cn", "电话 " + synth.phone, true],
    ["id-card-cn", "证件 " + synth.idcard, true],
    ["secret-assignment", "token=" + synth.secret, true],
    ["personal-email", synth.noreply, false], // noreply 豁免
    ["bare-username", "caucasus midasuser", false], // 子串不算（词边界）
  ];
  const results = [];
  for (const [id, text, expect] of cases) {
    const c = criteria.find((x) => x.id === id);
    const got = c.test(text);
    results.push({ id, level: c.level, expect, got, ok: got === expect });
  }
  process.stdout.write("脱敏扫描自检（阳性/阴性对照，合成串程序化生成）\n");
  process.stdout.write("=".repeat(64) + "\n");
  for (const r of results) {
    process.stdout.write(`${r.ok ? "PASS" : "FAIL"}  ${r.level}  ${r.id}  期望=${r.expect} 实得=${r.got}\n`);
  }
  process.stdout.write("=".repeat(64) + "\n");
  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write(`结论: ${failed === 0 ? "全绿" : `${failed} 项 FAIL`}\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

/* ---------------- main ---------------- */

function main() {
  if (mode === "--selftest") {
    runSelftest();
    return;
  }
  const t = computeTokens();
  const criteria = buildCriteria(t);
  const rep = makeReport();
  let scanned = 0;
  let label = "tracked（已跟踪文本文件）";
  if (mode === "--tracked") scanned = runTracked(criteria, rep.report);
  else if (mode === "--history") {
    label = "history（全部历史 blob）";
    scanned = runHistory(criteria, rep.report);
  } else {
    label = "messages（提交元数据 + tag tagger）";
    scanned = runMessages(criteria, rep.report);
  }
  const hard = printReport(rep, scanned, label);
  process.exitCode = hard === 0 ? 0 : 1;
}

main();
