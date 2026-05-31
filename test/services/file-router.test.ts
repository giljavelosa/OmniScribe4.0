import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  detectClinicalFileType,
  isFileRouterV2Enabled,
  routeClinicalFile,
} from '@/services/external-context/file-router';
import { MockOcrProvider } from '@/services/external-context/ocr-provider';

const fixturePath = path.join(
  process.cwd(),
  'tests/fixtures/ingestion/OmniScribe_John_Alvarez_COMPREHENSIVE_SYNTHETIC_Medical_Record_Packet.pdf',
);

describe('clinical file router V2', () => {
  it('routes the mandatory John Alvarez 40-page PDF through direct PDF text extraction', async () => {
    const bytes = readFileSync(fixturePath);
    const started = Date.now();

    const decision = await routeClinicalFile({
      documentId: 'john-alvarez',
      bytes,
      mimeType: 'application/pdf',
      fileName: 'john.pdf',
    });

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(decision.route).toBe('pdf_text_layer');
    expect(decision.pageCount).toBe(40);
    expect(decision.textLayerUsable).toBe(true);
    expect(decision.ocrUsed).toBe(false);
    expect(decision.text.length).toBeGreaterThan(40_000);

    const text = squish(decision.text);
    expect(text).toContain('John Alvarez');
    expect(text).toContain('MRN 14332');
    expect(text).toContain('DOB 03/14/1956');
    expect(text).toContain('Male');
    expect(text).toContain('Penicillin');
    expect(text).toContain('Anaphylaxis with urticaria and throat tightness');
    expect(text).toContain('hymenoptera venom');
    expect(text).toContain('Latex');
    expect(text).toContain('orthotopic heart transplant');
    expect(text).toContain('Tacrolimus');
    expect(text).toContain('Mycophenolate');
    expect(text).toContain('Valganciclovir');
    expect(text).toContain('Creatinine 1.42');
    expect(text).toContain('eGFR 53');
    expect(text).toContain('Hemoglobin A1c');
    expect(text).toContain('Timed Up and Go');
    expect(text).toContain('6 Minute Walk Test');
    expect(text).toContain('Left grip');
    expect(text).toContain('test data and documentation parsing only');
  });

  it('routes sparse PDFs to whole-document OCR instead of vision page batching', async () => {
    const sparsePdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF', 'latin1');
    const decision = await routeClinicalFile({
      documentId: 'scanned',
      bytes: sparsePdf,
      mimeType: 'application/pdf',
      fileName: 'scan.pdf',
      ocrProvider: new MockOcrProvider('OCR text for all pages from async provider.'),
    });

    expect(decision.route).toBe('pdf_ocr');
    expect(decision.ocrUsed).toBe(true);
    expect(decision.text).toContain('OCR text for all pages');
    expect(decision.ocrResult?.jobId).toBe('mock-ocr:scanned');
  });

  it('preserves the single image fast path', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const decision = await routeClinicalFile({
      documentId: 'image',
      bytes: png,
      mimeType: 'image/png',
      fileName: 'lab.png',
    });

    expect(decision.route).toBe('image_fast_path');
    expect(decision.pageCount).toBe(1);
    expect(decision.ocrUsed).toBe(false);
    expect(decision.text).toBe('');
  });

  it('parses direct text and structured file types without OCR', async () => {
    await expectRoute('txt_text', Buffer.from('Patient note text'), 'text/plain', 'note.txt');
    await expectRoute('csv_table', Buffer.from('test,value\nCreatinine,1.42'), 'text/csv', 'labs.csv');
    await expectRoute('json_structured', Buffer.from('{"resourceType":"Patient","name":"John"}'), 'application/json', 'patient.json');
    await expectRoute('xml_structured', Buffer.from('<ClinicalDocument><title>CCD</title></ClinicalDocument>'), 'application/xml', 'ccd.xml');
    await expectRoute('rtf_text', Buffer.from('{\\rtf1\\ansi Creatinine 1.42\\par}'), 'application/rtf', 'note.rtf');
  });

  it('parses minimal DOCX and XLSX containers directly', async () => {
    const docx = createStoredZip({
      'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Heart transplant note</w:t></w:r></w:p></w:body></w:document>',
    });
    const xlsx = createStoredZip({
      'xl/sharedStrings.xml': '<sst><si><t>Creatinine</t></si><si><t>1.42</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>',
    });

    const docxDecision = await routeClinicalFile({
      documentId: 'docx',
      bytes: docx,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: 'note.docx',
    });
    const xlsxDecision = await routeClinicalFile({
      documentId: 'xlsx',
      bytes: xlsx,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: 'labs.xlsx',
    });

    expect(docxDecision.route).toBe('docx_text');
    expect(docxDecision.text).toContain('Heart transplant note');
    expect(xlsxDecision.route).toBe('xlsx_table');
    expect(xlsxDecision.text).toContain('A1=Creatinine');
    expect(xlsxDecision.text).toContain('B1=1.42');
  });

  it('handles unknown files conservatively', async () => {
    const decision = await routeClinicalFile({
      documentId: 'unknown',
      bytes: Buffer.from([0, 1, 2, 3]),
      mimeType: 'application/octet-stream',
      fileName: 'blob.bin',
    });

    expect(decision.route).toBe('unsupported_manual_review');
    expect(decision.unsupportedReason).toContain('Unsupported file type');
  });

  it('keeps router V2 behind an explicit feature flag', () => {
    expect(isFileRouterV2Enabled({} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isFileRouterV2Enabled({ OMNISCRIBE_FILE_ROUTER_V2: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('uses safe detection signals in conservative order', () => {
    const detected = detectClinicalFileType(Buffer.from('%PDF-1.4'), 'application/octet-stream', 'upload.bin');
    expect(detected.fileType).toBe('pdf');
  });
});

async function expectRoute(route: string, bytes: Buffer, mimeType: string, fileName: string) {
  const decision = await routeClinicalFile({ documentId: fileName, bytes, mimeType, fileName });
  expect(decision.route).toBe(route);
  expect(decision.ocrUsed).toBe(false);
  expect(decision.text.length).toBeGreaterThan(0);
}

function squish(value: string): string {
  return value.replace(/\s+/g, ' ');
}

function createStoredZip(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(value);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(0, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    parts.push(header, nameBytes, data);
  }
  return Buffer.concat(parts);
}
