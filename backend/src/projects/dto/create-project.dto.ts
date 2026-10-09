import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty({ message: "Project name is required" })
  @MinLength(2, { message: "Project name must be at least 2 characters long" })
  @MaxLength(100, { message: "Project name cannot exceed 100 characters" })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: "Project slug is required" })
  @MinLength(2, { message: "Project slug must be at least 2 characters long" })
  @MaxLength(100, { message: "Project slug cannot exceed 100 characters" })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      "Project slug must contain only lowercase alphanumeric characters and hyphens",
  })
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: "Description cannot exceed 500 characters" })
  description?: string;
}
