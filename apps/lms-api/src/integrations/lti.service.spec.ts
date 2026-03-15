import { UnauthorizedException } from "@nestjs/common";

jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(() => Symbol("jwks")),
  decodeJwt: jest.fn(),
  decodeProtectedHeader: jest.fn(),
  jwtVerify: jest.fn(),
}));

import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
} from "jose";
import { LtiService } from "./lti.service";

describe("LtiService", () => {
  const prisma = {
    ltiPlatform: {
      findUnique: jest.fn(),
    },
    ltiIdentity: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const config = {
    get: jest.fn(),
  };

  const jwt = {
    sign: jest.fn().mockReturnValue("session-token"),
  };

  let service: LtiService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LtiService(prisma as never, config as never, jwt as never);
  });

  it("verifies a launch token and provisions instructor launches as teacher accounts", async () => {
    (decodeProtectedHeader as jest.Mock).mockReturnValue({ alg: "RS256" });
    (decodeJwt as jest.Mock).mockReturnValue({ iss: "https://platform.example" });
    prisma.ltiPlatform.findUnique.mockResolvedValue({
      id: "platform-1",
      issuer: "https://platform.example",
      clientId: "client-1",
      jwksUri: "https://platform.example/.well-known/jwks.json",
      deploymentId: "deployment-1",
      isActive: true,
      name: "Canvas",
    });
    (jwtVerify as jest.Mock).mockResolvedValue({
      payload: {
        iss: "https://platform.example",
        sub: "lti-user-1",
        email: "teacher@example.com",
        name: "Teacher Kim",
        nonce: "nonce-1",
        "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
        "https://purl.imsglobal.org/spec/lti/claim/message_type":
          "LtiResourceLinkRequest",
        "https://purl.imsglobal.org/spec/lti/claim/deployment_id":
          "deployment-1",
        "https://purl.imsglobal.org/spec/lti/claim/roles": [
          "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor",
        ],
        "https://purl.imsglobal.org/spec/lti/claim/context": { id: "ctx-1" },
        "https://purl.imsglobal.org/spec/lti/claim/resource_link": {
          id: "resource-1",
        },
      },
    });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: "user-1",
      email: "teacher@example.com",
      role: "teacher",
      name: "Teacher Kim",
    });
    prisma.ltiIdentity.findUnique.mockResolvedValue(null);

    const result = await service.handleLaunch("header.payload.signature");

    expect(createRemoteJWKSet).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "https://platform.example/.well-known/jwks.json",
      }),
    );
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "teacher@example.com",
          role: "teacher",
        }),
      }),
    );
    expect(prisma.ltiIdentity.create).toHaveBeenCalledWith({
      data: {
        platformId: "platform-1",
        userId: "user-1",
        subject: "lti-user-1",
        email: "teacher@example.com",
      },
    });
    expect(jwt.sign).toHaveBeenCalledWith(
      { sub: "user-1", email: "teacher@example.com", role: "teacher" },
      { expiresIn: "1h" },
    );
    expect(result).toEqual({
      sessionToken: "session-token",
      userId: "user-1",
      contextId: "ctx-1",
      resourceLinkId: "resource-1",
    });
  });

  it("rejects launches when required LTI claims are missing", async () => {
    (decodeProtectedHeader as jest.Mock).mockReturnValue({ alg: "RS256" });
    (decodeJwt as jest.Mock).mockReturnValue({ iss: "https://platform.example" });
    prisma.ltiPlatform.findUnique.mockResolvedValue({
      id: "platform-1",
      issuer: "https://platform.example",
      clientId: "client-1",
      jwksUri: "https://platform.example/.well-known/jwks.json",
      deploymentId: "deployment-1",
      isActive: true,
      name: "Canvas",
    });
    (jwtVerify as jest.Mock).mockResolvedValue({
      payload: {
        iss: "https://platform.example",
        sub: "lti-user-1",
        nonce: "nonce-1",
        "https://purl.imsglobal.org/spec/lti/claim/version": "1.2.0",
        "https://purl.imsglobal.org/spec/lti/claim/message_type":
          "LtiResourceLinkRequest",
      },
    });

    await expect(service.handleLaunch("header.payload.signature")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("rejects launches that collide with an unlinked local account", async () => {
    (decodeProtectedHeader as jest.Mock).mockReturnValue({ alg: "RS256" });
    (decodeJwt as jest.Mock).mockReturnValue({ iss: "https://platform.example" });
    prisma.ltiPlatform.findUnique.mockResolvedValue({
      id: "platform-1",
      issuer: "https://platform.example",
      clientId: "client-1",
      jwksUri: "https://platform.example/.well-known/jwks.json",
      deploymentId: "deployment-1",
      isActive: true,
      name: "Canvas",
    });
    (jwtVerify as jest.Mock).mockResolvedValue({
      payload: {
        iss: "https://platform.example",
        sub: "lti-user-2",
        email: "teacher@example.com",
        name: "Teacher Kim",
        nonce: "nonce-2",
        "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
        "https://purl.imsglobal.org/spec/lti/claim/message_type":
          "LtiResourceLinkRequest",
        "https://purl.imsglobal.org/spec/lti/claim/deployment_id":
          "deployment-1",
      },
    });
    prisma.ltiIdentity.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: "existing-user",
      email: "teacher@example.com",
      role: "teacher",
    });

    await expect(service.handleLaunch("header.payload.signature")).rejects.toThrow(
      "Local account linking is required",
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.ltiIdentity.create).not.toHaveBeenCalled();
  });

  it("reuses the stored LTI identity instead of relinking by email", async () => {
    (decodeProtectedHeader as jest.Mock).mockReturnValue({ alg: "RS256" });
    (decodeJwt as jest.Mock).mockReturnValue({ iss: "https://platform.example" });
    prisma.ltiPlatform.findUnique.mockResolvedValue({
      id: "platform-1",
      issuer: "https://platform.example",
      clientId: "client-1",
      jwksUri: "https://platform.example/.well-known/jwks.json",
      deploymentId: "deployment-1",
      isActive: true,
      name: "Canvas",
    });
    (jwtVerify as jest.Mock).mockResolvedValue({
      payload: {
        iss: "https://platform.example",
        sub: "lti-user-1",
        email: "teacher@example.com",
        name: "Teacher Kim",
        nonce: "nonce-3",
        "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
        "https://purl.imsglobal.org/spec/lti/claim/message_type":
          "LtiResourceLinkRequest",
        "https://purl.imsglobal.org/spec/lti/claim/deployment_id":
          "deployment-1",
        "https://purl.imsglobal.org/spec/lti/claim/roles": [
          "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
        ],
      },
    });
    prisma.ltiIdentity.findUnique.mockResolvedValue({
      id: "identity-1",
      email: "teacher@example.com",
      user: {
        id: "user-1",
        email: "teacher@example.com",
        role: "student",
        name: "Old Name",
      },
    });
    prisma.user.update.mockResolvedValue({
      id: "user-1",
      email: "teacher@example.com",
      role: "student",
      name: "Teacher Kim",
    });

    const result = await service.handleLaunch("header.payload.signature");

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.ltiIdentity.create).not.toHaveBeenCalled();
    expect(result.userId).toBe("user-1");
  });
});
