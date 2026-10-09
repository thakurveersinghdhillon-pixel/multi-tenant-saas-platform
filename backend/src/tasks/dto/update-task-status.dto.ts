import { IsEnum, IsNotEmpty } from "class-validator";
import { TaskStatus } from "@prisma/client";

export class UpdateTaskStatusDto {
  @IsEnum(TaskStatus, {
    message: "Status must be TODO, IN_PROGRESS, IN_REVIEW, or DONE",
  })
  @IsNotEmpty({ message: "Status is required" })
  status!: TaskStatus;
}
