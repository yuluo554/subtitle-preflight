/**
 * 界面层（L3）：只消费 core/pipeline 的返回，不实现判定、不写阈值。
 */
SP.define("ui/app", ["core/pipeline"], function (pipeline) {
  "use strict";

  const state = {
    files: [],
    results: [],
    mediaDurationMs: null,
    declaredFps: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function badge(text, tone) {
    return '<span class="badge badge-' + tone + '">' + escapeHtml(text) + "</span>";
  }

  function readFiles(fileList) {
    const list = Array.prototype.slice.call(fileList);
    return Promise.all(
      list.map(function (file) {
        return new Promise(function (resolve, reject) {
          const reader = new FileReader();
          reader.onload = function () {
            resolve({ name: file.name, bytes: new Uint8Array(reader.result) });
          };
          reader.onerror = function () {
            reject(new Error("读取失败: " + file.name));
          };
          reader.readAsArrayBuffer(file);
        });
      })
    );
  }

  function setStatus(text, tone) {
    const el = $("status");
    el.textContent = text;
    el.className = "status status-" + (tone || "idle");
  }

  function analyze(files) {
    if (!files.length) return;
    const merged = state.files.concat(files);
    state.files = merged;
    try {
      const outcome = pipeline.run(merged, {
        mediaDurationMs: state.mediaDurationMs,
        declaredFps: state.declaredFps,
      });
      state.results = outcome.results;
      render();
      setStatus("已体检 " + outcome.results.length + " 个文件", "ok");
    } catch (error) {
      setStatus("体检失败：" + error.message, "error");
    }
  }

  function render() {
    renderFiles();
    renderFindings();
    renderSkipped();
    renderFixes();
    renderWhitelist();
  }

  function renderFiles() {
    const body = $("file-rows");
    body.innerHTML = "";
    for (const result of state.results) {
      const file = result.file;
      const tr = document.createElement("tr");
      const badges = [];
      badges.push(badge(file.format.toUpperCase(), file.format === "unknown" ? "error" : "ok"));
      if (file.fallback) badges.push(badge("GBK 回退", "warn"));
      if (file.lossy) badges.push(badge("有损解码", "error"));
      if (file.bom) badges.push(badge("BOM " + file.bom, "muted"));
      if (file.eol === "mixed") badges.push(badge("混合换行", "warn"));
      tr.innerHTML =
        "<td>" + escapeHtml(file.name) + "</td>" +
        "<td>" + badges.join(" ") + "</td>" +
        "<td>" + escapeHtml(file.encoding) + "</td>" +
        "<td class=\"num\">" + file.cueCount + "</td>" +
        "<td class=\"num\">" + result.report.summary.total + "</td>";
      body.appendChild(tr);
    }
  }

  function renderFindings() {
    const body = $("finding-rows");
    body.innerHTML = "";
    const rows = [];
    state.results.forEach(function (result, fileIndex) {
      for (const finding of result.report.findings) {
        rows.push({ fileIndex: fileIndex, name: result.file.name, finding: finding });
      }
    });
    rows.sort(function (a, b) {
      if (a.fileIndex !== b.fileIndex) return a.fileIndex - b.fileIndex;
      if (a.finding.line !== b.finding.line) return a.finding.line - b.finding.line;
      return a.finding.ruleId < b.finding.ruleId ? -1 : 1;
    });

    $("finding-count").textContent = rows.length ? "共 " + rows.length + " 条" : "无违规";

    for (const row of rows) {
      const f = row.finding;
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + escapeHtml(row.name) + "</td>" +
        "<td class=\"num\"><a href=\"#\" data-line=\"" + f.line + "\">第 " + f.line + " 行</a></td>" +
        "<td><code>" + escapeHtml(f.ruleId) + "</code></td>" +
        "<td>" + badge(f.severity, f.severity === "error" ? "error" : "warn") + "</td>" +
        "<td>" + escapeHtml(f.expected) + "</td>" +
        "<td>" + escapeHtml(f.actual) + "</td>" +
        "<td>" + escapeHtml(f.message) + "</td>";
      body.appendChild(tr);
    }
  }

  function renderSkipped() {
    const list = $("skipped-list");
    list.innerHTML = "";
    const seen = new Set();
    for (const result of state.results) {
      for (const item of result.report.skipped) {
        const key = JSON.stringify(item);
        if (seen.has(key)) continue;
        seen.add(key);
        const li = document.createElement("li");
        li.textContent = item.ruleId || item.domain || item.format || item.kind;
        li.textContent += " — " + (item.reason || "unknown");
        list.appendChild(li);
      }
    }
    $("skipped-count").textContent = "（" + seen.size + "）";
    $("skipped-block").hidden = seen.size === 0;
    renderCapabilities();
  }

  /** 能力声明是数据结构，界面必须逐条摊开——"没写"和"没实现"一样不能被读成"通过"。 */
  function renderCapabilities() {
    const list = $("capabilities-list");
    list.innerHTML = "";
    const caps = state.results.length ? state.results[0].report.capabilities : {};
    const rows = [];
    for (const [key, value] of Object.entries(caps.parsers || {})) rows.push(["解析器 " + key, value]);
    for (const [key, value] of Object.entries(caps.rules || {})) rows.push(["规则 " + key, value]);
    for (const [key, value] of Object.entries(caps.exports || {})) rows.push(["导出 " + key, value]);
    rows.push(["修复", caps.fixes]);
    rows.push(["漂移拟合", caps.driftFit]);
    for (const [label, value] of rows) {
      const li = document.createElement("li");
      li.textContent = label + " — " + value;
      if (value !== "implemented") li.className = "cap-missing";
      list.appendChild(li);
    }
  }

  /** 已应用的修复：每条给出动作与前后值，修复不是黑盒。 */
  function renderFixes() {
    const list = $("fixes-list");
    list.innerHTML = "";
    let count = 0;
    for (const result of state.results) {
      for (const item of result.report.fixes) {
        count += 1;
        const li = document.createElement("li");
        li.textContent =
          result.file.name +
          " 第 " +
          (item.line === null ? "—" : item.line) +
          " 行 · " +
          item.action +
          "（" +
          item.before +
          " → " +
          item.after +
          "）";
        list.appendChild(li);
      }
    }
    $("fixes-count").textContent = "（" + count + "）";
    $("fixes-block").hidden = count === 0;
  }

  /** 白名单命中：被"放过"的内容必须能在界面看见（不得静默）。 */
  function renderWhitelist() {
    const list = $("whitelist-list");
    list.innerHTML = "";
    const totals = {};
    for (const result of state.results) {
      for (const [key, value] of Object.entries(result.report.summary.whitelist || {})) {
        totals[key] = (totals[key] || 0) + value;
      }
    }
    const keys = Object.keys(totals).sort();
    for (const key of keys) {
      const li = document.createElement("li");
      li.textContent = key + " ×" + totals[key];
      list.appendChild(li);
    }
    $("whitelist-count").textContent = "（" + keys.length + "）";
    $("whitelist-block").hidden = keys.length === 0;
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    if (!state.results.length) return;
    for (const result of state.results) {
      const base = result.file.name.replace(/\.[^.]+$/, "");
      download(base + ".report.json", result.json, "application/json;charset=utf-8");
    }
  }

  function exportMergedJson() {
    if (!state.results.length) return;
    const merged = {
      reports: state.results.map(function (result) {
        return result.report;
      }),
    };
    download("subtitle-preflight.report.json", JSON.stringify(merged, null, 2) + "\n", "application/json;charset=utf-8");
  }

  function exportMarkdown() {
    if (!state.results.length) return;
    for (const result of state.results) {
      const base = result.file.name.replace(/\.[^.]+$/, "");
      download(base + ".report.md", result.markdown, "text/markdown;charset=utf-8");
    }
  }

  function exportCsv() {
    if (!state.results.length) return;
    for (const result of state.results) {
      const base = result.file.name.replace(/\.[^.]+$/, "");
      download(base + ".report.csv", result.csv, "text/csv;charset=utf-8");
    }
  }

  /**
   * 修复后字幕：直接下载 pipeline 已经算好的文本（界面不重算、不改一个字）。
   * 文件名带 `.fixed` 后缀，避免覆盖原文件。
   */
  function exportFixed() {
    if (!state.results.length) return;
    for (const result of state.results) {
      const name = result.file.name;
      const dot = name.lastIndexOf(".");
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      download(base + ".fixed" + ext, result.fixedText, "text/plain;charset=utf-8");
    }
  }

  function bind() {
    const drop = $("drop");
    const input = $("file-input");

    ["dragenter", "dragover"].forEach(function (eventName) {
      drop.addEventListener(eventName, function (event) {
        event.preventDefault();
        drop.classList.add("over");
      });
    });
    ["dragleave", "drop"].forEach(function (eventName) {
      drop.addEventListener(eventName, function (event) {
        event.preventDefault();
        drop.classList.remove("over");
      });
    });
    drop.addEventListener("drop", function (event) {
      const files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) return;
      readFiles(files).then(analyze).catch(function (error) {
        setStatus(error.message, "error");
      });
    });

    input.addEventListener("change", function () {
      if (!input.files || !input.files.length) return;
      readFiles(input.files).then(analyze).catch(function (error) {
        setStatus(error.message, "error");
      });
      input.value = "";
    });

    $("analyze-paste").addEventListener("click", function () {
      const text = $("paste-input").value;
      if (!text.trim()) {
        setStatus("粘贴框是空的", "warn");
        return;
      }
      const bytes = new TextEncoder().encode(text);
      analyze([{ name: "pasted.srt", bytes: bytes }]);
    });

    $("media-duration").addEventListener("change", function (event) {
      const raw = event.target.value.trim();
      if (!raw) {
        state.mediaDurationMs = null;
        return;
      }
      const seconds = Number(raw);
      state.mediaDurationMs = isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
      if (state.files.length) analyze([]);
    });

    $("declared-fps").addEventListener("change", function (event) {
      const raw = event.target.value.trim();
      if (!raw) {
        state.declaredFps = null;
        return;
      }
      const fps = Number(raw);
      state.declaredFps = isFinite(fps) && fps > 0 ? fps : null;
      if (state.files.length) analyze([]);
    });

    $("export-json").addEventListener("click", exportJson);
    $("export-merged").addEventListener("click", exportMergedJson);
    $("export-markdown").addEventListener("click", exportMarkdown);
    $("export-csv").addEventListener("click", exportCsv);
    $("export-fixed").addEventListener("click", exportFixed);

    $("clear").addEventListener("click", function () {
      state.files = [];
      state.results = [];
      render();
      setStatus("已清空", "idle");
    });
  }

  function boot() {
    bind();
    setStatus("等待输入：拖入 .srt/.vtt/.ass，或粘贴文本", "idle");
  }

  return { boot, analyze, exportJson, exportMergedJson, state };
});
