import { GamificationService } from "./gamification.service";
import {
  getAccessibleClassIds,
  getRequesterOrganizationId,
} from "../common/access-control";

jest.mock("../common/access-control", () => ({
  getAccessibleClassIds: jest.fn(),
  getRequesterOrganizationId: jest.fn(),
}));

describe("GamificationService", () => {
  const prisma = {
    user: {
      findMany: jest.fn(),
    },
  };

  let service: GamificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GamificationService(prisma as never);
    prisma.user.findMany.mockResolvedValue([]);
  });

  it("scopes student leaderboard to the requester's enrolled classes", async () => {
    (getAccessibleClassIds as jest.Mock).mockResolvedValue(["class-1", "class-2"]);

    await service.getLeaderboard("student-1", "student");

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: "student",
          enrollments: {
            some: {
              classId: { in: ["class-1", "class-2"] },
            },
          },
        },
        take: 20,
      }),
    );
  });

  it("scopes teacher leaderboard to the requester's organization", async () => {
    (getRequesterOrganizationId as jest.Mock).mockResolvedValue("org-1");

    await service.getLeaderboard("teacher-1", "teacher", undefined, 10);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: "student",
          organizationId: "org-1",
        },
        take: 10,
      }),
    );
  });
});
