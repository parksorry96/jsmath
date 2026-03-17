import { AuthService } from "./auth.service";

jest.mock("jose", () => ({}));
jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("hashed-password"),
  compare: jest.fn(),
}));

describe("AuthService", () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const jwt = {
    sign: jest.fn().mockReturnValue("signed-token"),
  };
  const config = {
    getOrThrow: jest.fn().mockReturnValue("test-value"),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("always creates student accounts on public registration", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: "user-1",
      email: "student@example.com",
      role: "student",
    });

    const service = new AuthService(prisma as never, jwt as never, config as never);

    await service.register({
      email: "student@example.com",
      name: "Student",
      password: "password123",
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

  it("does not auto-link existing accounts for unverified social email claims", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "user-1", email: "student@example.com", role: "student" });
    prisma.user.create.mockResolvedValue({
      id: "new-user",
      email: "google_google-user-1@social.jsmath.local",
      role: "student",
    });

    const service = new AuthService(prisma as never, jwt as never, config as never);
    jest.spyOn(service as any, "verifySocialToken").mockResolvedValue({
      provider: "google",
      providerAccountId: "google-user-1",
      email: "student@example.com",
      emailVerified: false,
      name: "Student",
    });

    await service.socialLogin({
      provider: "google",
      accessToken: "provider-access-token",
    });

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "google_google-user-1@social.jsmath.local",
        provider: "google",
        providerAccountId: "google-user-1",
      }),
    });
  });
});
