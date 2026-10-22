import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class LogoutDto {
  @IsString({ message: "Refresh token must be a string" })
  @IsNotEmpty({ message: "Refresh token is required" })
  @MaxLength(256, { message: "Refresh token must not exceed 256 characters" })
  refreshToken!: string;
}
