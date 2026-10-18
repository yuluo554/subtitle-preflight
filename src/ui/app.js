/**
 * 界面层（L3）：只消费 core/pipeline 的返回，不实现判定、不写阈值。
 */
SP.define("ui/app", ["core/pipeline"], function (pipeline) {
  "use strict";

  const state = {
    files: [],
    results: [],
    mediaDurationMs: null,
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
      const outcome = pipeline.run(merged, { mediaDurationMs: state.mediaDurationMs });
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
    $("skipped-block").hidden = seen.size === 0;
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

    $("export-json").addEventListener("click", exportJson);
    $("export-merged").addEventListener("click", exportMergedJson);

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
