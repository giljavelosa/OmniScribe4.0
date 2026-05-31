import { inflateRawSync } from 'node:zlib';

export function decodeUtf8Text(bytes: Buffer): string {
  return stripBom(new TextDecoder('utf-8', { fatal: false }).decode(bytes)).replace(/\u0000/g, '');
}

export function parseCsvToText(bytes: Buffer): string {
  const rows = parseCsvRows(decodeUtf8Text(bytes));
  return rows
    .map((row, index) => `Row ${index + 1}: ${row.map((cell, cellIndex) => `C${cellIndex + 1}=${cell}`).join(' | ')}`)
    .join('\n');
}

export function parseJsonToText(bytes: Buffer): string {
  const parsed = JSON.parse(decodeUtf8Text(bytes)) as unknown;
  return JSON.stringify(parsed, null, 2);
}

export function parseXmlToText(bytes: Buffer): string {
  const xml = decodeUtf8Text(bytes);
  const text = xml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [xml.slice(0, 20_000), text ? `\n\nExtracted XML text:\n${text}` : ''].join('').trim();
}

export function parseRtfToText(bytes: Buffer): string {
  const rtf = decodeUtf8Text(bytes);
  return rtf
    .replace(/\\'[0-9a-fA-F]{2}/g, (match) => String.fromCharCode(Number.parseInt(match.slice(2), 16)))
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\tab/g, '\t')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseDocxToText(bytes: Buffer): string {
  const documentXml = extractZipEntry(bytes, 'word/document.xml');
  if (!documentXml) {
    throw new Error('DOCX document.xml not found.');
  }
  return xmlTextContent(documentXml)
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseXlsxToText(bytes: Buffer): string {
  const sharedStringsXml = extractZipEntry(bytes, 'xl/sharedStrings.xml');
  const sharedStrings = sharedStringsXml ? extractSpreadsheetStrings(sharedStringsXml) : [];
  const sheetEntries = listZipEntries(bytes)
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (sheetEntries.length === 0) {
    throw new Error('XLSX worksheet XML not found.');
  }

  const lines: string[] = [];
  for (const sheet of sheetEntries) {
    const xml = extractZipEntry(bytes, sheet.name);
    if (!xml) continue;
    lines.push(`${sheet.name}:`);
    lines.push(...extractWorksheetRows(xml, sharedStrings));
  }
  return lines.join('\n').trim();
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    const next = input[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (char === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    if (char !== '\r') cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value.length > 0));
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  dataStart: number;
};

function listZipEntries(bytes: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset + 30 <= bytes.length) {
    const signature = bytes.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const flags = bytes.readUInt16LE(offset + 6);
    const compressionMethod = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const uncompressedSize = bytes.readUInt32LE(offset + 22);
    const fileNameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const name = bytes.toString('utf8', nameStart, nameStart + fileNameLength);

    if ((flags & 0x08) !== 0) {
      offset = dataStart + Math.max(1, compressedSize);
      continue;
    }

    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, dataStart });
    offset = dataStart + compressedSize;
  }

  return entries;
}

function extractZipEntry(bytes: Buffer, name: string): string | null {
  const entry = listZipEntries(bytes).find((candidate) => candidate.name === name);
  if (!entry) return null;
  const compressed = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  const inflated =
    entry.compressionMethod === 0
      ? compressed
      : entry.compressionMethod === 8
        ? inflateRawSync(compressed)
        : null;
  if (!inflated) {
    throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${name}.`);
  }
  if (entry.uncompressedSize > 0 && inflated.length !== entry.uncompressedSize) {
    return inflated.toString('utf8');
  }
  return inflated.toString('utf8');
}

function xmlTextContent(xml: string): string {
  return xml
    .replace(/<w:p[\s\S]*?>/g, '\n')
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n');
}

function extractSpreadsheetStrings(xml: string): string[] {
  return [...xml.matchAll(/<si[\s\S]*?<\/si>/g)].map((match) => xmlTextContent(match[0] ?? '').trim());
}

function extractWorksheetRows(xml: string, sharedStrings: string[]): string[] {
  return [...xml.matchAll(/<row\b[\s\S]*?<\/row>/g)].map((rowMatch, rowIndex) => {
    const cells = [...(rowMatch[0] ?? '').matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map((cellMatch) => {
      const attrs = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] ?? '?';
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? '';
      const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]?.trim() ?? '';
      const value = type === 's' ? sharedStrings[Number(rawValue)] ?? rawValue : rawValue;
      return `${ref}=${value}`;
    });
    return `Row ${rowIndex + 1}: ${cells.join(' | ')}`;
  });
}
