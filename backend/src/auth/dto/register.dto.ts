import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
} from "class-validator";
import { Transform } from "class-transformer";

export class RegisterDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: "Invalid email address" })
  @IsNotEmpty({ message: "Email is required" })
  @MaxLength(255, { message: "Email must not exceed 255 characters" })
  email!: string;

  @IsString({ message: "Password must be a string" })
  @IsNotEmpty({ message: "Password is required" })
  @MinLength(8, { message: "Password must be at least 8 characters long" })
  @MaxLength(128, { message: "Password must not exceed 128 characters" })
  password!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString({ message: "First name must be a string" })
  @IsNotEmpty({ message: "First name is required" })
  @MaxLength(50, { message: "First name must not exceed 50 characters" })
  firstName!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString({ message: "Last name must be a string" })
  @IsNotEmpty({ message: "Last name is required" })
  @MaxLength(50, { message: "Last name must not exceed 50 characters" })
  lastName!: string;
}
