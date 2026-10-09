import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check() {
    let dbStatus = "disconnected";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbStatus = "connected";
    } catch {
      dbStatus = "error";
    }

    return {
      status: "ok",
      database: dbStatus,
    };
  }
}
