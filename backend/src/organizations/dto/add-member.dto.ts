import { IsEmail, IsEnum, IsNotEmpty, IsOptional } from "class-validator";
import { RoleEnum } from "./update-member-role.dto";

export class AddMemberDto {
  @IsEmail({}, { message: "Must be a valid email address" })
  @IsNotEmpty({ message: "Email is required" })
  email!: string;

  @IsOptional()
  @IsEnum(RoleEnum, {
    message: "Role must be one of OWNER, ADMIN, MEMBER, VIEWER",
  })
  role?: RoleEnum = RoleEnum.MEMBER;
}
