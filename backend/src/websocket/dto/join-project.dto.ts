import { IsNotEmpty, IsUUID } from "class-validator";

export class JoinProjectDto {
  @IsNotEmpty()
  @IsUUID()
  organizationId: string;

  @IsNotEmpty()
  @IsUUID()
  projectId: string;
}
