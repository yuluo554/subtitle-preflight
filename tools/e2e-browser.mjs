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
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, OUT } from "./bundle.mjs";

/**
 * 最小 WebSocket 客户端（仅用 node:net + node:crypto，零第三方依赖）。
 *
 * 为什么需要它：Node ≥ 22 才有全局 `WebSocket`；CI 矩阵含 Node 20，
 * 若直接用全局对象会在 Node 20 上抛 `WebSocket is not defined` → 假红。
 * 这里自带一条 CDP 够用的实现（握手 + 文本帧 + 分片 + ping/pong），
 * 让四矩阵在同一份代码上都能真跑 e2e。
 */
class MiniWebSocket {
  constructor(url) {
    this._url = new URL(url);
    this._handlers = { open: [], message: [], error: [], close: [] };
    this._buf = Buffer.alloc(0);
    this._handshaked = false;
    this._fragOpcode = 0;
    this._fragParts = [];
    this._closed = false;
    this._start();
  }

  addEventListener(type, fn) {
    (this._handlers[type] = this._handlers[type] || []).push(fn);
  }

  _emit(type, event) {
    for (const fn of this._handlers[type] || []) fn(event);
  }

  _start() {
    const key = randomBytes(16).toString("base64");
    const path = this._url.pathname + (this._url.search || "");
    const sock = netConnect({ host: this._url.hostname, port: Number(this._url.port || 80) });
    this._sock = sock;
    sock.on("connect", () => {
      sock.write(
        "GET " + path + " HTTP/1.1\r\n" +
          "Host: " + this._url.host + "\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: " + key + "\r\n" +
          "Sec-WebSocket-Version: 13\r\n\r\n"
      );
    });
    sock.on("data", (chunk) => this._onData(chunk));
    sock.on("error", (err) => this._emit("error", { message: err.message }));
    sock.on("close", () => this._emit("close", {}));
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    if (!this._handshaked) {
      const end = this._buf.indexOf("\r\n\r\n");
      if (end === -1) return;
      const head = this._buf.slice(0, end).toString("latin1");
      if (!/^HTTP\/1\.1 101/.test(head)) {
        this._emit("error", { message: "WebSocket 握手失败: " + head.split("\r\n")[0] });
        return;
      }
      this._buf = this._buf.slice(end + 4);
      this._handshaked = true;
      this._emit("open", {});
    }
    this._drainFrames();
  }

  _drainFrames() {
    while (this._buf.length >= 2) {
      const b0 = this._buf[0];
      const b1 = this._buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this._buf.length < offset + 2) return;
        len = this._buf.readUInt16BE(offset);
        offset += 2;
      } else if (len === 127) {
        if (this._buf.length < offset + 8) return;
        const hi = this._buf.readUInt32BE(offset);
        const lo = this._buf.readUInt32BE(offset + 4);
        len = hi * 4294967296 + lo;
        offset += 8;
      }
      let maskKey = null;
      if (masked) {
        if (this._buf.length < offset + 4) return;
        maskKey = this._buf.slice(offset, offset + 4);
        offset += 4;
      }
      if (this._buf.length < offset + len) return;
      let payload = this._buf.slice(offset, offset + len);
      this._buf = this._buf.slice(offset + len);
      if (maskKey) {
        const out = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i += 1) out[i] = payload[i] ^ maskKey[i % 4];
        payload = out;
      }
      this._handleFrame(fin, opcode, payload);
    }
  }

  _handleFrame(fin, opcode, payload) {
    if (opcode === 0x8) {
      this.close();
      return;
    }
    if (opcode === 0x9) {
      this._sendFrame(0xa, payload); // pong
      return;
    }
    if (opcode === 0xa) return; // pong
    if (opcode === 0x0) {
      this._fragParts.push(payload);
    } else {
      this._fragOpcode = opcode;
      this._fragParts = [payload];
    }
    if (!fin) return;
    const data = Buffer.concat(this._fragParts);
    this._fragParts = [];
    this._emit("message", { data: this._fragOpcode === 0x2 ? data : data.toString("utf8") });
  }

  _sendFrame(opcode, payload) {
    if (!this._sock || this._closed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeUInt32BE(Math.floor(len / 4294967296), 2);
      header.writeUInt32BE(len % 4294967296, 6);
    }
    header[0] = 0x80 | opcode;
    const maskKey = randomBytes(4);
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i += 1) masked[i] = payload[i] ^ maskKey[i % 4];
    this._sock.write(Buffer.concat([header, maskKey, masked]));
  }

  send(text) {
    this._sendFrame(0x1, Buffer.from(text, "utf8"));
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    try {
      this._sendFrame(0x8, Buffer.alloc(0));
    } catch { /* ignore */ }
    try {
      this._sock.end();
    } catch { /* ignore */ }
  }
}

