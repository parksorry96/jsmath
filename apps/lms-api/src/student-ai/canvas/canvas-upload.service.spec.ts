import { CanvasUploadService } from "./canvas-upload.service";

describe("CanvasUploadService", () => {
  const mockS3Send = jest.fn().mockResolvedValue({});
  const mockConfig = {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        S3_BUCKET: "test-bucket",
        S3_REGION: "ap-northeast-2",
        S3_ACCESS_KEY_ID: "test-key",
        S3_SECRET_ACCESS_KEY: "test-secret",
        AWS_REGION: "ap-northeast-2",
        AWS_ACCESS_KEY_ID: "test-key",
        AWS_SECRET_ACCESS_KEY: "test-secret",
      };
      return map[key];
    }),
    getOrThrow: jest.fn((key: string) => {
      const map: Record<string, string> = {
        S3_BUCKET: "test-bucket",
        S3_REGION: "ap-northeast-2",
        S3_ACCESS_KEY_ID: "test-key",
        S3_SECRET_ACCESS_KEY: "test-secret",
      };
      return map[key];
    }),
  };

  it("generates correct S3 key pattern", async () => {
    const service = new CanvasUploadService(mockConfig as never);
    (service as any).s3 = { send: mockS3Send };

    const result = await service.upload("student-123", Buffer.from("png"), "image/png");

    expect(result.s3Key).toMatch(/^canvas\/student-123\/\d+\.png$/);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });

  it("rejects non-image MIME types", async () => {
    const service = new CanvasUploadService(mockConfig as never);
    await expect(
      service.upload("student-123", Buffer.from("data"), "application/pdf"),
    ).rejects.toThrow("Unsupported");
  });

  it("accepts jpeg and webp", async () => {
    const service = new CanvasUploadService(mockConfig as never);
    (service as any).s3 = { send: mockS3Send };
    mockS3Send.mockClear();

    const jpg = await service.upload("s1", Buffer.from("jpg"), "image/jpeg");
    expect(jpg.s3Key).toMatch(/\.jpg$/);

    const webp = await service.upload("s1", Buffer.from("webp"), "image/webp");
    expect(webp.s3Key).toMatch(/\.webp$/);
  });
});
