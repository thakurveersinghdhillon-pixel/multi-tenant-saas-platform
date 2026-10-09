import { IsEnum, IsNotEmpty } from "class-validator";
import { ProjectRole } from "@prisma/client";

export class UpdateProjectMemberDto {
  @IsEnum(ProjectRole, {
    message:
      "Role must be one of PROJECT_ADMIN, PROJECT_MEMBER, PROJECT_VIEWER",
  })
  @IsNotEmpty({ message: "Role is required" })
  role!: ProjectRole;
}
