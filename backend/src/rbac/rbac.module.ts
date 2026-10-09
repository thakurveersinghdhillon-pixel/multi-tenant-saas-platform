import { Global, Module } from "@nestjs/common";
import { RbacService } from "./rbac.service";
import { PermissionsGuard } from "./guards/permissions.guard";

@Global()
@Module({
  providers: [RbacService, PermissionsGuard],
  exports: [RbacService, PermissionsGuard],
})
export class RbacModule {}
