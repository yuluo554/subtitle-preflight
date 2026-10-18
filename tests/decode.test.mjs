import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./helpers/load.mjs";

const SP = loadCore();
const decode = SP.get("core/decode");

function gbkBytes(text) {
  // 仅用于测试：手工编码少量常用汉字（避免依赖宿主是否带 gbk 编码器）
  const table = {
    你: [0xc4, 0xe3],
    好: [0xba, 0xc3],
    示: [0xca, 0xbe],
    例: [0xc0, 0xfd],
    字: [0xd7, 0xd6],
    幕: [0xc4, 0xbb],
  };
  const out = [];
  for (const ch of text) {
    const bytes = table[ch];
    if (!bytes) throw new Error("测试表里没有该字符: " + ch);
    out.push(...bytes);
  }
  return new Uint8Array(out);
}

test("解码：纯 ASCII 判为 utf-8，无回退", () => {
  const result = decode.decodeBytes(new TextEncoder().encode("hello"));
  assert.equal(result.encoding, "utf-8");
  assert.equal(result.fallback, false);
  assert.equal(result.lossy, false);
  assert.equal(result.bom, null);
});

test("解码：UTF-8 BOM 被剥离且上报", () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x62]);
  const result = decode.decodeBytes(bytes);
  assert.equal(result.bom, "utf-8");
  assert.equal(result.text, "ab");
  assert.equal(result.fallback, false);
});

test("解码：GBK 字节回退成功且显式标注", () => {
  const bytes = gbkBytes("你好");
  const result = decode.decodeBytes(bytes);
  assert.equal(result.encoding, "gbk");
  assert.equal(result.fallback, true);
  assert.equal(result.text, "你好");
  assert.ok(result.diagnostics.some((d) => d.code === "decode.gbk-fallback"));
});

test("解码：回退后中文逐字一致", () => {
  const original = "示例字幕";
  const result = decode.decodeBytes(gbkBytes(original));
  assert.equal(result.text, original);
});

test("解码：CRLF / CR / LF 都归一为 LF，且原形态被记录", () => {
  const crlf = decode.decodeBytes(new TextEncoder().encode("a\r\nb\r\n"));
  assert.equal(crlf.text, "a\nb\n");
  assert.equal(crlf.eol, "crlf");

  const cr = decode.decodeBytes(new TextEncoder().encode("a\rb\r"));
  assert.equal(cr.text, "a\nb\n");
  assert.equal(cr.eol, "cr");

  const lf = decode.decodeBytes(new TextEncoder().encode("a\nb\n"));
  assert.equal(lf.eol, "lf");
});

test("解码：混合换行被归一并产出诊断", () => {
  const result = decode.decodeBytes(new TextEncoder().encode("a\r\nb\nc\r"));
  assert.equal(result.text, "a\nb\nc\n");
  assert.equal(result.eol, "mixed");
  assert.ok(result.diagnostics.some((d) => d.code === "decode.mixed-eol"));
});

test("解码：换行归一不改变行数", () => {
  const before = "a\r\nb\rc\n";
  const result = decode.decodeBytes(new TextEncoder().encode(before));
  assert.equal(before.split(/\r\n|\r|\n/).length, result.text.split("\n").length);
});

test("解码：非字节输入抛 TypeError", () => {
  assert.throws(() => decode.decodeBytes("字符串不是字节"), TypeError);
});
