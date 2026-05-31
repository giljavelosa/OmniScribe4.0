import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

import type { ImageBlock } from '@/services/llm';
import { MAX_DOCUMENT_PAGES } from '@/lib/external-context/validation';

const execFileAsync = promisify(execFile);

export type RasterizedDocument = {
  pageCount: number;
  images: ImageBlock[];
};

type SourceDocument = {
  bytes: Buffer;
  mimeType: string;
  label: string;
};

type RasterizeOptions = {
  pageStart?: number;
  pageEnd?: number;
  maxPages?: number;
};

export async function rasterizeExternalContextDocuments(
  documents: SourceDocument[],
  options: RasterizeOptions = {},
): Promise<RasterizedDocument> {
  const images: ImageBlock[] = [];
  let pageCount = 0;
  const maxPages = options.maxPages ?? MAX_DOCUMENT_PAGES;
  const requestedStart = Math.max(1, options.pageStart ?? 1);
  const requestedEnd = Math.min(options.pageEnd ?? maxPages, maxPages);

  for (const doc of documents) {
    if (isSupportedImageMime(doc.mimeType)) {
      const sourcePage = pageCount + 1;
      pageCount += 1;
      if (sourcePage >= requestedStart && sourcePage <= requestedEnd && images.length < maxPages) {
        images.push({
          mediaType: normalizeImageMime(doc.mimeType),
          data: doc.bytes.toString('base64'),
          label: doc.label,
          sourcePage,
        });
      }
      continue;
    }

    if (doc.mimeType === 'application/pdf') {
      const pdfPageCount = countPdfPages(doc.bytes);
      const firstSourcePage = pageCount + 1;
      pageCount += pdfPageCount;
      const lastSourcePage = pageCount;
      const overlapStart = Math.max(requestedStart, firstSourcePage);
      const overlapEnd = Math.min(requestedEnd, lastSourcePage);
      if (overlapStart <= overlapEnd) {
        const localPages = Array.from(
          { length: overlapEnd - overlapStart + 1 },
          (_, index) => overlapStart - firstSourcePage + index + 1,
        ).slice(0, Math.max(0, maxPages - images.length));
        const renderedPages = await renderPdfPages(doc.bytes, localPages);
        renderedPages.forEach((png, index) => {
          const localPage = localPages[index]!;
          const sourcePage = firstSourcePage + localPage - 1;
          images.push({
            mediaType: 'image/png',
            data: png.toString('base64'),
            label: `${doc.label} page ${localPage}`,
            sourcePage,
          });
        });
      }
      continue;
    }

    throw new Error(`Unsupported document MIME type: ${doc.mimeType}`);
  }

  if (images.length === 0) {
    throw new Error('No image pages were available for extraction.');
  }

  return { pageCount, images: images.slice(0, maxPages) };
}

function isSupportedImageMime(mimeType: string): boolean {
  return mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/jpg' || mimeType === 'image/webp';
}

function normalizeImageMime(mimeType: string): ImageBlock['mediaType'] {
  if (mimeType === 'image/png') return 'image/png';
  if (mimeType === 'image/webp') return 'image/webp';
  return 'image/jpeg';
}

function countPdfPages(bytes: Buffer): number {
  const text = bytes.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return Math.max(1, matches?.length ?? 1);
}

async function renderPdfPages(bytes: Buffer, pageNumbers: number[]): Promise<Buffer[]> {
  if (pageNumbers.length === 0) return [];
  try {
    return await renderPdfPagesWithSwift(bytes, pageNumbers);
  } catch (err) {
    if (pageNumbers.length === 1 && pageNumbers[0] === 1) {
      return [await renderFirstPdfPageWithSips(bytes)];
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF rasterization failed for pages ${pageNumbers.join(',')}: ${message}`);
  }
}

async function renderPdfPagesWithSwift(bytes: Buffer, pageNumbersRaw: number[]): Promise<Buffer[]> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'omniscribe-doc-'));
  const input = path.join(dir, 'source.pdf');
  const script = path.join(dir, 'render.swift');
  const pageNumbers = pageNumbersRaw.map((pageNumber) => String(pageNumber));

  try {
    await writeFile(input, bytes);
    await writeFile(script, PDFKIT_RENDER_SWIFT);
    await execFileAsync('swift', [script, input, dir, ...pageNumbers]);
    return Promise.all(
      pageNumbers.map((pageNumber) => readFile(path.join(dir, `page-${pageNumber}.png`))),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Swift PDF rasterization failed: ${message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function renderFirstPdfPageWithSips(bytes: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'omniscribe-doc-'));
  const input = path.join(dir, 'source.pdf');
  const output = path.join(dir, 'page.png');

  try {
    await writeFile(input, bytes);
    await execFileAsync('sips', ['-s', 'format', 'png', input, '--out', output]);
    return await readFile(output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`sips PDF rasterization failed: ${message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const PDFKIT_RENDER_SWIFT = `
import AppKit
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count >= 4 else {
  fputs("usage: render.swift input.pdf output-dir page...", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: args[1])
let outputDir = URL(fileURLWithPath: args[2])
let pageNumbers = args.dropFirst(3).compactMap { Int($0) }

guard let document = PDFDocument(url: inputURL) else {
  fputs("could not open PDF", stderr)
  exit(3)
}

let maxDimension: CGFloat = 1800

for pageNumber in pageNumbers {
  guard pageNumber >= 1,
        pageNumber <= document.pageCount,
        let page = document.page(at: pageNumber - 1) else {
    fputs("invalid page number \\(pageNumber)", stderr)
    exit(4)
  }

  let bounds = page.bounds(for: .mediaBox)
  let scale = min(maxDimension / max(bounds.width, bounds.height), 2.0)
  let width = max(1, Int(bounds.width * scale))
  let height = max(1, Int(bounds.height * scale))
  let image = NSImage(size: NSSize(width: width, height: height))

  image.lockFocus()
  NSColor.white.set()
  NSRect(x: 0, y: 0, width: width, height: height).fill()
  if let context = NSGraphicsContext.current?.cgContext {
    context.saveGState()
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: scale, y: -scale)
    page.draw(with: .mediaBox, to: context)
    context.restoreGState()
  }
  image.unlockFocus()

  guard let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("could not encode page \\(pageNumber)", stderr)
    exit(5)
  }

  let outputURL = outputDir.appendingPathComponent("page-\\(pageNumber).png")
  do {
    try png.write(to: outputURL)
  } catch {
    fputs("could not write page \\(pageNumber): \\(error)", stderr)
    exit(6)
  }
}
`.trim();
