/**
 * 编码嗅探与换行归一。
 * 顺序：BOM → UTF-8 严格 → GBK → UTF-8 替换（lossy）。
 * 回退必须显式上报（fallback / lossy），不得静默。
 */
SP.define("core/decode", [], function () {
  "use strict";

  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    throw new TypeError("输入必须是 Uint8Array / ArrayBuffer / TypedArray");
  }

  function tryDecode(bytes, encoding, fatal) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: Boolean(fatal) });
      return { ok: true, text: decoder.decode(bytes) };
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  }

  function detectEol(text) {
    let crlf = 0;
    let cr = 0;
    let lf = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text.charCodeAt(i);
      if (ch === 13) {
        if (text.charCodeAt(i + 1) === 10) {
          crlf += 1;
          i += 1;
        } else {
          cr += 1;
        }
      } else if (ch === 10) {
        lf += 1;
      }
    }
    const kinds = [crlf > 0, cr > 0, lf > 0].filter(Boolean).length;
    if (kinds === 0) return "lf";
    if (kinds > 1) return "mixed";
    if (crlf > 0) return "crlf";
    if (cr > 0) return "cr";
    return "lf";
  }

  function normalizeEol(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function stripBom(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { bom: "utf-8", bytes: bytes.subarray(3) };
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { bom: "utf-16le", bytes: bytes.subarray(2) };
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { bom: "utf-16be", bytes: bytes.subarray(2) };
    }
    return { bom: null, bytes };
  }

  /**
   * @returns {{text:string, encoding:string, bom:string|null, fallback:boolean,
   *            lossy:boolean, eol:string, diagnostics:Array}}
   */
  function decodeBytes(input) {
    const bytes = toBytes(input);
    const stripped = stripBom(bytes);
    const diagnostics = [];
    let encoding = "utf-8";
    let fallback = false;
    let lossy = false;
    let decoded = null;

    if (stripped.bom === "utf-8") {
      const attempt = tryDecode(stripped.bytes, "utf-8", true);
      if (attempt.ok) {
        decoded = attempt.text;
      } else {
        lossy = true;
        decoded = tryDecode(stripped.bytes, "utf-8", false).text;
        diagnostics.push({
          code: "decode.invalid-utf8",
          detail: "UTF-8 BOM 与内容不符，已按替换字符解码",
        });
      }
    } else if (stripped.bom === "utf-16le" || stripped.bom === "utf-16be") {
      encoding = stripped.bom;
      const attempt = tryDecode(stripped.bytes, encoding, true);
      if (attempt.ok) {
        decoded = attempt.text;
      } else {
        lossy = true;
        decoded = tryDecode(stripped.bytes, encoding, false).text;
        diagnostics.push({ code: "decode.invalid-utf16", detail: "UTF-16 内容解码失败，已降级" });
      }
    } else {
      const utf8 = tryDecode(bytes, "utf-8", true);
      if (utf8.ok) {
        decoded = utf8.text;
      } else {
        const gbk = tryDecode(bytes, "gbk", true);
        if (gbk.ok) {
          encoding = "gbk";
          fallback = true;
          decoded = gbk.text;
          diagnostics.push({
            code: "decode.gbk-fallback",
            detail: "非 UTF-8 字节，已回退 GBK 解码",
          });
        } else {
          lossy = true;
          decoded = tryDecode(bytes, "utf-8", false).text;
          diagnostics.push({
            code: "decode.lossy",
            detail: "UTF-8 与 GBK 均严格解码失败，已按替换字符解码",
          });
        }
      }
    }

    const eol = detectEol(decoded);
    if (eol === "mixed") {
      diagnostics.push({ code: "decode.mixed-eol", detail: "文件混用 CRLF/CR/LF，已统一为 LF" });
    }

    return {
      text: normalizeEol(decoded),
      encoding,
      bom: stripped.bom,
      fallback,
      lossy,
      eol,
      diagnostics,
    };
  }

  return { decodeBytes, detectEol, normalizeEol, stripBom };
});
