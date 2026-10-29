import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class MarketingAdminGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly db: PrismaService) {}
  async canActivate(ctx: ExecutionContext) {
    const header = ctx.switchToHttp().getRequest().headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw new UnauthorizedException();
    let sub: string;
    try { const payload = await this.jwt.verifyAsync(header.slice(7)); if (typeof payload.sub !== 'string') throw new Error(); sub = payload.sub; } catch { throw new UnauthorizedException(); }
    const user = await this.db.user.findUnique({ where: { id: sub }, select: { role: true } });
    if (!user) throw new UnauthorizedException();
    if (user.role !== 'ADMIN') throw new ForbiddenException('El portal de marketing requiere acceso de administrador.');
    return true;
  }
}
