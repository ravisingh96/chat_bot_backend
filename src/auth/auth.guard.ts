import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role, UsersService } from '../users/users.service';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

/** Verifies the Bearer token, reloads the user (so deactivation / role changes apply at once) and checks @Roles(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Missing token');

    let payload: { sub: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.users.findById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedException('Account disabled');

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException('Not allowed for your role');

    req.user = { id: user.id, name: user.name, email: user.email, role: user.role } as AuthUser;
    return true;
  }
}
