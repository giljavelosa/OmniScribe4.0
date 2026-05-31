import { createHash } from 'node:crypto';

import {
  GetDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
  type Block,
  type GetDocumentTextDetectionCommandOutput,
} from '@aws-sdk/client-textract';

import { s3Config } from '@/lib/s3/client';

export type OcrDocumentInput = {
  documentId: string;
  bytes: Buffer;
  mimeType: string;
  pageCount: number;
  s3Object?: {
    bucket: string;
    key: string;
  };
};

export type OcrDocumentResult = {
  text: string;
  provider: string;
  jobId: string;
  submittedAt: Date;
  completedAt: Date;
  durationMs: number;
};

export interface OcrProvider {
  readonly name: string;
  extractDocumentText(input: OcrDocumentInput): Promise<OcrDocumentResult>;
}

export class OcrProviderUnavailableError extends Error {
  constructor(message = 'No OCR provider is configured for scanned document extraction.') {
    super(message);
    this.name = 'OcrProviderUnavailableError';
  }
}

export class UnconfiguredOcrProvider implements OcrProvider {
  readonly name = 'unconfigured';

  async extractDocumentText(): Promise<OcrDocumentResult> {
    throw new OcrProviderUnavailableError();
  }
}

type TextractClientLike = {
  send(command: StartDocumentTextDetectionCommand): Promise<{ JobId?: string }>;
  send(command: GetDocumentTextDetectionCommand): Promise<GetDocumentTextDetectionCommandOutput>;
};

type TextractOcrProviderConfig = {
  region?: string;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  outputS3Bucket?: string;
  outputS3Prefix?: string;
  kmsKeyId?: string;
  snsTopicArn?: string;
  snsRoleArn?: string;
  jobTagPrefix?: string;
};

export class TextractOcrProvider implements OcrProvider {
  readonly name = 'aws-textract';

  private readonly client: TextractClientLike;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly outputS3Bucket: string | undefined;
  private readonly outputS3Prefix: string | undefined;
  private readonly kmsKeyId: string | undefined;
  private readonly snsTopicArn: string | undefined;
  private readonly snsRoleArn: string | undefined;
  private readonly jobTagPrefix: string;

  constructor(config: TextractOcrProviderConfig = {}, client?: TextractClientLike) {
    const region = config.region ?? process.env.TEXTRACT_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
    this.client = client ?? new TextractClient({ region });
    this.pollIntervalMs = config.pollIntervalMs ?? Number(process.env.TEXTRACT_POLL_INTERVAL_MS ?? '3000');
    this.maxWaitMs = config.maxWaitMs ?? Number(process.env.TEXTRACT_MAX_WAIT_MS ?? '600000');
    this.outputS3Bucket = config.outputS3Bucket ?? process.env.TEXTRACT_OUTPUT_S3_BUCKET;
    this.outputS3Prefix = config.outputS3Prefix ?? process.env.TEXTRACT_OUTPUT_S3_PREFIX;
    this.kmsKeyId = config.kmsKeyId ?? process.env.TEXTRACT_KMS_KEY_ID;
    this.snsTopicArn = config.snsTopicArn ?? process.env.TEXTRACT_SNS_TOPIC_ARN;
    this.snsRoleArn = config.snsRoleArn ?? process.env.TEXTRACT_SNS_ROLE_ARN;
    this.jobTagPrefix = config.jobTagPrefix ?? process.env.TEXTRACT_JOB_TAG_PREFIX ?? 'omniscribe-document';
  }

  async extractDocumentText(input: OcrDocumentInput): Promise<OcrDocumentResult> {
    const s3Object = input.s3Object ?? (s3Config.bucket ? { bucket: s3Config.bucket, key: input.documentId } : null);
    if (!s3Object?.bucket || !s3Object.key) {
      throw new OcrProviderUnavailableError(
        'AWS Textract OCR requires the uploaded document to exist in S3.',
      );
    }
    if (!isTextractSupportedMime(input.mimeType)) {
      throw new OcrProviderUnavailableError(`AWS Textract does not support MIME type ${input.mimeType}.`);
    }
    if ((this.snsTopicArn && !this.snsRoleArn) || (!this.snsTopicArn && this.snsRoleArn)) {
      throw new OcrProviderUnavailableError(
        'AWS Textract SNS notification requires both TEXTRACT_SNS_TOPIC_ARN and TEXTRACT_SNS_ROLE_ARN.',
      );
    }

    const submittedAt = new Date();
    const start = await this.client.send(
      new StartDocumentTextDetectionCommand({
        ClientRequestToken: stableClientRequestToken(input.documentId, s3Object.key),
        JobTag: stableJobTag(this.jobTagPrefix, input.documentId),
        DocumentLocation: {
          S3Object: {
            Bucket: s3Object.bucket,
            Name: s3Object.key,
          },
        },
        ...(this.snsTopicArn && this.snsRoleArn
          ? {
              NotificationChannel: {
                SNSTopicArn: this.snsTopicArn,
                RoleArn: this.snsRoleArn,
              },
            }
          : {}),
        ...(this.kmsKeyId ? { KMSKeyId: this.kmsKeyId } : {}),
        ...(this.outputS3Bucket
          ? {
              OutputConfig: {
                S3Bucket: this.outputS3Bucket,
                ...(this.outputS3Prefix ? { S3Prefix: this.outputS3Prefix } : {}),
              },
            }
          : {}),
      }),
    );
    const jobId = start.JobId;
    if (!jobId) {
      throw new Error('AWS Textract did not return a JobId.');
    }

    const blocks = await this.waitForTextDetection(jobId);
    const completedAt = new Date();
    return {
      text: blocksToText(blocks),
      provider: this.name,
      jobId,
      submittedAt,
      completedAt,
      durationMs: completedAt.getTime() - submittedAt.getTime(),
    };
  }

