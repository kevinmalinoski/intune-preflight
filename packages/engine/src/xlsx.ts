/**
 * A minimal .xlsx writer: rows of strings in, the bytes of a one-sheet workbook
 * out.
 *
 * It exists because of the thing the CSV exports could not be fixed into being.
 * Excel for iPadOS refuses a .csv as corrupted however correct the file is --
 * ours is RFC-4180 quoted, BOM-prefixed, CRLF-separated, pure ASCII and
 * rectangular, and it still will not open, while a text editor on the same iPad
 * reads it perfectly. Microsoft's own compatibility table lists .csv on iOS as
 * read-only at best, and mobile Excel has no Text Import wizard: it cannot ask
 * anyone what the delimiter, the encoding or the column types are, so it
 * declines formats where those have to be inferred. An .xlsx declares all three
 * in a schema, which is why this is the remedy rather than more CSV work.
 *
 * It is a writer rather than a dependency because the format needed here is
 * small: an .xlsx is a ZIP of five tiny XML parts, and with the STORE method
 * (no compression) a ZIP is a CRC32 plus two header layouts. A library would
 * also have to be browser-safe, which brings us to the real constraint --
 *
 * everything here must run unchanged in Node and in the browser. This package
 * is the pure core the public demo bundles into a tab (`VITE_STATIC_DEMO=1`),
 * so there is no `Buffer`, no `zlib` and no `node:` anything below: just
 * `TextEncoder`, `DataView` and `Uint8Array`, all of which both runtimes have.
 * `purity.test.ts` and an ESLint rule hold that line.
 */

/** The media type of an .xlsx, as Excel and every other OOXML reader expects it. */
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const encoder = new TextEncoder();

/**
 * Characters XML 1.0 has no representation for at all -- the C0 controls except
 * tab, LF and CR. They cannot be escaped, only dropped: a numeric reference to
 * one (`&#1;`) is just as illegal as the raw byte. Graph should never hand us
 * one, but "should never" is exactly how a file ends up unopenable, and an
 * unopenable spreadsheet is the bug this module was written to remove.
 */
// The rule below assumes a control character in a pattern is a typo. Matching
// them is the entire job of this one.
// eslint-disable-next-line no-control-regex
const UNREPRESENTABLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/** Escapes a string for an XML text node or attribute value. */
function escapeXml(value: string): string {
  return value
    .replace(UNREPRESENTABLE, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** A zero-based column index as its spreadsheet letters: 0 -> A, 25 -> Z, 26 -> AA. */
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/**
 * The worksheet part.
 *
 * Every cell is `t="inlineStr"`, which is the whole point of exporting xlsx
 * rather than csv: the cell declares that it holds text, so Excel has nothing
 * left to guess. A policy named `=HYPERLINK("http://evil","x")` is text, and so
 * is a value like `2026-10-28` or `+1-555-0100` -- none of them become a
 * formula, a date or a number on the way in. The CSV exporter has to defend
 * against that with an OWASP `'` prefix (see `csvCell`), which visibly alters
 * the value; here the type does it, so values arrive exactly as the tenant
 * spells them.
 *
 * Strings are inline rather than pooled in a sharedStrings part. The pool wins
 * on repetition and costs a second part plus an indirection on every cell; at
 * the size of these reports -- thousands of rows, not millions -- it is not
 * worth the surface, and the bytes are stored uncompressed only until the ZIP
 * reader is done with them.
 *
 * An empty string gets no cell at all. A missing cell IS the blank cell in this
 * format, and an empty `<is><t/>` would make Excel show a cell containing an
 * empty string, which sorts and filters differently from a blank.
 */
function sheetXml(rows: string[][]): string {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  // `dimension` is advisory, but a wrong one misleads readers that trust it, so
  // it is computed rather than guessed. An empty sheet still has to name a cell.
  const dimension = rows.length > 0 && width > 0 ? `A1:${columnName(width - 1)}${rows.length}` : "A1";
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) =>
          value === ""
            ? ""
            : `<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
        )
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetData>${body}</sheetData>` +
    `</worksheet>`
  );
}

/**
 * A sheet name Excel will accept: at most 31 characters and none of `[ ] : * ? / \`.
 * Excel refuses to open a workbook that breaks either rule, so this is a
 * correctness guard and not tidying -- callers name sheets after reports, and a
 * report name is not under our control.
 */
function sheetName(raw: string): string {
  const cleaned = raw
    .replace(/[[\]:*?/\\]/g, " ")
    .trim()
    .slice(0, 31);
  return cleaned === "" ? "Sheet1" : cleaned;
}

