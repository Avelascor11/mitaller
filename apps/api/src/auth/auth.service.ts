import { UnauthorizedException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Credenciales no validas');
    }
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role, email: user.email });
    return { accessToken, user: this.publicUser(user) };
  }

  async me(authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException();
    const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
    return this.publicUser(user);
  }

  private publicUser(user: { id: string; name: string; email: string; role: string }) {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }
}