  private async waitForTextDetection(jobId: string): Promise<Block[]> {
    const started = Date.now();
    let nextToken: string | undefined;
    const blocks: Block[] = [];

    while (Date.now() - started <= this.maxWaitMs) {
      const firstPage = await this.client.send(new GetDocumentTextDetectionCommand({ JobId: jobId, MaxResults: 1000 }));
      if (firstPage.JobStatus === 'IN_PROGRESS') {
        await sleep(this.pollIntervalMs);
        continue;
      }
      if (firstPage.JobStatus === 'FAILED') {
        throw new Error(`AWS Textract job ${jobId} failed: ${firstPage.StatusMessage ?? 'no status message'}`);
      }
      if (firstPage.JobStatus !== 'SUCCEEDED' && firstPage.JobStatus !== 'PARTIAL_SUCCESS') {
        throw new Error(`AWS Textract job ${jobId} returned unexpected status ${firstPage.JobStatus ?? 'unknown'}`);
      }

      blocks.push(...(firstPage.Blocks ?? []));
      nextToken = firstPage.NextToken;
      while (nextToken) {
        const page = await this.client.send(
          new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: nextToken, MaxResults: 1000 }),
        );
        blocks.push(...(page.Blocks ?? []));
        nextToken = page.NextToken;
      }
      return blocks;
    }

    throw new Error(`AWS Textract job ${jobId} did not complete within ${this.maxWaitMs}ms.`);
  }
}

export class MockOcrProvider implements OcrProvider {
  readonly name = 'mock-ocr';

  constructor(private readonly text = 'Mock OCR text from scanned clinical document.') {}

  async extractDocumentText(input: OcrDocumentInput): Promise<OcrDocumentResult> {
    const submittedAt = new Date();
    const completedAt = new Date(submittedAt.getTime() + 1);
    return {
      text: this.text,
      provider: this.name,
      jobId: `mock-ocr:${input.documentId}`,
      submittedAt,
      completedAt,
      durationMs: completedAt.getTime() - submittedAt.getTime(),
    };
  }
}

export function getOcrProvider(): OcrProvider {
  if ((process.env.OCR_PROVIDER ?? '').toLowerCase() === 'textract') {
    return new TextractOcrProvider();
  }
  return new UnconfiguredOcrProvider();
}

function isTextractSupportedMime(mimeType: string): boolean {
  return mimeType === 'application/pdf' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/png' ||
    mimeType === 'image/tiff' ||
    mimeType === 'image/tif';
}

function stableClientRequestToken(documentId: string, key: string): string {
  const hash = createHash('sha256').update(`${documentId}:${key}`).digest('hex').slice(0, 32);
  return `ocr-${hash}`;
}

function stableJobTag(prefix: string, documentId: string): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_.:-]/g, '-').slice(0, 24) || 'omniscribe-document';
  const hash = createHash('sha256').update(documentId).digest('hex').slice(0, 24);
  return `${safePrefix}-${hash}`.slice(0, 64);
}

function blocksToText(blocks: Block[]): string {
  const lines = blocks
    .filter((block) => block.BlockType === 'LINE' && block.Text)
    .map((block, index) => ({
      page: block.Page ?? 1,
      top: block.Geometry?.BoundingBox?.Top ?? index,
      left: block.Geometry?.BoundingBox?.Left ?? 0,
      text: block.Text ?? '',
    }))
    .sort((a, b) => a.page - b.page || a.top - b.top || a.left - b.left);

  const out: string[] = [];
  let currentPage = 0;
  for (const line of lines) {
    if (line.page !== currentPage) {
      currentPage = line.page;
      out.push(`${out.length > 0 ? '\n' : ''}Page ${currentPage}`);
    }
    out.push(line.text);
  }
  return out.join('\n').trim() || 'AWS Textract completed but returned no LINE text blocks.';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
