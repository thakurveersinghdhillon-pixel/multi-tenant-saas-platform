import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export const CurrentOrganization = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const organization = request.organization;
    return data ? organization?.[data] : organization;
  },
);
