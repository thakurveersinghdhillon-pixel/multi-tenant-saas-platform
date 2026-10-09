import { IsEnum, IsNotEmpty } from "class-validator";

export enum RoleEnum {
  OWNER = "OWNER",
  ADMIN = "ADMIN",
  MEMBER = "MEMBER",
  VIEWER = "VIEWER",
}

export class UpdateMemberRoleDto {
  @IsEnum(RoleEnum, {
    message: "Role must be one of OWNER, ADMIN, MEMBER, VIEWER",
  })
  @IsNotEmpty({ message: "Role is required" })
  role!: RoleEnum;
}