function workbookXml(name: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${escapeXml(name)}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`
  );
}

const CONTENT_TYPES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml"` +
  ` ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml"` +
  ` ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `</Types>`;

const ROOT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1"` +
  ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"` +
  ` Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const WORKBOOK_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1"` +
  ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"` +
  ` Target="worksheets/sheet1.xml"/>` +
  `</Relationships>`;

/** The standard CRC-32 (IEEE 802.3) table, built once rather than written out. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * CRC-32 of `bytes`, as the ZIP format wants it.
 *
 * This is the one number in the file nothing else can stand in for: a reader
 * that finds a mismatch reports the archive as damaged, and in Excel that
 * surfaces as the same "file is corrupted" dialog this whole change exists to
 * get rid of. `xlsx.test.ts` recomputes it independently for every part.
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A fixed 1980-01-01 00:00 in the MS-DOS date/time the ZIP header carries.
 *
 * Deliberately not `new Date()`: the same rows then always produce the same
 * bytes, which is what lets a test assert on them and what keeps two builds of
 * the same report from differing. 1980 is the earliest the format can express,
 * and no reader does anything with it but show a modified date.
 */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

/** Bit 11 of the general-purpose flags: the filename is UTF-8, not CP437. */
const UTF8_FLAG = 0x0800;

/** No compression. An .xlsx may be stored, and storing is what keeps this file short. */
const METHOD_STORE = 0;

interface Part {
  /** The path inside the archive, e.g. `xl/worksheets/sheet1.xml`. */
  path: string;
  xml: string;
}

/**
 * Packs the parts into a ZIP archive, STORE method, no data descriptors and no
 * ZIP64: a local header per entry, then a central directory repeating them,
 * then the end-of-central-directory record pointing at it. Every multi-byte
 * field is little-endian, which is what the `DataView` calls below spell out.
 */
function zip(parts: Part[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const part of parts) {
    const name = encoder.encode(part.path);
    const data = encoder.encode(part.xml);
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); // local file header signature
    localView.setUint16(4, 20, true); // version needed to extract (2.0)
    localView.setUint16(6, UTF8_FLAG, true);
    localView.setUint16(8, METHOD_STORE, true);
    localView.setUint16(10, DOS_TIME, true);
    localView.setUint16(12, DOS_DATE, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true); // compressed size == stored size
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true); // no extra field
    local.set(name, 30);

    const entry = new Uint8Array(46 + name.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true); // central directory header signature
    entryView.setUint16(4, 20, true); // version made by
    entryView.setUint16(6, 20, true); // version needed to extract
    entryView.setUint16(8, UTF8_FLAG, true);
    entryView.setUint16(10, METHOD_STORE, true);
    entryView.setUint16(12, DOS_TIME, true);
    entryView.setUint16(14, DOS_DATE, true);
    entryView.setUint32(16, crc, true);
    entryView.setUint32(20, data.length, true);
    entryView.setUint32(24, data.length, true);
    entryView.setUint16(28, name.length, true);
    entryView.setUint16(30, 0, true); // extra field length
    entryView.setUint16(32, 0, true); // file comment length
    entryView.setUint16(34, 0, true); // disk number start
    entryView.setUint16(36, 0, true); // internal file attributes
    entryView.setUint32(38, 0, true); // external file attributes
    entryView.setUint32(42, offset, true); // where this entry's local header is
    entry.set(name, 46);

    chunks.push(local, data);
    central.push(entry);
    offset += local.length + data.length;
  }

  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); // end of central directory signature
  endView.setUint16(4, 0, true); // this disk
  endView.setUint16(6, 0, true); // disk with the central directory
  endView.setUint16(8, parts.length, true); // entries on this disk
  endView.setUint16(10, parts.length, true); // entries in total
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true); // central directory offset
  endView.setUint16(20, 0, true); // no archive comment

  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of all) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * Rows of strings as the bytes of a single-sheet .xlsx workbook.
 *
 * Takes exactly what `toCsv` takes -- the first row read as the header, every
 * cell a string -- so both exports of a report can be produced from one
 * row-builder and cannot disagree about content.
 */
export function rowsToXlsx(rows: string[][], options: { sheetName?: string } = {}): Uint8Array {
  return zip([
    { path: "[Content_Types].xml", xml: CONTENT_TYPES_XML },
    { path: "_rels/.rels", xml: ROOT_RELS_XML },
    { path: "xl/workbook.xml", xml: workbookXml(sheetName(options.sheetName ?? "Sheet1")) },
    { path: "xl/_rels/workbook.xml.rels", xml: WORKBOOK_RELS_XML },
    { path: "xl/worksheets/sheet1.xml", xml: sheetXml(rows) },
  ]);
}
