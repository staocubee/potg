import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Set by JwtAuthGuard.
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.user;
});

// Set by AccountContextGuard — the acting account membership (role +
// permissions already loaded), i.e. "who the user is being right now"
// given a user can belong to several accounts.
export const CurrentAccountMember = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.accountMember;
});
