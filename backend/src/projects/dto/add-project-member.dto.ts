import { IsEmail, IsEnum, IsNotEmpty, IsOptional } from "class-validator";
import { ProjectRole } from "@prisma/client";

export class AddProjectMemberDto {
  @IsEmail({}, { message: "Must be a valid email address" })
  @IsNotEmpty({ message: "Email is required" })
  email!: string;

  @IsOptional()
  @IsEnum(ProjectRole, {
    message:
      "Role must be one of PROJECT_ADMIN, PROJECT_MEMBER, PROJECT_VIEWER",
  })
  role?: ProjectRole = ProjectRole.PROJECT_MEMBER;
}
