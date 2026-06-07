import { strFromU8, unzipSync } from "fflate";

export type OfficeTextExtraction = {
  text: string;
  source: string;
};

const OFFICE_TEXT_LIMIT = 200_000;

export function isOpenXmlOfficeCandidate(filenameInput: string, contentTypeInput: string): boolean {
  const filename = filenameInput.toLowerCase();
  const contentType = contentTypeInput.toLowerCase();
  return (
    [".docx", ".wordx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"].some((extension) => filename.endsWith(extension)) ||
    contentType.includes("officedocument") ||
    contentType.includes("opendocument")
  );
}

export function isLegacyOfficeCandidate(filenameInput: string, contentTypeInput: string): boolean {
  const filename = filenameInput.toLowerCase();
  const contentType = contentTypeInput.toLowerCase();
  return (
    [".doc", ".word", ".xls", ".ppt"].some((extension) => filename.endsWith(extension)) ||
    contentType.includes("msword") ||
    contentType.includes("ms-excel") ||
    contentType.includes("ms-powerpoint")
  );
}

export function officeContentTypeForFilename(filenameInput: string, currentContentType: string | null): string | null {
  const current = currentContentType?.trim();
  if (current && current.toLowerCase() !== "application/octet-stream") return current;
  const filename = filenameInput.toLowerCase();
  if (filename.endsWith(".doc") || filename.endsWith(".word")) return "application/msword";
  if (filename.endsWith(".docx") || filename.endsWith(".wordx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (filename.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (filename.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (filename.endsWith(".xls")) return "application/vnd.ms-excel";
  if (filename.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (filename.endsWith(".odt")) return "application/vnd.oasis.opendocument.text";
  if (filename.endsWith(".ods")) return "application/vnd.oasis.opendocument.spreadsheet";
  if (filename.endsWith(".odp")) return "application/vnd.oasis.opendocument.presentation";
  return current || null;
}

export function extractOpenXmlOfficeText(bytes: ArrayBuffer): OfficeTextExtraction | null {
  const entries = unzipSync(new Uint8Array(bytes));
  const names = new Set(Object.keys(entries));

  if (names.has("word/document.xml")) {
    const text = extractDocxText(entries);
    return text ? { text, source: "office-ooxml-docx" } : null;
  }

  if (names.has("xl/workbook.xml") || Object.keys(entries).some((name) => name.startsWith("xl/worksheets/"))) {
    const text = extractXlsxText(entries);
    return text ? { text, source: "office-ooxml-xlsx" } : null;
  }

  if (names.has("ppt/presentation.xml") || Object.keys(entries).some((name) => name.startsWith("ppt/slides/"))) {
    const text = extractPptxText(entries);
    return text ? { text, source: "office-ooxml-pptx" } : null;
  }

  if (names.has("content.xml")) {
    const text = limitText(xmlTextContent(xmlEntry(entries, "content.xml")));
    return text ? { text, source: "opendocument-xml" } : null;
  }

  return null;
}

export function extractTextualLegacyOfficeText(bytes: ArrayBuffer): string | null {
  const data = new Uint8Array(bytes);
  if (!looksTextual(data)) return null;
  const text = decodeXmlBytes(data);
  const lower = text.slice(0, 2048).toLowerCase();
  if (!(lower.includes("<html") || lower.includes("<table") || lower.includes("<?xml") || lower.includes("<workbook"))) {
    return null;
  }
  return limitText(xmlTextContent(text));
}

function extractDocxText(entries: Record<string, Uint8Array>): string {
  const paths = Object.keys(entries)
    .filter((path) =>
      /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/i.test(path)
    )
    .sort((left, right) => {
      if (left === "word/document.xml") return -1;
      if (right === "word/document.xml") return 1;
      return left.localeCompare(right);
    });
  const lines: string[] = [];

  for (const path of paths) {
    const xml = xmlEntry(entries, path);
    for (const paragraph of xmlElements(xml, "p", 20_000)) {
      appendLine(lines, runText(paragraph.inner));
      if (joinedLength(lines) > OFFICE_TEXT_LIMIT) return limitText(lines.join("\n"));
    }
  }

  return limitText(lines.join("\n"));
}

function extractPptxText(entries: Record<string, Uint8Array>): string {
  const slidePaths = Object.keys(entries)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort(compareNumericPath);
  const lines: string[] = [];

  for (let index = 0; index < slidePaths.length; index += 1) {
    const xml = xmlEntry(entries, slidePaths[index]);
    const slideLines: string[] = [];
    for (const paragraph of xmlElements(xml, "p", 10_000)) {
      appendLine(slideLines, runText(paragraph.inner));
    }
    if (slideLines.length > 0) {
      lines.push(`Slide ${index + 1}`);
      lines.push(...slideLines);
      lines.push("");
    }
    if (joinedLength(lines) > OFFICE_TEXT_LIMIT) return limitText(lines.join("\n"));
  }

  return limitText(lines.join("\n"));
}

function extractXlsxText(entries: Record<string, Uint8Array>): string {
  const sharedStrings = parseSharedStrings(entries["xl/sharedStrings.xml"]);
  const sheetNames = parseWorkbookSheetNames(entries["xl/workbook.xml"]);
  const sheetPaths = Object.keys(entries)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort(compareNumericPath);
  const lines: string[] = [];

  for (let index = 0; index < sheetPaths.length; index += 1) {
    const xml = xmlEntry(entries, sheetPaths[index]);
    const rows = extractWorksheetRows(xml, sharedStrings);
    if (rows.length === 0) continue;
    lines.push(sheetNames[index] || `Sheet ${index + 1}`);
    lines.push(...rows);
    lines.push("");
    if (joinedLength(lines) > OFFICE_TEXT_LIMIT) return limitText(lines.join("\n"));
  }

  return limitText(lines.join("\n"));
}

function parseSharedStrings(entry: Uint8Array | undefined): string[] {
  if (!entry) return [];
  const xml = decodeXmlBytes(entry);
  return xmlElements(xml, "si", 100_000).map((item) => cleanLine(runText(item.inner)));
}

function parseWorkbookSheetNames(entry: Uint8Array | undefined): string[] {
  if (!entry) return [];
  const xml = decodeXmlBytes(entry);
  return xmlElements(xml, "sheet", 2_000)
    .map((item) => xmlAttribute(item.attributes, "name"))
    .filter((name): name is string => Boolean(name));
}

function extractWorksheetRows(xml: string, sharedStrings: string[]): string[] {
  const rows: string[] = [];
  for (const row of xmlElements(xml, "row", 50_000)) {
    const values = xmlElements(row.inner, "c", 50_000)
      .map((cell) => worksheetCellText(cell, sharedStrings))
      .filter((value) => value.length > 0);
    if (values.length > 0) rows.push(values.join("\t"));
    if (joinedLength(rows) > OFFICE_TEXT_LIMIT) break;
  }
  return rows;
}

function worksheetCellText(cell: XmlElement, sharedStrings: string[]): string {
  const type = xmlAttribute(cell.attributes, "t");
  if (type === "s") {
    const index = Number(firstElementText(cell.inner, "v"));
    return Number.isFinite(index) ? sharedStrings[index] ?? "" : "";
  }
  if (type === "inlineStr") {
    return cleanLine(runText(cell.inner));
  }
  return cleanLine(firstElementText(cell.inner, "v") || runText(cell.inner));
}

function runText(xml: string): string {
  let output = "";
  let index = 0;

  while (index < xml.length) {
    const tag = nextXmlTag(xml, index);
    if (!tag) break;
    if (tag.localName === "t" && !tag.closing && !tag.selfClosing) {
      const close = xml.indexOf(`</${tag.name}>`, tag.end + 1);
      if (close === -1) {
        index = tag.end + 1;
        continue;
      }
      output += decodeXmlEntities(xmlTextContent(xml.slice(tag.end + 1, close)));
      index = close + tag.name.length + 3;
      continue;
    }
    if (!tag.closing && (tag.localName === "tab" || tag.localName === "br" || tag.localName === "cr")) {
      output += tag.localName === "tab" ? "\t" : "\n";
    }
    index = tag.end + 1;
  }

  return output;
}

function xmlTextContent(xml: string): string {
  let output = "";
  let index = 0;

  while (index < xml.length) {
    const start = xml.indexOf("<", index);
    if (start === -1) {
      output += xml.slice(index);
      break;
    }
    output += xml.slice(index, start);
    const tag = parseXmlTag(xml, start);
    if (!tag) {
      index = start + 1;
      continue;
    }
    if (tag.localName === "tab") output += "\t";
    if (tag.localName === "br" || tag.localName === "cr" || (tag.closing && ["p", "h", "row", "tr"].includes(tag.localName))) {
      output += "\n";
    }
    index = tag.end + 1;
  }

  return decodeXmlEntities(output);
}

type XmlElement = {
  name: string;
  localName: string;
  attributes: string;
  inner: string;
};

type XmlTag = {
  name: string;
  localName: string;
  attributes: string;
  closing: boolean;
  selfClosing: boolean;
  start: number;
  end: number;
};

function xmlElements(xml: string, localName: string, limit: number): XmlElement[] {
  const elements: XmlElement[] = [];
  let index = 0;

  while (index < xml.length && elements.length < limit) {
    const tag = nextXmlTag(xml, index);
    if (!tag) break;
    index = tag.end + 1;
    if (tag.closing || tag.selfClosing || tag.localName !== localName) continue;

    const close = xml.indexOf(`</${tag.name}>`, tag.end + 1);
    if (close === -1) continue;
    elements.push({
      name: tag.name,
      localName: tag.localName,
      attributes: tag.attributes,
      inner: xml.slice(tag.end + 1, close)
    });
    index = close + tag.name.length + 3;
  }

  return elements;
}

function firstElementText(xml: string, localName: string): string {
  const element = xmlElements(xml, localName, 1)[0];
  return element ? cleanLine(xmlTextContent(element.inner)) : "";
}

function nextXmlTag(xml: string, from: number): XmlTag | null {
  let index = from;
  while (index < xml.length) {
    const start = xml.indexOf("<", index);
    if (start === -1) return null;
    const tag = parseXmlTag(xml, start);
    if (tag && !tag.name.startsWith("!") && !tag.name.startsWith("?")) return tag;
    index = start + 1;
  }
  return null;
}

function parseXmlTag(xml: string, start: number): XmlTag | null {
  const end = xml.indexOf(">", start + 1);
  if (end === -1) return null;
  let source = xml.slice(start + 1, end).trim();
  if (!source) return null;
  const closing = source.startsWith("/");
  if (closing) source = source.slice(1).trim();
  const selfClosing = source.endsWith("/");
  if (selfClosing) source = source.slice(0, -1).trim();
  const nameEnd = source.search(/\s/);
  const name = nameEnd === -1 ? source : source.slice(0, nameEnd);
  if (!name) return null;
  return {
    name,
    localName: name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name,
    attributes: nameEnd === -1 ? "" : source.slice(nameEnd + 1),
    closing,
    selfClosing,
    start,
    end
  };
}

function xmlAttribute(attributes: string, name: string): string | null {
  const direct = readQuotedAttribute(attributes, name);
  if (direct !== null) return decodeXmlEntities(direct);
  const namespaced = readQuotedAttribute(attributes, `r:${name}`);
  return namespaced === null ? null : decodeXmlEntities(namespaced);
}

function readQuotedAttribute(attributes: string, name: string): string | null {
  for (const quote of [`"`, "'"]) {
    const needle = `${name}=`;
    let index = attributes.indexOf(needle);
    while (index !== -1) {
      const before = index === 0 ? " " : attributes[index - 1];
      const valueStart = index + needle.length;
      if (/\s/.test(before) && attributes[valueStart] === quote) {
        const valueEnd = attributes.indexOf(quote, valueStart + 1);
        if (valueEnd !== -1) return attributes.slice(valueStart + 1, valueEnd);
      }
      index = attributes.indexOf(needle, index + needle.length);
    }
  }
  return null;
}

function xmlEntry(entries: Record<string, Uint8Array>, path: string): string {
  const entry = entries[path];
  return entry ? decodeXmlBytes(entry) : "";
}

function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.slice(2));
  }
  return strFromU8(bytes);
}

