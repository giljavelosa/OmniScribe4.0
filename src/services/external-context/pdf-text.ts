import { inflateSync } from 'node:zlib';

export type PdfTextPage = {
  pageNumber: number;
  text: string;
  usableCharacterCount: number;
};

export type PdfTextLayerResult = {
  pageCount: number;
  pages: PdfTextPage[];
  text: string;
  averageUsableCharactersPerPage: number;
  pagesWithUsableText: number;
  textLayerUsable: boolean;
};

const USABLE_CHARS_PER_PAGE_THRESHOLD = 200;
const USABLE_PAGE_RATIO_THRESHOLD = 0.8;

export function countPdfPages(bytes: Buffer): number {
  const text = bytes.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return Math.max(1, matches?.length ?? 1);
}

export function extractPdfTextLayer(bytes: Buffer): PdfTextLayerResult {
  const pageCount = countPdfPages(bytes);
  const streamTexts = decodePdfContentStreams(bytes)
    .map(extractVisibleTextFromPdfContent)
    .map(normalizeExtractedText)
    .filter((text) => text.length > 0);

  const pages = Array.from({ length: pageCount }, (_, index) => {
    const text = streamTexts[index] ?? '';
    return {
      pageNumber: index + 1,
      text,
      usableCharacterCount: countUsableCharacters(text),
    };
  });

  const pagesWithUsableText = pages.filter(
    (page) => page.usableCharacterCount >= USABLE_CHARS_PER_PAGE_THRESHOLD,
  ).length;
  const averageUsableCharactersPerPage =
    pages.reduce((sum, page) => sum + page.usableCharacterCount, 0) / Math.max(1, pageCount);
  const textLayerUsable =
    averageUsableCharactersPerPage >= USABLE_CHARS_PER_PAGE_THRESHOLD ||
    pagesWithUsableText / Math.max(1, pageCount) >= USABLE_PAGE_RATIO_THRESHOLD;

  return {
    pageCount,
    pages,
    text: pages
      .map((page) => (page.text ? `Page ${page.pageNumber}\n${page.text}` : `Page ${page.pageNumber}`))
      .join('\n\n')
      .trim(),
    averageUsableCharactersPerPage,
    pagesWithUsableText,
    textLayerUsable,
  };
}

function decodePdfContentStreams(bytes: Buffer): string[] {
  const pdf = bytes.toString('latin1');
  const streams: string[] = [];
  const streamPattern = /<<([\s\S]*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(pdf))) {
    const dictionary = match[1] ?? '';
    const rawStream = match[2] ?? '';
    if (!dictionary.includes('/Filter') && !looksLikeTextContentStream(rawStream)) continue;

    try {
      const decoded = decodePdfStream(dictionary, rawStream);
      if (looksLikeTextContentStream(decoded)) streams.push(decoded);
    } catch {
      // Corrupt or unsupported streams are ignored; sparse text falls back to OCR.
    }
  }

  return streams;
}

function decodePdfStream(dictionary: string, rawStream: string): string {
  let bytes: Buffer<ArrayBufferLike> = Buffer.from(trimStreamBoundary(rawStream), 'latin1');
  if (dictionary.includes('/ASCII85Decode')) {
    bytes = ascii85Decode(bytes.toString('latin1'));
  }
  if (dictionary.includes('/FlateDecode')) {
    bytes = inflateSync(bytes);
  }
  return bytes.toString('latin1');
}

