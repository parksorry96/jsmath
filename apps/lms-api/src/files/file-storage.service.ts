import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { UploadPolicyService, MultipartUploadRole } from "./upload-policy.service";

export type MultipartUploadPart = {
  partNumber: number;
  etag: string;
};

export const MULTIPART_PART_SIZE_BYTES = 10 * 1024 * 1024;

@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);
  private s3: S3Client;
  private bucket: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private uploadPolicy: UploadPolicyService,
  ) {
    const s3Region =
      this.config.get<string>("AWS_REGION") ??
      this.config.getOrThrow<string>("S3_REGION");
    const s3AccessKeyId =
      this.config.get<string>("AWS_ACCESS_KEY_ID") ??
      this.config.getOrThrow<string>("S3_ACCESS_KEY_ID");
    const s3SecretAccessKey =
      this.config.get<string>("AWS_SECRET_ACCESS_KEY") ??
      this.config.getOrThrow<string>("S3_SECRET_ACCESS_KEY");

    this.s3 = new S3Client({
      region: s3Region,
      credentials: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
      },
    });
    this.bucket = this.config.getOrThrow<string>("S3_BUCKET");
  }

  private async assertPdfSignature(key: string) {
    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: "bytes=0-3",
        }),
      );
      const body = response.Body as
        | { transformToByteArray?: () => Promise<Uint8Array> }
        | undefined;
      const bytes = body?.transformToByteArray
        ? await body.transformToByteArray()
        : new Uint8Array();

      if (bytes.length < 4 || Buffer.from(bytes).toString("utf8") !== "%PDF") {
        throw new BadRequestException("Uploaded file is not a valid PDF");
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException("Failed to validate uploaded file");
    }
  }

  async ensureUploadedPdfObject(
    key: string,
    uploaderId: string,
    expectedSize?: number,
  ) {
    this.uploadPolicy.assertScopedUploadKey(key, uploaderId);

    let head;
    try {
      head = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch {
      throw new NotFoundException("Uploaded file not found in storage");
    }

    const contentLength = Number(head.ContentLength ?? 0);
    if (expectedSize && contentLength !== expectedSize) {
      throw new BadRequestException("Uploaded file size does not match");
    }

    const contentType = head.ContentType ?? "";
    if (
      contentType &&
      contentType !== "application/pdf" &&
      !contentType.toLowerCase().includes("pdf")
    ) {
      throw new BadRequestException("Uploaded file is not a PDF");
    }
    await this.assertPdfSignature(key);

    return {
      sizeBytes: contentLength,
      etag: typeof head.ETag === "string" ? head.ETag : null,
    };
  }

  async createMultipartUpload(
    uploaderId: string,
    params: {
      filename: string;
      size: number;
      role: MultipartUploadRole;
      contentType?: string | null;
    },
  ) {
    const key = this.uploadPolicy.buildMultipartUploadKey(uploaderId, params.role);
    const created = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: params.contentType || "application/pdf",
        Metadata: {
          uploaderId,
          role: params.role,
        },
      }),
    );

    if (!created.UploadId) {
      throw new InternalServerErrorException("Failed to create multipart upload");
    }

    return {
      key,
      uploadId: created.UploadId,
      partSize: MULTIPART_PART_SIZE_BYTES,
      partCount: Math.max(1, Math.ceil(params.size / MULTIPART_PART_SIZE_BYTES)),
    };
  }

  async getMultipartUploadUrls(
    uploaderId: string,
    params: {
      key: string;
      uploadId: string;
      partNumbers: number[];
    },
  ) {
    this.uploadPolicy.assertScopedUploadKey(params.key, uploaderId);
    if (!params.uploadId) {
      throw new BadRequestException("uploadId is required");
    }
    if (!Array.isArray(params.partNumbers) || params.partNumbers.length === 0) {
      throw new BadRequestException("partNumbers is required");
    }

    const urls = await Promise.all(
      params.partNumbers.map(async (partNumber) => {
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
          throw new BadRequestException("Invalid part number");
        }

        const url = await getSignedUrl(
          this.s3,
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: params.key,
            UploadId: params.uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: 900 },
        );

        return { partNumber, url };
      }),
    );

    return { urls };
  }

  async completeMultipartUpload(
    uploaderId: string,
    params: {
      key: string;
      uploadId: string;
      parts: MultipartUploadPart[];
    },
  ) {
    this.uploadPolicy.assertScopedUploadKey(params.key, uploaderId);
    if (!params.uploadId) {
      throw new BadRequestException("uploadId is required");
    }
    if (!Array.isArray(params.parts) || params.parts.length === 0) {
      throw new BadRequestException("parts is required");
    }

    const orderedParts = [...params.parts]
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((part) => ({
        ETag: part.etag,
        PartNumber: part.partNumber,
      }));

    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: params.key,
        UploadId: params.uploadId,
        MultipartUpload: {
          Parts: orderedParts,
        },
      }),
    );

    const uploaded = await this.ensureUploadedPdfObject(params.key, uploaderId);
    return {
      key: params.key,
      sizeBytes: uploaded.sizeBytes,
    };
  }

  async abortMultipartUpload(
    uploaderId: string,
    params: {
      key: string;
      uploadId: string;
    },
  ) {
    this.uploadPolicy.assertScopedUploadKey(params.key, uploaderId);
    if (!params.uploadId) {
      throw new BadRequestException("uploadId is required");
    }

    await this.s3.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: params.key,
        UploadId: params.uploadId,
      }),
    );

    return { aborted: true };
  }

  async deleteS3Objects(keys: string[]) {
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    if (uniqueKeys.length === 0) {
      return;
    }

    for (let i = 0; i < uniqueKeys.length; i += 1000) {
      const chunk = uniqueKeys.slice(i, i + 1000);
      try {
        await this.s3.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: {
              Objects: chunk.map((Key) => ({ Key })),
              Quiet: true,
            },
          }),
        );
      } catch (error) {
        this.logger.warn(
          `Failed to delete ${chunk.length} S3 objects`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  async getAssetUrl(
    s3Key: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<{ url: string }> {
    if (!s3Key || s3Key.includes("..") || s3Key.startsWith("/")) {
      throw new BadRequestException("Invalid asset key");
    }

    const asset = await this.prisma.problemAsset.findFirst({
      where: {
        s3Key,
        ...this.uploadPolicy.getProblemAssetScopeWhere(requesterId, requesterRole),
      },
      select: { id: true },
    });
    if (!asset) {
      throw new NotFoundException("Asset not found");
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
    });
    const url = await getSignedUrl(this.s3, command, { expiresIn: 900 });
    return { url };
  }

  async uploadBuffer(key: string, buffer: Buffer, contentType?: string) {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType || "application/pdf",
        }),
      );
    } catch {
      throw new InternalServerErrorException("S3 upload failed");
    }
  }
}
