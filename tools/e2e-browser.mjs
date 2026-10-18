#!/usr/bin/env node
/**
 * 浏览器 e2e（真实 Chrome/Edge，headless）：从**产物文件**打开，走一次"粘贴 → 解析 → 渲染"。
 *
 * 为什么需要它：Node 侧测试能证明 core 正确、产物同源，但证明不了"双击打开后界面真的接上了"。
 * 这条链路（DOM 事件 → FileReader/TextEncoder → pipeline → 渲染）只有真浏览器能看见。
 *
 * 用法：node tools/e2e-browser.mjs [--browser <path>]
 * 退出码：0 通过 / 1 断言失败 / 3 环境缺失（找不到浏览器或 CDP 连不上）
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, OUT } from "./bundle.mjs";

const args = process.argv.slice(2);
let browserPath = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--browser") browserPath = args[i + 1];
  else {
    process.stderr.write("用法: node tools/e2e-browser.mjs [--browser <path>]\n");
    process.exit(2);
  }
}

const CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const exe = browserPath || CANDIDATES.find((p) => existsSync(p));
if (!exe || !existsSync(exe)) {
  process.stderr.write(
    "SKIP 环境缺失：找不到 Chrome/Edge" + (browserPath ? "（--browser 指定的路径不存在）" : "") + "\n"
  );
  process.exit(3);
}

const artifact = join(ROOT, OUT);
if (!existsSync(artifact)) {
  process.stderr.write("FAIL 产物不存在: " + OUT + "（先跑 node tools/build.mjs）\n");
  process.exit(1);
}

const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), "sp-e2e-"));
const url = pathToFileURL(artifact).href;

const child = spawn(
  exe,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + profile,
    url,
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch("http://127.0.0.1:" + PORT + "/json/list");
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith("file:"));
      if (page && page.webSocketDebuggerUrl) return page;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  return null;
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (event) => reject(new Error("CDP 连接失败: " + event.message)));
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  return {
    ready,
    send(method, params) {
      const messageId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject });
        ws.send(JSON.stringify({ id: messageId, method, params: params || {} }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error("页面内异常: " + (result.exceptionDetails.exception?.description || result.exceptionDetails.text));
  }
  return result.result.value;
}

const SAMPLE = [
  "1",
  "00:00:01,000 --> 00:00:03,000",
  "第一行",
  "",
  "2",
  "00:00:02,000 --> 00:00:04,000",
  "重叠的一条",
  "",
].join("\n");

const checks = [];
const add = (id, ok, detail) => checks.push({ id, ok, detail });

try {
  const target = await findTarget();
  if (!target) {
    process.stderr.write("SKIP 环境缺失：CDP 端口未就绪（浏览器可能被策略禁用）\n");
    child.kill();
    rmSync(profile, { recursive: true, force: true });
    process.exit(3);
  }

  const client = cdp(target.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");

  // 等 boot() 完成
  let booted = false;
  for (let i = 0; i < 40; i += 1) {
    booted = await evaluate(client, 'document.getElementById("status").textContent.includes("等待输入")');
    if (booted) break;
    await sleep(150);
  }
  add("E2E.BOOT", booted === true, booted ? "boot() 执行后状态行已切换" : "boot() 未执行（状态行仍是初始化中）");

  const noNetwork = await evaluate(
    client,
    'performance.getEntriesByType("resource").filter(function (e) { return e.name.indexOf("file:") !== 0; }).length'
  );
  add("E2E.NO_NETWORK", noNetwork === 0, "非 file: 资源请求数 = " + noNetwork);

  const result = await evaluate(
    client,
    `(async function () {
      const ta = document.getElementById("paste-input");
      ta.value = ${JSON.stringify(SAMPLE)};
      document.getElementById("analyze-paste").click();
      await new Promise(function (r) { setTimeout(r, 300); });
      const rows = document.querySelectorAll("#finding-rows tr");
      const ruleCells = Array.prototype.map.call(rows, function (tr) { return tr.children[2].textContent.trim(); });
      const fileRows = document.querySelectorAll("#file-rows tr");
      return {
        status: document.getElementById("status").textContent,
        fileRows: fileRows.length,
        findingRows: rows.length,
        rules: ruleCells,
        countText: document.getElementById("finding-count").textContent,
        skippedShown: !document.getElementById("skipped-block").hidden,
        skippedItems: document.querySelectorAll("#skipped-list li").length
      };
    })()`
  );

  add("E2E.ANALYZE", result.fileRows === 1, "文件行数 = " + result.fileRows);
  add("E2E.FINDINGS", result.findingRows >= 1, "findings 行数 = " + result.findingRows + "（" + result.countText + "）");
  add(
    "E2E.OVERLAP_RULE",
    Array.isArray(result.rules) && result.rules.includes("timing.overlap"),
    "渲染出的规则: " + JSON.stringify(result.rules)
  );
  add(
    "E2E.SKIPPED_VISIBLE",
    result.skippedShown === true && result.skippedItems >= 3,
    "未执行检查区可见=" + result.skippedShown + "，条目=" + result.skippedItems
  );

  const exportWired = await evaluate(
    client,
    'document.getElementById("export-json").disabled === false && typeof URL.createObjectURL === "function"'
  );
  add("E2E.EXPORT_WIRED", exportWired === true, "导出按钮可用=" + exportWired);

  client.close();
} catch (error) {
  add("E2E.RUNTIME", false, "e2e 异常: " + error.message);
} finally {
  child.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.ok);
process.stdout.write("浏览器 e2e（headless，从产物文件打开）\n");
process.stdout.write("=".repeat(64) + "\n");
for (const c of checks) process.stdout.write(`${c.ok ? "PASS" : "FAIL"}  ${c.id}  ${c.detail}\n`);
process.stdout.write("=".repeat(64) + "\n");
process.stdout.write(`结论: ${failed.length === 0 ? "全绿" : `${failed.length} 项 FAIL`}\n`);
process.exitCode = failed.length === 0 ? 0 : 1;
