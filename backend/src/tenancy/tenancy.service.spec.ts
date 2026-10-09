import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { TenancyService } from "./tenancy.service";
import { PrismaService } from "../database/prisma.service";

describe("TenancyService (Unit)", () => {
  let service: TenancyService;

  const mockPrismaService = {
    organizationMember: {
      findUnique: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenancyService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<TenancyService>(TenancyService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should throw BadRequestException if X-Organization-Id is missing", async () => {
    await expect(
      service.validateAndGetTenantContext("user-1", ""),
    ).rejects.toThrow(BadRequestException);
  });

  it("should throw BadRequestException if X-Organization-Id is not a valid UUID", async () => {
    await expect(
      service.validateAndGetTenantContext("user-1", "invalid-uuid-string"),
    ).rejects.toThrow(BadRequestException);
  });

  it("should throw NotFoundException if organization does not exist in DB", async () => {
    const validUuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce(null);
    mockPrismaService.organization.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.validateAndGetTenantContext("user-1", validUuid),
    ).rejects.toThrow(NotFoundException);
  });

  it("should throw ForbiddenException if organization exists but user is not a member", async () => {
    const validUuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce(null);
    mockPrismaService.organization.findUnique.mockResolvedValueOnce({
      id: validUuid,
    });

    await expect(
      service.validateAndGetTenantContext("user-1", validUuid),
    ).rejects.toThrow(ForbiddenException);
  });

  it("should return tenant context if user is an active member", async () => {
    const validUuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const mockMembership = {
      organizationId: validUuid,
      userId: "user-1",
      organization: { id: validUuid, name: "Acme", slug: "acme" },
      role: { name: "OWNER" },
    };

    mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce(
      mockMembership,
    );

    const result = await service.validateAndGetTenantContext(
      "user-1",
      validUuid,
    );
    expect(result.organizationId).toBe(validUuid);
    expect(result.role.name).toBe("OWNER");
  });
});
