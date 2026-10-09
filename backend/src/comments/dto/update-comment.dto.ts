import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class UpdateCommentDto {
  @IsString({ message: "Comment content must be a string" })
  @IsNotEmpty({ message: "Comment content cannot be empty" })
  @MaxLength(5000, { message: "Comment content cannot exceed 5000 characters" })
  content!: string;
}