function trimStreamBoundary(value: string): string {
  return value.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

function looksLikeTextContentStream(value: string): boolean {
  return value.includes(' BT') || value.includes('BT\n') || value.includes(' Tj') || value.includes(' TJ');
}

function ascii85Decode(input: string): Buffer {
  const clean = input
    .replace(/^<~/, '')
    .replace(/~>$/, '')
    .replace(/\s+/g, '');
  const out: number[] = [];
  let group = '';

  for (const char of clean) {
    if (char === 'z' && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (char < '!' || char > 'u') continue;
    group += char;
    if (group.length === 5) {
      out.push(...decodeAscii85Group(group, 4));
      group = '';
    }
  }

  if (group.length > 0) {
    const outputBytes = group.length - 1;
    out.push(...decodeAscii85Group(group.padEnd(5, 'u'), outputBytes));
  }

  return Buffer.from(out);
}

function decodeAscii85Group(group: string, outputBytes: number): number[] {
  let value = 0;
  for (const char of group) {
    value = value * 85 + (char.charCodeAt(0) - 33);
  }
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].slice(0, outputBytes);
}

function extractVisibleTextFromPdfContent(content: string): string {
  const pieces: string[] = [];
  let index = 0;

  while (index < content.length) {
    const char = content[index];
    if (char === '(') {
      const parsed = readPdfLiteralString(content, index);
      if (parsed) {
        const operator = readFollowingOperator(content, parsed.nextIndex);
        if (operator === 'Tj' || operator === "'" || operator === '"') {
          pieces.push(parsed.value);
        }
        index = parsed.nextIndex;
        continue;
      }
    }
    if (char === '[') {
      const parsed = readPdfTextArray(content, index);
      if (parsed) {
        const operator = readFollowingOperator(content, parsed.nextIndex);
        if (operator === 'TJ') {
          pieces.push(parsed.values.join(''));
        }
        index = parsed.nextIndex;
        continue;
      }
    }
    index += 1;
  }

  return pieces.join('\n');
}

function readFollowingOperator(content: string, start: number): string | null {
  let index = start;
  while (index < content.length && /\s/.test(content[index]!)) index += 1;
  const next = content.slice(index, index + 2);
  if (next === 'Tj' || next === 'TJ') return next;
  const single = content[index];
  if (single === "'" || single === '"') return single;
  return null;
}

function readPdfTextArray(content: string, start: number): { values: string[]; nextIndex: number } | null {
  const values: string[] = [];
  let index = start + 1;
  while (index < content.length) {
    const char = content[index];
    if (char === ']') return { values, nextIndex: index + 1 };
    if (char === '(') {
      const parsed = readPdfLiteralString(content, index);
      if (!parsed) return null;
      values.push(parsed.value);
      index = parsed.nextIndex;
      continue;
    }
    index += 1;
  }
  return null;
}

function readPdfLiteralString(content: string, start: number): { value: string; nextIndex: number } | null {
  const chars: string[] = [];
  let depth = 1;
  let index = start + 1;

  while (index < content.length) {
    const char = content[index]!;
    if (char === '\\') {
      const escaped = readEscapedPdfChar(content, index);
      chars.push(escaped.value);
      index = escaped.nextIndex;
      continue;
    }
    if (char === '(') {
      depth += 1;
      chars.push(char);
      index += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return { value: chars.join(''), nextIndex: index + 1 };
      chars.push(char);
      index += 1;
      continue;
    }
    chars.push(char);
    index += 1;
  }
  return null;
}

function readEscapedPdfChar(content: string, start: number): { value: string; nextIndex: number } {
  const next = content[start + 1];
  if (next === undefined) return { value: '', nextIndex: start + 1 };
  if (next === '\n') return { value: '', nextIndex: start + 2 };
  if (next === '\r') {
    const skip = content[start + 2] === '\n' ? 3 : 2;
    return { value: '', nextIndex: start + skip };
  }
  if (/[0-7]/.test(next)) {
    const octal = content.slice(start + 1, start + 4).match(/^[0-7]{1,3}/)?.[0] ?? next;
    return { value: String.fromCharCode(Number.parseInt(octal, 8)), nextIndex: start + 1 + octal.length };
  }
  const escapes: Record<string, string> = {
    n: '\n',
    r: '\r',
    t: '\t',
    b: '\b',
    f: '\f',
    '(': '(',
    ')': ')',
    '\\': '\\',
  };
  return { value: escapes[next] ?? next, nextIndex: start + 2 };
}

function normalizeExtractedText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function countUsableCharacters(value: string): number {
  return value.replace(/\s+/g, '').length;
}
