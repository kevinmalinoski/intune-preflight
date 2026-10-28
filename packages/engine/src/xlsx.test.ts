import { describe, expect, it } from "vitest";
import { rowsToXlsx, XLSX_MIME } from "./xlsx.js";

/**
 * These tests unzip the bytes rather than snapshot them, because a snapshot
 * answers the wrong question. What matters is not that the output is the same
 * as last time -- it is that a ZIP reader can take it apart and find a
 * well-formed workbook inside, which is all Excel does before it decides to
 * show the "file is corrupted" dialog this export exists to eliminate. A
 * snapshot would happily pin a broken archive.
 *
 * The ZIP reading below is deliberately written from the format rather than
 * from the writer, and the CRC is recomputed with a different implementation
 * (bit-by-bit, no table) so that a wrong table in `xlsx.ts` cannot agree with
 * itself and pass.
 */

/** CRC-32 (IEEE 802.3), computed without a lookup table -- see above. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  path: string;
  text: string;
  /** The CRC the archive claims for this entry, from its local file header. */
  declaredCrc: number;
  /** The CRC the entry's actual bytes have. */
  actualCrc: number;
}

/**
 * Walks the local file headers and returns every stored entry. Only the STORE
 * method is handled, which is the method `rowsToXlsx` uses; anything else is a
 * failure rather than a fallback, since silently skipping entries would make
 * the assertions below vacuous.
 */
function unzip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let at = 0;
  while (at + 4 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    expect(method).toBe(0);
    const declaredCrc = view.getUint32(at + 14, true);
    const compressedSize = view.getUint32(at + 18, true);
    const uncompressedSize = view.getUint32(at + 22, true);
    expect(compressedSize).toBe(uncompressedSize);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const nameAt = at + 30;
    const dataAt = nameAt + nameLength + extraLength;
    const data = bytes.subarray(dataAt, dataAt + compressedSize);
    entries.push({
      path: decoder.decode(bytes.subarray(nameAt, nameAt + nameLength)),
      text: decoder.decode(data),
      declaredCrc,
      actualCrc: crc32(data),
    });
    at = dataAt + compressedSize;
  }
  return entries;
}

/** The end-of-central-directory record, read back from the tail of the archive. */
function endRecord(bytes: Uint8Array) {
  const at = bytes.length - 22;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(at, true)).toBe(0x06054b50);
  return {
    entries: view.getUint16(at + 10, true),
    centralSize: view.getUint32(at + 12, true),
    centralOffset: view.getUint32(at + 16, true),
  };
}

const HEADER = ["Setting", "Value", "Source Policy"];

