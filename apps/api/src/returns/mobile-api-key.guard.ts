import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';

/**
 * Protects the internal /mobile-returns routes with a shared secret.
 *
 * Rollout-safe: if MOBILE_API_KEY is not configured on the server, the guard
 * allows the request (current behaviour) and logs a warning. Once the env var
 * is set, the `X-API-Key` header must match — so the safe order is:
 *   1. Ship the iOS app sending the key (API still open, ignores it).
 *   2. Set MOBILE_API_KEY in Railway → enforcement turns on, app already sends it.
 */
@Injectable()
export class MobileApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(MobileApiKeyGuard.name);
  private warned = false;

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.MOBILE_API_KEY;
    if (!expected) {
      if (!this.warned) {
        this.logger.warn('MOBILE_API_KEY not set — /mobile-returns routes are UNPROTECTED. Set it to enforce.');
        this.warned = true;
      }
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const provided = req.headers['x-api-key'];
    if (provided !== expected) {
      throw new UnauthorizedException('Clave de API móvil inválida.');
    }
    return true;
  }
}
