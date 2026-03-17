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

  describe("listSessions", () => {
    it("returns session summaries with problem preview and message count", async () => {
      const prisma = {
        tutorSession: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "session-1",
              problemId: "problem-1",
              status: "active",
              createdAt: new Date("2026-03-16T10:00:00.000Z"),
              updatedAt: new Date("2026-03-16T10:05:00.000Z"),
              _count: { messages: 3 },
            },
          ]),
        },
        problem: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "problem-1",
              stemText: "",
              stemLatex: "x+1=2",
              subject: "수학",
              unitMajor: "방정식",
            },
          ]),
        },
      };
      const listService = new TutorVisionService(
        prisma as any,
        null as any,
        null as any,
        null as any,
      );

      await expect(listService.listSessions("student-1")).resolves.toEqual([
        {
          id: "session-1",
          problemId: "problem-1",
          status: "active",
          createdAt: "2026-03-16T10:00:00.000Z",
          updatedAt: "2026-03-16T10:05:00.000Z",
          problem: {
            stemText: "x+1=2",
            subject: "수학",
            unitMajor: "방정식",
          },
          _count: { messages: 3 },
        },
      ]);
      expect(prisma.tutorSession.findMany).toHaveBeenCalledWith({
        where: { studentId: "student-1" },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 100,
        select: {
          id: true,
          problemId: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              messages: true,
            },
          },
        },
      });
      expect(prisma.problem.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["problem-1"] } },
        select: {
          id: true,
          stemText: true,
          stemLatex: true,
          subject: true,
          unitMajor: true,
        },
      });
    });

    it("returns an empty array without querying problems when no sessions exist", async () => {
      const prisma = {
        tutorSession: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        problem: {
          findMany: jest.fn(),
        },
      };
      const listService = new TutorVisionService(
        prisma as any,
        null as any,
        null as any,
        null as any,
      );

      await expect(listService.listSessions("student-1")).resolves.toEqual([]);
      expect(prisma.problem.findMany).not.toHaveBeenCalled();
    });
  });

  describe("inferWeaknessSignal", () => {
    it("captures a high-confidence worked-solution signal from image review", () => {
      const signal = service.inferWeaknessSignal(
        {
          id: "problem-1",
          curriculumNodeId: "node-1",
          subject: "수학",
          unitMajor: "방정식",
        },
        "여기서 왜 안 되는지 모르겠어요.",
        "이건 calculation_error 입니다. 계산 실수를 먼저 점검해 봅시다.",
        "canvas/student-1/1.png",
      );

      expect(signal).toEqual(
        expect.objectContaining({
          source: "worked_solution",
          problemId: "problem-1",
          curriculumNodeId: "node-1",
          subject: "수학",
          unitMajor: "방정식",
          errorType: "calculation_error",
        }),
      );
      expect(signal?.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it("creates a tutor-message signal even without explicit error classification", () => {
      const signal = service.inferWeaknessSignal(
        {
          id: "problem-2",
          curriculumNodeId: null,
          subject: "수학",
          unitMajor: "함수",
        },
        "이 부분이 너무 헷갈려요.",
        "먼저 어떤 식을 세워야 하는지 같이 볼까요?",
      );

      expect(signal).toEqual(
        expect.objectContaining({
          source: "tutor_message",
          problemId: "problem-2",
          subject: "수학",
          unitMajor: "함수",
          errorType: null,
        }),
      );
      expect(signal?.confidence).toBeGreaterThan(0.4);
    });
  });
});