function decodeUtf16Be(bytes: Uint8Array): string {
  const swapped = new Uint8Array(bytes.length);
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    swapped[index] = bytes[index + 1];
    swapped[index + 1] = bytes[index];
  }
  return new TextDecoder("utf-16le").decode(swapped);
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[\dA-Fa-f]+|#\d+|amp|lt|gt|quot|apos);/g, (_match, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const codePoint = entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
  });
}

function looksTextual(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, Math.min(bytes.length, 4096));
  if (sample.length === 0) return false;
  let zeroCount = 0;
  let controlCount = 0;
  for (const byte of sample) {
    if (byte === 0) zeroCount += 1;
    if (byte < 9 || (byte > 13 && byte < 32)) controlCount += 1;
  }
  return zeroCount / sample.length < 0.02 && controlCount / sample.length < 0.08;
}

function appendLine(lines: string[], value: string): void {
  const clean = cleanLine(value);
  if (clean) lines.push(clean);
}

function cleanLine(value: string): string {
  return decodeXmlEntities(value)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function limitText(value: string): string {
  const clean = value
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clean.length > OFFICE_TEXT_LIMIT ? `${clean.slice(0, OFFICE_TEXT_LIMIT).trim()}\n\n[Preview truncated]` : clean;
}

function joinedLength(lines: string[]): number {
  return lines.reduce((sum, line) => sum + line.length + 1, 0);
}

function compareNumericPath(left: string, right: string): number {
  const leftNumber = Number(left.match(/(\d+)(?=\.[^.]+$)/)?.[1] ?? 0);
  const rightNumber = Number(right.match(/(\d+)(?=\.[^.]+$)/)?.[1] ?? 0);
  return leftNumber - rightNumber || left.localeCompare(right);
}
