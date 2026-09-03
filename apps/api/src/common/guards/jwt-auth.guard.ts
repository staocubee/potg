import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    // Read from the httpOnly `access_token` cookie (see
    // src/auth/cookie.util.ts) rather than an Authorization header — the
    // whole point of httpOnly is that this app's own JS never sees the
    // token to attach it manually, the browser does that automatically.
    const token: string | undefined = req.cookies?.['access_token'];
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }
    try {
      const payload = this.jwt.verify(token) as { sub: string; email: string; type?: string };
      // Refresh tokens are signed with the same secret (AuthService issues
      // both from one JwtService) but carry type: 'refresh' — reject them
      // here so a leaked refresh token can't be used directly against a
      // protected route, only against POST /auth/refresh.
      if (payload.type !== 'access') {
        throw new UnauthorizedException('Not an access token');
      }
      req.user = { id: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
