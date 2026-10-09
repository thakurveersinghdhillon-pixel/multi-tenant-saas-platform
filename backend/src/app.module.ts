import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./database/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { TenancyModule } from "./tenancy/tenancy.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { RbacModule } from "./rbac/rbac.module";
import { ProjectsModule } from "./projects/projects.module";
import { TasksModule } from "./tasks/tasks.module";
import { ActivityModule } from "./activity/activity.module";
import { CommentsModule } from "./comments/comments.module";
import { RedisModule } from "./redis/redis.module";
import { WebSocketModule } from "./websocket/websocket.module";
import { NotificationsModule } from "./notifications/notifications.module";

@Module({
  imports: [
    WebSocketModule,
    NotificationsModule,
    RedisModule,
    PrismaModule,
    TenancyModule,
    HealthModule,
    AuthModule,
    OrganizationsModule,
    RbacModule,
    ProjectsModule,
    TasksModule,
    ActivityModule,
    CommentsModule,
  ],
})
export class AppModule {}
