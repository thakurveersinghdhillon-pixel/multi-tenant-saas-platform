import { IsEnum, IsNotEmpty, IsNumber, IsOptional } from "class-validator";
import { TaskStatus } from "@prisma/client";

export class ReorderTaskDto {
  @IsOptional()
  @IsEnum(TaskStatus, {
    message: "Status must be TODO, IN_PROGRESS, IN_REVIEW, or DONE",
  })
  status?: TaskStatus;

  @IsNumber({}, { message: "Position must be a valid number" })
  @IsNotEmpty({ message: "Position is required" })
  position!: number;
}
