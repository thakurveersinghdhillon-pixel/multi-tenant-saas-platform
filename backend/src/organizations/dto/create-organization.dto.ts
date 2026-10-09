import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty({ message: "Organization name is required" })
  @MinLength(2, {
    message: "Organization name must be at least 2 characters long",
  })
  @MaxLength(100, { message: "Organization name cannot exceed 100 characters" })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: "Organization slug is required" })
  @MaxLength(50, { message: "Organization slug cannot exceed 50 characters" })
  @Matches(/^[a-z0-9-]+$/, {
    message:
      "Slug must contain only lowercase alphanumeric characters and hyphens (e.g. acme-corp)",
  })
  slug!: string;

  @IsString()
  @IsOptional()
  @MaxLength(255, { message: "Description cannot exceed 255 characters" })
  description?: string;
}
