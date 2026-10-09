import { Module, Global } from "@nestjs/common";
import { PrismaModule } from "../database/prisma.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { RedisModule } from "../redis/redis.module";
import { WebSocketModule } from "../websocket/websocket.module";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";

@Global()
@Module({
  imports: [PrismaModule, TenancyModule, RedisModule, WebSocketModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