/**
 * 跨 Node 版本取 WebSocket：优先用全局（Node ≥ 22），否则用自带的 MiniWebSocket。
 */
function resolveWebSocket() {
  return typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : MiniWebSocket;
}

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

/**
 * 清理临时 profile 目录：浏览器被 kill 后仍可能在写盘 → `rmdir` 会 ENOTEMPTY。
 * 处置 = 先等进程真的退出，再带重试地删；删不掉只告警**不影响结论**
 * （残留目录在系统临时区，不是产品缺陷）。
 */
async function cleanupProfile() {
  // 等子进程退出（最多 ~3s），避免"还在写盘就删"
  for (let i = 0; i < 30; i += 1) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    await sleep(100);
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch {
      await sleep(200);
    }
  }
  process.stderr.write("WARN 临时 profile 未清理干净（不影响结论）: " + profile + "\n");
}

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

function cdp(wsUrl, WebSocketImpl) {
  const ws = new WebSocketImpl(wsUrl);
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
  "用 iPhone 拍的",
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
    await cleanupProfile();
    process.exit(3);
  }

  // Node 20 没有全局 WebSocket（22 才加）→ 用自带的 MiniWebSocket（零依赖）
  const WebSocketImpl = resolveWebSocket();
  const client = cdp(target.webSocketDebuggerUrl, WebSocketImpl);
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
      const buttons = ["export-json", "export-merged", "export-markdown", "export-csv", "export-fixed"];
      return {
        status: document.getElementById("status").textContent,
        fileRows: fileRows.length,
        findingRows: rows.length,
        rules: ruleCells,
        countText: document.getElementById("finding-count").textContent,
        skippedShown: !document.getElementById("skipped-block").hidden,
        skippedItems: document.querySelectorAll("#skipped-list li").length,
        capabilityItems: document.querySelectorAll("#capabilities-list li").length,
        fixesShown: !document.getElementById("fixes-block").hidden,
        fixesItems: document.querySelectorAll("#fixes-list li").length,
        whitelistShown: !document.getElementById("whitelist-block").hidden,
        footerVersion: (document.querySelector(".foot .ver") || {}).textContent || "",
        buttonsEnabled: buttons.map(function (id) { return document.getElementById(id).disabled === false; }),
        buttonsPresent: buttons.every(function (id) { return document.getElementById(id) !== null; })
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
  add(
    "E2E.CAPABILITIES_VISIBLE",
    result.capabilityItems >= 11,
    "能力声明条目 = " + result.capabilityItems + "（应逐条摊开解析器/规则/导出/修复/漂移）"
  );
  add(
    "E2E.FIXES_VISIBLE",
    result.fixesShown === true && result.fixesItems >= 1,
    "修复区可见=" + result.fixesShown + "，条目=" + result.fixesItems
  );
  add(
    "E2E.WHITELIST_VISIBLE",
    result.whitelistShown === true,
    "白名单命中区可见=" + result.whitelistShown
  );
  add(
    "E2E.VERSION_VISIBLE",
    typeof result.footerVersion === "string" && result.footerVersion.indexOf("subtitle-preflight v") === 0,
    "页脚版本号 = " + JSON.stringify(result.footerVersion)
  );

  const exportWired = await evaluate(
    client,
    'document.getElementById("export-json").disabled === false && typeof URL.createObjectURL === "function"'
  );
  add("E2E.EXPORT_WIRED", exportWired === true, "导出按钮可用=" + exportWired);
  add(
    "E2E.EXPORT_BUTTONS_ENABLED",
    result.buttonsPresent === true && result.buttonsEnabled.every(Boolean),
    "MD/CSV/修复按钮全部可用=" + JSON.stringify(result.buttonsEnabled)
  );

  client.close();
} catch (error) {
  add("E2E.RUNTIME", false, "e2e 异常: " + error.message);
} finally {
  child.kill();
  await cleanupProfile();
}

const failed = checks.filter((c) => !c.ok);
process.stdout.write("浏览器 e2e（headless，从产物文件打开）\n");
process.stdout.write("=".repeat(64) + "\n");
for (const c of checks) process.stdout.write(`${c.ok ? "PASS" : "FAIL"}  ${c.id}  ${c.detail}\n`);
process.stdout.write("=".repeat(64) + "\n");
process.stdout.write(`结论: ${failed.length === 0 ? "全绿" : `${failed.length} 项 FAIL`}\n`);
process.exitCode = failed.length === 0 ? 0 : 1;
