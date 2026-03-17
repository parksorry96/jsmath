import { ConfigService } from "@nestjs/config";
import { RedisStreamService } from "./redis-stream.service";

describe("RedisStreamService", () => {
  it("acks only after async handlers resolve", async () => {
    const service = new RedisStreamService(new ConfigService()) as any;

    const order: string[] = [];
    service.redis = {
      xack: jest.fn(async () => {
        order.push("ack");
      }),
    };

    service.onMessage(async () => {
      order.push("start");
      await Promise.resolve();
      order.push("finish");
    });

    await service.processStreamMessage(
      "stream:ocr:completed",
      "1-0",
      ["data", JSON.stringify({ ocrJobId: "job-1" })],
    );

    expect(order).toEqual(["start", "finish", "ack"]);
    expect(service.redis.xack).toHaveBeenCalledWith(
      "stream:ocr:completed",
      "lms-api",
      "1-0",
    );
  });
});
