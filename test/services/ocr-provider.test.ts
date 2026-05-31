import { afterEach, describe, expect, it } from 'vitest';

import {
  OcrProviderUnavailableError,
  TextractOcrProvider,
  getOcrProvider,
} from '@/services/external-context/ocr-provider';

const originalOcrProvider = process.env.OCR_PROVIDER;

afterEach(() => {
  process.env.OCR_PROVIDER = originalOcrProvider;
});

describe('OCR providers', () => {
  it('selects Textract only when OCR_PROVIDER=textract', () => {
    process.env.OCR_PROVIDER = '';
    expect(getOcrProvider().name).toBe('unconfigured');

    process.env.OCR_PROVIDER = 'textract';
    expect(getOcrProvider().name).toBe('aws-textract');
  });

  it('submits an async Textract job against the S3 document and returns LINE text', async () => {
    const client = new FakeTextractClient([
      { JobId: 'job-1' },
      {
        JobStatus: 'SUCCEEDED',
        Blocks: [
          lineBlock('Second line', 1, 0.2, 0.1),
          lineBlock('First line', 1, 0.1, 0.1),
          lineBlock('Page two line', 2, 0.1, 0.1),
        ],
      },
    ]);
    const provider = new TextractOcrProvider(
      {
        region: 'us-east-1',
        pollIntervalMs: 1,
        maxWaitMs: 1_000,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:textract-complete',
        snsRoleArn: 'arn:aws:iam::123456789012:role/TextractPublishRole',
      },
      client as never,
    );

    const result = await provider.extractDocumentText({
      documentId: 'ec_1',
      bytes: Buffer.from('%PDF-1.4'),
      mimeType: 'application/pdf',
      pageCount: 2,
      s3Object: {
        bucket: 'private-documents',
        key: 'documents/external-context/ec_1/0.pdf',
      },
    });

    expect(result.provider).toBe('aws-textract');
    expect(result.jobId).toBe('job-1');
    expect(result.text).toBe('Page 1\nFirst line\nSecond line\n\nPage 2\nPage two line');
    expect(client.commands[0]?.name).toBe('StartDocumentTextDetectionCommand');
    expect(client.commands[0]?.input).toMatchObject({
      JobTag: expect.stringContaining('omniscribe-document-'),
      DocumentLocation: {
        S3Object: {
          Bucket: 'private-documents',
          Name: 'documents/external-context/ec_1/0.pdf',
        },
      },
      NotificationChannel: {
        SNSTopicArn: 'arn:aws:sns:us-east-1:123456789012:textract-complete',
        RoleArn: 'arn:aws:iam::123456789012:role/TextractPublishRole',
      },
    });
    expect(client.commands[1]?.input).toMatchObject({ MaxResults: 1000 });
  });

  it('collects paginated Textract results', async () => {
    const client = new FakeTextractClient([
      { JobId: 'job-2' },
      { JobStatus: 'SUCCEEDED', Blocks: [lineBlock('Page one', 1, 0.1, 0.1)], NextToken: 'next' },
      { JobStatus: 'SUCCEEDED', Blocks: [lineBlock('Page two', 2, 0.1, 0.1)] },
    ]);
    const provider = new TextractOcrProvider(
      { region: 'us-east-1', pollIntervalMs: 1, maxWaitMs: 1_000 },
      client as never,
    );

    const result = await provider.extractDocumentText({
      documentId: 'ec_2',
      bytes: Buffer.from('%PDF-1.4'),
      mimeType: 'application/pdf',
      pageCount: 2,
      s3Object: { bucket: 'private-documents', key: 'documents/external-context/ec_2/0.pdf' },
    });

    expect(result.text).toContain('Page one');
    expect(result.text).toContain('Page two');
    expect(client.commands.filter((command) => command.name === 'GetDocumentTextDetectionCommand')).toHaveLength(2);
  });

  it('fails clearly when Textract is selected for an unsupported MIME type', async () => {
    const provider = new TextractOcrProvider(
      { region: 'us-east-1', pollIntervalMs: 1, maxWaitMs: 1_000 },
      new FakeTextractClient([]) as never,
    );

    await expect(
      provider.extractDocumentText({
        documentId: 'ec_3',
        bytes: Buffer.from('hello'),
        mimeType: 'text/plain',
        pageCount: 1,
        s3Object: { bucket: 'private-documents', key: 'documents/external-context/ec_3/0.txt' },
      }),
    ).rejects.toBeInstanceOf(OcrProviderUnavailableError);
  });

  it('fails clearly when SNS notification configuration is partial', async () => {
    const provider = new TextractOcrProvider(
      {
        region: 'us-east-1',
        pollIntervalMs: 1,
        maxWaitMs: 1_000,
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:textract-complete',
      },
      new FakeTextractClient([]) as never,
    );

    await expect(
      provider.extractDocumentText({
        documentId: 'ec_4',
        bytes: Buffer.from('%PDF-1.4'),
        mimeType: 'application/pdf',
        pageCount: 1,
        s3Object: { bucket: 'private-documents', key: 'documents/external-context/ec_4/0.pdf' },
      }),
    ).rejects.toThrow(/TEXTRACT_SNS_TOPIC_ARN/);
  });
});

function lineBlock(text: string, page: number, top: number, left: number) {
  return {
    BlockType: 'LINE' as const,
    Text: text,
    Page: page,
    Geometry: {
      BoundingBox: { Top: top, Left: left },
    },
  };
}

class FakeTextractClient {
  commands: Array<{ name: string; input: unknown }> = [];

  constructor(private readonly responses: unknown[]) {}

  async send(command: { constructor: { name: string }; input?: unknown }) {
    this.commands.push({ name: command.constructor.name, input: command.input });
    const response = this.responses.shift();
    if (!response) throw new Error(`Unexpected Textract command ${command.constructor.name}`);
    return response;
  }
}
