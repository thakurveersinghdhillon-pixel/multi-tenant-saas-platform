import { IsOptional, IsUUID } from "class-validator";

export class AssignTaskDto {
  @IsOptional()
  @IsUUID("4", { message: "Assignee ID must be a valid UUID or null" })
  assigneeId?: string | null;
}
