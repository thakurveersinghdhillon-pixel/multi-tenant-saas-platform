import { IsNotEmpty, IsUUID } from "class-validator";

export class LeaveProjectDto {
  @IsNotEmpty()
  @IsUUID()
  organizationId: string;

  @IsNotEmpty()
  @IsUUID()
  projectId: string;
}
