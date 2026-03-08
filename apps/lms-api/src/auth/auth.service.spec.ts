import { AuthService } from "./auth.service";

jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("hashed-password"),
  compare: jest.fn(),
}));

describe("AuthService", () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
  const jwt = {
    sign: jest.fn().mockReturnValue("signed-token"),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("forces public registration to create student accounts only", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: "user-1",
      email: "student@example.com",
      role: "student",
    });

    const service = new AuthService(prisma as never, jwt as never);

    await service.register({
      email: "student@example.com",
      name: "Student",
      password: "password123",
      role: "teacher" as never,
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "student@example.com",
        name: "Student",
        passwordHash: "hashed-password",
        role: "student",
      }),
    });
  });
});
