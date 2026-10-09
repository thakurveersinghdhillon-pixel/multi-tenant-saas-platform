import { Test, TestingModule } from "@nestjs/testing";
import { HealthController } from "./health.controller";
import { PrismaService } from "../database/prisma.service";

describe("HealthController", () => {
  let controller: HealthController;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("check", () => {
    it("should return status ok and database connected", async () => {
      const result = await controller.check();
      expect(result).toEqual({ status: "ok", database: "connected" });
    });

    it("should handle database errors gracefully", async () => {
      jest
        .spyOn(prismaService, "$queryRaw")
        .mockRejectedValueOnce(new Error("DB Error"));
      const result = await controller.check();
      expect(result).toEqual({ status: "ok", database: "error" });
    });
  });
});
