import { Module, Global } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "../database/prisma.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { AppWebSocketGateway } from "./websocket.gateway";
import { WebSocketService } from "./websocket.service";

@Global()
@Module({
  imports: [
    PrismaModule,
    TenancyModule,
    JwtModule.register({
      secret:
        process.env.JWT_SECRET || "change_me_local_jwt_secret_key_987654321",
    }),
  ],
  providers: [AppWebSocketGateway, WebSocketService],
  exports: [WebSocketService],
})
export class WebSocketModule {}
