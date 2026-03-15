import { Injectable, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

@Injectable()
export class CanvasUploadService {
  private s3: S3Client;
  private bucket: string;

  constructor(private config: ConfigService) {
    const region =
      this.config.get<string>("AWS_REGION") ??
      this.config.getOrThrow<string>("S3_REGION");
    const accessKeyId =
      this.config.get<string>("AWS_ACCESS_KEY_ID") ??
      this.config.getOrThrow<string>("S3_ACCESS_KEY_ID");
    const secretAccessKey =
      this.config.get<string>("AWS_SECRET_ACCESS_KEY") ??
      this.config.getOrThrow<string>("S3_SECRET_ACCESS_KEY");

    this.s3 = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    this.bucket = this.config.getOrThrow<string>("S3_BUCKET");
  }

  async upload(
    studentId: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ s3Key: string }> {
    if (!ALLOWED_MIME.has(mimeType)) {
      throw new BadRequestException(`Unsupported MIME type: ${mimeType}`);
    }

    const ext = MIME_EXT[mimeType];
    const s3Key = `canvas/${studentId}/${Date.now()}.${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );

    return { s3Key };
  }

  async downloadAsBase64(s3Key: string): Promise<{ base64: string; mimeType: string }> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }),
    );
    const bytes = await response.Body!.transformToByteArray();
    const ext = s3Key.split(".").pop() ?? "png";
    const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    return { base64: Buffer.from(bytes).toString("base64"), mimeType };
  }
}
