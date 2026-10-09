import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  IsDateString,
} from "class-validator";
import { TaskPriority, TaskStatus } from "@prisma/client";

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: "Task title must be at least 2 characters" })
  @MaxLength(150, { message: "Task title cannot exceed 150 characters" })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: "Description cannot exceed 1000 characters" })
  description?: string;

  @IsOptional()
  @IsEnum(TaskStatus, {
    message: "Status must be TODO, IN_PROGRESS, IN_REVIEW, or DONE",
  })
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority, {
    message: "Priority must be LOW, MEDIUM, HIGH, or URGENT",
  })
  priority?: TaskPriority;

  @IsOptional()
  @IsDateString({}, { message: "Due date must be a valid ISO date string" })
  dueDate?: string;
}
