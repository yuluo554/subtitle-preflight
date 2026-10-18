#!/usr/bin/env node
/**
 * 构建入口。
 *   node tools/build.mjs          写出 dist/subtitle-preflight.html
 *   node tools/build.mjs --check  重新渲染并与磁盘产物逐字节比较（CI 用这条）
 * 退出码：0 成功/一致；1 不一致或自检失败；2 用法错误。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { OUT, ROOT, render } from "./bundle.mjs";

const args = process.argv.slice(2);
const check = args.includes("--check");
const unknown = args.filter((a) => a !== "--check");
if (unknown.length) {
  process.stderr.write("用法: node tools/build.mjs [--check]\n");
  process.exit(2);
}

const outPath = join(ROOT, OUT);

let html;
try {
  html = render();
} catch (error) {
  process.stderr.write("构建失败: " + error.message + "\n");
  process.exit(1);
}

const bytes = Buffer.byteLength(html, "utf8");

if (check) {
  if (!existsSync(outPath)) {
    process.stderr.write("FAIL 产物不存在: " + OUT + "（先跑 node tools/build.mjs）\n");
    process.exit(1);
  }
  const disk = readFileSync(outPath, "utf8");
  if (disk !== html) {
    process.stderr.write("FAIL 产物与源码不同基线: " + OUT + "（重新构建）\n");
    process.exit(1);
  }
  process.stdout.write("PASS 产物与源码同基线: " + OUT + "（" + bytes + " bytes）\n");
  process.exit(0);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, "utf8");
process.stdout.write("已写出 " + OUT + "（" + bytes + " bytes）\n");
