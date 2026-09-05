import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ProfessionalAuthUser } from './professional.types';

/** Injects the authenticated professional: `@CurrentProfessional() pro`. */
export const CurrentProfessional = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ProfessionalAuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.professional as ProfessionalAuthUser;
  },
);
