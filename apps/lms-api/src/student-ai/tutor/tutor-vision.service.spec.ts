import { BadRequestException } from "@nestjs/common";
import { TutorVisionService } from "./tutor-vision.service";

describe("TutorVisionService", () => {
  let service: TutorVisionService;

  beforeEach(() => {
    // Construct with null deps — we only test pure methods
    service = new TutorVisionService(
      null as any,
      null as any,
      null as any,
    );
  });

  describe("validateSessionLimits", () => {
    it("rejects when message count >= 30", () => {
      const session = { messages: new Array(30).fill({}) };
      expect(() => service.validateSessionLimits(session)).toThrow(
        BadRequestException,
      );
      expect(() => service.validateSessionLimits(session)).toThrow(
        "Maximum 30 messages per session reached",
      );
    });

    it("rejects when image count >= 5", () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        metadata: i < 5 ? { imageS3Key: `canvas/s/${i}.png` } : null,
      }));
      const session = { messages };

      expect(() =>
        service.validateSessionLimits(session, "canvas/s/new.png"),
      ).toThrow(BadRequestException);
      expect(() =>
        service.validateSessionLimits(session, "canvas/s/new.png"),
      ).toThrow("Maximum 5 images per session reached");
    });

    it("allows when within limits", () => {
      const session = {
        messages: [
          { metadata: { imageS3Key: "canvas/s/1.png" } },
          { metadata: null },
          { metadata: null },
        ],
      };

      expect(() =>
        service.validateSessionLimits(session, "canvas/s/2.png"),
      ).not.toThrow();
    });

    it("allows text-only messages even near image limit", () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        metadata: i < 4 ? { imageS3Key: `canvas/s/${i}.png` } : null,
      }));
      const session = { messages };

      // No imageS3Key in this call — should pass even though 4 images exist
      expect(() => service.validateSessionLimits(session)).not.toThrow();
    });

    it("allows exactly 29 messages", () => {
      const session = { messages: new Array(29).fill({}) };
      expect(() => service.validateSessionLimits(session)).not.toThrow();
    });

    it("rejects at 31 messages", () => {
      const session = { messages: new Array(31).fill({}) };
      expect(() => service.validateSessionLimits(session)).toThrow(
        "Maximum 30 messages per session reached",
      );
    });
  });
});