describe("rowsToXlsx", () => {
  const rows = [HEADER, ["Require BitLocker", "enabled", "Windows — Encryption & Keys"]];
  const bytes = rowsToXlsx(rows, { sheetName: "Endpoint baseline" });
  const entries = unzip(bytes);
  const part = (path: string) => entries.find((e) => e.path === path);

  it("is a ZIP holding the five parts an xlsx is made of", () => {
    expect(entries.map((e) => e.path)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("declares a correct CRC32 for every part", () => {
    // A mismatch here is exactly what a reader reports as a damaged archive --
    // and what Excel reports as a corrupted file.
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry.declaredCrc).toBe(entry.actualCrc);
  });

  it("ends with a central directory covering every entry", () => {
    const end = endRecord(bytes);
    expect(end.entries).toBe(entries.length);
    expect(end.centralOffset + end.centralSize).toBe(bytes.length - 22);
    // The central directory starts where the last entry's data ended.
    expect(bytes.subarray(end.centralOffset, end.centralOffset + 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x01, 0x02]));
  });

  it("puts the rows in the sheet as inline strings", () => {
    const sheet = part("xl/worksheets/sheet1.xml")?.text ?? "";
    expect(sheet).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Setting</t></is></c>');
    expect(sheet).toContain(
      '<c r="C2" t="inlineStr"><is><t xml:space="preserve">Windows — Encryption &amp; Keys</t></is></c>'
    );
    expect(sheet).toContain('<dimension ref="A1:C2"/>');
  });

  it("names the sheet in the workbook part", () => {
    expect(part("xl/workbook.xml")?.text).toContain('name="Endpoint baseline"');
  });

  it("escapes the XML metacharacters a policy name can contain", () => {
    // A tenant really does hold names like this, and an unescaped `&` or `<` is
    // a malformed sheet -- which Excel reports as a corrupted file, the exact
    // symptom this export was added to remove.
    const sheet =
      part2(rowsToXlsx([HEADER, ["A & B <tag> \"quoted\" 'single'", "x", "y"]]), "xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain("A &amp; B &lt;tag&gt; &quot;quoted&quot; &apos;single&apos;");
    expect(sheet).not.toMatch(/<t xml:space="preserve">[^<]*[&][^a-z#]/);
  });

  it("drops control characters XML cannot represent at all", () => {
    // They cannot be escaped -- `&#1;` is as illegal as the raw byte -- so the
    // only safe thing is to leave them out.
    const sheet = part2(rowsToXlsx([["ok\u0001\u0007name"]]), "xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain(">okname<");
  });

  it("writes no cell for an empty value, so a blank stays blank", () => {
    const sheet = part2(rowsToXlsx([["a", "", "c"]]), "xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain('<row r="1">');
    expect(sheet).not.toContain('r="B1"');
    expect(sheet).toContain('r="C1"');
  });

  it("lettering runs past Z for a wide sheet", () => {
    const wide = Array.from({ length: 28 }, (_, i) => `c${i}`);
    const sheet = part2(rowsToXlsx([wide]), "xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain('r="Z1"');
    expect(sheet).toContain('r="AA1"');
    expect(sheet).toContain('<dimension ref="A1:AB1"/>');
  });

  it("strips the characters Excel refuses in a sheet name, and caps it at 31", () => {
    const workbook = part2(rowsToXlsx([["a"]], { sheetName: "Bad:/\\[]*?name" }), "xl/workbook.xml") ?? "";
    expect(workbook).toMatch(/name="Bad {7}name"/);
    const long = part2(rowsToXlsx([["a"]], { sheetName: "x".repeat(40) }), "xl/workbook.xml") ?? "";
    expect(long).toContain(`name="${"x".repeat(31)}"`);
  });

  it("serves under the media type Excel expects", () => {
    expect(XLSX_MIME).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });
});

describe("xlsx cells are typed, so nothing is reinterpreted", () => {
  // Half the reason for exporting xlsx at all. A CSV has to defend against this
  // by prefixing the value with a quote (see csvCell), which alters what the
  // admin reads; here the cell declares that it holds text and the value
  // arrives exactly as the tenant spells it.
  it("keeps a formula-shaped value as literal text", () => {
    const sheet = part2(rowsToXlsx([["=SUM(A1)", '=HYPERLINK("http://evil","x")']]), "xl/worksheets/sheet1.xml") ?? "";
    // Typed as a string, not as a formula: no <f> element anywhere.
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('t="inlineStr"');
    // And not quote-prefixed the way the CSV has to do it.
    expect(sheet).toContain(">=SUM(A1)<");
    expect(sheet).not.toContain(">'=SUM(A1)<");
  });

  it("keeps a date-shaped value as literal text", () => {
    const sheet = part2(rowsToXlsx([["2026-10-28", "1/2/2026"]]), "xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain(">2026-10-28<");
    expect(sheet).toContain(">1/2/2026<");
    // A date cell would be a numeric serial carrying a date style; a string
    // cell is neither, so no `t="n"` and no style index on any cell.
    expect(sheet).not.toContain('t="n"');
    expect(sheet).not.toMatch(/<c [^>]*\ss="/);
  });
});

/** The text of one part of a freshly produced workbook. */
function part2(bytes: Uint8Array, path: string): string | undefined {
  return unzip(bytes).find((e) => e.path === path)?.text;
}
