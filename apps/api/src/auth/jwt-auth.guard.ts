import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const authorization = request.headers['authorization'];
    const token = authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Token requerido');
    try {
      await this.jwt.verifyAsync(token);
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
