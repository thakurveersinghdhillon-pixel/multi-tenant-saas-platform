import { IsEmail, IsNotEmpty, IsString, MaxLength } from "class-validator";
import { Transform } from "class-transformer";

export class LoginDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: "Invalid email address" })
  @IsNotEmpty({ message: "Email is required" })
  @MaxLength(255, { message: "Email must not exceed 255 characters" })
  email!: string;

  @IsString({ message: "Password must be a string" })
  @IsNotEmpty({ message: "Password is required" })
  @MaxLength(128, { message: "Password must not exceed 128 characters" })
  password!: string;
}
