import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpException, Injectable, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { escapeHtml as e } from './marketing.domain';
import { MarketingAdminGuard } from './marketing.guard';
import { MarketingService } from './marketing.service';

type Payload = Record<string, any>;

@Controller('marketing')
@UseGuards(MarketingAdminGuard)
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}
  @Get('overview') overview() { return this.marketing.overview(); }
  @Get('settings') settings() { return this.marketing.settings(); }

  @Get('contacts') contacts(@Query('search') search?: string, @Query('page') page?: string, @Query('status') status?: string) { return this.marketing.contacts(search ?? '', Number(page) || 1, status ?? ''); }
  @Get('contacts/:id') contact(@Param('id') id: string) { return this.marketing.contact(id); }
  @Post('contacts') saveContact(@Body() body: Payload) { return this.marketing.saveContact(body); }
  @Post('contacts/import') importContacts(@Body() body: Payload) { return this.marketing.importContacts(body); }
  @Post('contacts/:id/unsubscribe') suppress(@Param('id') id: string) { return this.marketing.suppress(id); }
  @Delete('contacts/:id') deleteContact(@Param('id') id: string) { return this.marketing.deleteContact(id); }

  @Get('segments') segments() { return this.marketing.segments(); }
  @Post('segments/preview') segmentPreview(@Body() body: Payload) { return this.marketing.segmentPreview(body); }
  @Post('segments') createSegment(@Body() body: Payload) { return this.marketing.saveSegment(body); }
  @Put('segments/:id') updateSegment(@Param('id') id: string, @Body() body: Payload) { return this.marketing.saveSegment(body, id); }
  @Delete('segments/:id') deleteSegment(@Param('id') id: string) { return this.marketing.deleteSegment(id); }

  @Get('templates') templates() { return this.marketing.templates(); }
  @Post('templates') createTemplate(@Body() body: Payload) { return this.marketing.saveTemplate(body); }
  @Put('templates/:id') updateTemplate(@Param('id') id: string, @Body() body: Payload) { return this.marketing.saveTemplate(body, id); }
  @Delete('templates/:id') deleteTemplate(@Param('id') id: string) { return this.marketing.deleteTemplate(id); }
  @Post('preview') preview(@Body() body: Payload) { return this.marketing.preview(body); }
  @Post('test') sendTest(@Body() body: Payload) { return this.marketing.sendTest(body); }

  @Get('audience') audience(@Query('segmentId') segmentId?: string) { return this.marketing.audienceCount(segmentId || null).then(count => ({ count })); }
  @Get('campaigns') campaigns() { return this.marketing.campaigns(); }
  @Get('campaigns/:id') campaign(@Param('id') id: string) { return this.marketing.campaign(id); }
  @Post('campaigns') createCampaign(@Body() body: Payload) { return this.marketing.saveCampaign(body); }
  @Put('campaigns/:id') updateCampaign(@Param('id') id: string, @Body() body: Payload) { return this.marketing.saveCampaign(body, id); }
  @Post('campaigns/:id/launch') launch(@Param('id') id: string, @Body() body: Payload) { return this.marketing.launch(id, body); }
  @Post('campaigns/:id/cancel') cancel(@Param('id') id: string) { return this.marketing.cancel(id); }
  @Post('campaigns/:id/duplicate') duplicate(@Param('id') id: string) { return this.marketing.duplicateCampaign(id); }
  @Delete('campaigns/:id') deleteCampaign(@Param('id') id: string) { return this.marketing.deleteCampaign(id); }
  @Post('messages/:id/retry') retry(@Param('id') id: string) { return this.marketing.retryMessage(id); }

  @Get('flows') flows() { return this.marketing.flows(); }
  @Post('flows') createFlow(@Body() body: Payload) { return this.marketing.saveFlow(body); }
  @Put('flows/:id') updateFlow(@Param('id') id: string, @Body() body: Payload) { return this.marketing.saveFlow(body, id); }
  @Post('flows/:id/status') flowStatus(@Param('id') id: string, @Body() body: Payload) { return this.marketing.flowStatus(id, body.live === true); }
  @Delete('flows/:id') deleteFlow(@Param('id') id: string) { return this.marketing.deleteFlow(id); }
  @Get('events') events() { return this.marketing.events(); }

  @Get('forms') forms() { return this.marketing.forms(); }
  @Post('forms') createForm(@Body() body: Payload) { return this.marketing.saveForm(body); }
  @Put('forms/:id') updateForm(@Param('id') id: string, @Body() body: Payload) { return this.marketing.saveForm(body, id); }

  @Get('klaviyo/import') klaviyoStatus() { return this.marketing.klaviyoImportStatus(); }
  @Post('klaviyo/import') klaviyoImport(@Body() body: Payload) { return this.marketing.importFromKlaviyo(body ?? {}); }
  @Post('import/package') importPackage(@Body() body: Payload) { return this.marketing.importPackage(body ?? {}); }
}

/** Railway sits in front of the API; key public rate limits by the client address its proxy appended. */
@Injectable()
export class MarketingThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>) {
    const forwarded = String(req.headers?.['x-forwarded-for'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
    return forwarded[forwarded.length - 1] || req.ip;
  }
}

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
function page(title: string, body: string) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${e(title)}</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f0;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#202320;padding:20px}
.card{background:#fff;max-width:440px;width:100%;padding:32px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.06)}.brand{font:800 13px Arial;letter-spacing:3px;margin-bottom:18px}
h1{font-size:26px;line-height:1.2;margin:0 0 10px}p{color:#495048;margin:0 0 18px}input[type=email],input[type=text]{width:100%;padding:13px 14px;border:1.5px solid #dfe3da;border-radius:10px;font:inherit;margin-bottom:12px}
label.check{display:flex;gap:10px;font-size:13px;color:#495048;margin:4px 0 16px;align-items:flex-start}button{width:100%;padding:14px;border:0;border-radius:10px;background:#bcea65;color:#202320;font:700 15px Arial;cursor:pointer}
.hp{position:absolute;left:-9999px}.muted{font-size:12px;color:#73796f}</style></head><body><main class="card"><div class="brand">SPEEDWEAR</div>${body}</main></body></html>`;
}
function message(res: Response, title: string, text: string, status = 200) { res.status(status).type('html').send(page(title, `<h1>${e(title)}</h1><p>${e(text)}</p>`)); }
function wantsJson(req: Request) { return (req.headers.accept ?? '').includes('application/json') || (req.headers['content-type'] ?? '').includes('application/json'); }

@Controller('marketing/public')
export class MarketingPublicController {
  constructor(private readonly marketing: MarketingService) {}

  @Get('forms/:id')
  async form(@Param('id') id: string, @Res() res: Response) {
    try {
      const form = await this.marketing.publicForm(id);
      res.type('html').send(page(form.headline, `<h1>${e(form.headline)}</h1><p>${e(form.description)}</p><form method="post" action="${e(id)}/subscribe">
<input type="email" name="email" placeholder="tu@email.com" required autocomplete="email"><input type="text" name="firstName" placeholder="Nombre (opcional)" autocomplete="given-name">
<input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"><label class="check"><input type="checkbox" name="consent" value="yes" required><span>Acepto recibir novedades y ofertas de Speedwear por email. Puedo darme de baja en cualquier momento.</span></label>
<button type="submit">${e(form.buttonText)}</button></form><p class="muted">Te enviaremos un email para confirmar la suscripción.</p>`));
    } catch { message(res, 'Formulario no disponible', 'Este formulario no está activo ahora mismo.', 404); }
  }

  @Post('forms/:id/subscribe')
  @UseGuards(MarketingThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async subscribe(@Param('id') id: string, @Body() body: Payload, @Req() req: Request, @Res() res: Response) {
    try {
      const result = await this.marketing.subscribe(id, body ?? {});
      if (wantsJson(req)) res.json(result);
      else message(res, 'Revisa tu email', 'Te hemos enviado un enlace para confirmar la suscripción. Si no lo ves, mira en promociones o spam.');
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 500;
      const text = err instanceof HttpException ? String((err.getResponse() as { message?: unknown }).message ?? err.message) : 'No hemos podido completar la suscripción.';
      if (wantsJson(req)) res.status(status).json({ message: text });
      else message(res, 'No se ha podido completar', text, status);
    }
  }

  // Confirmation and unsubscribe links render a button first: link scanners only issue GETs.
  @Get('confirm/:token')
  confirmPage(@Param('token') token: string, @Res() res: Response) {
    res.type('html').send(page('Confirma tu suscripción', `<h1>Confirma tu suscripción</h1><p>Pulsa el botón para empezar a recibir novedades y ofertas de Speedwear.</p><form method="post" action="${e(token)}"><button type="submit">Confirmar suscripción</button></form>`));
  }
  @Post('confirm/:token')
  @UseGuards(MarketingThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async confirm(@Param('token') token: string, @Res() res: Response) {
    try { await this.marketing.confirm(token); message(res, '¡Ya estás dentro!', 'Tu suscripción está confirmada. Pronto tendrás noticias nuestras.'); } catch { message(res, 'Enlace caducado', 'Este enlace ya no es válido. Vuelve a suscribirte desde el formulario.', 400); }
  }
  @Get('unsubscribe/:token')
  unsubscribePage(@Param('token') token: string, @Query('m') m: string | undefined, @Res() res: Response) {
    res.type('html').send(page('Cancelar suscripción', `<h1>¿Quieres darte de baja?</h1><p>Dejarás de recibir emails de marketing de Speedwear. Seguirás recibiendo los avisos de tus pedidos y devoluciones.</p><form method="post" action="${e(token)}${m ? `?m=${encodeURIComponent(m)}` : ''}"><button type="submit">Darme de baja</button></form>`));
  }
  /** Also the RFC 8058 one-click endpoint used by Gmail/Apple Mail. */
  @Post('unsubscribe/:token')
  async unsubscribe(@Param('token') token: string, @Query('m') m: string | undefined, @Res() res: Response) {
    try { await this.marketing.unsubscribe(token, typeof m === 'string' ? m.slice(0, 64) : undefined); message(res, 'Baja completada', 'No volverás a recibir emails de marketing de Speedwear.'); } catch { message(res, 'Enlace no válido', 'No hemos encontrado esta suscripción.', 404); }
  }

  @Get('open/:token')
  async open(@Param('token') token: string, @Res() res: Response) {
    await this.marketing.track(token, 'open').catch(() => null);
    res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0' }).send(gif);
  }
  @Get('click/:token/:index')
  async click(@Param('token') token: string, @Param('index') index: string, @Res() res: Response) {
    const url = await this.marketing.track(token, 'click', Math.max(0, Math.min(100, Number(index) || 0))).catch(() => null);
    if (typeof url === 'string') res.redirect(302, url);
    else message(res, 'Enlace no disponible', 'Este enlace ha caducado. Visita speedwear.es.', 404);
  }

  @Post('activity')
  @UseGuards(MarketingThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  activity(@Body() body: Payload) { return this.marketing.activity(body ?? {}); }

  /** Paste in theme.liquid; on product pages define window.SWM_PRODUCT first (see docs/env.md). Reports product views and add-to-cart. */
  @Get('onsite.js')
  onsite(@Res() res: Response) {
    const api = JSON.stringify(`${this.marketing.settings().publicApiUrl}/marketing/public/activity`);
    res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }).send(`(function(){try{var k='swm',q=new URLSearchParams(location.search).get(k);if(q&&/^[0-9a-f-]{36}$/.test(q))localStorage.setItem(k,q);var t=localStorage.getItem(k);if(!t)return;function send(type,p){if(!p||!p.id)return;fetch(${api},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t,type:type,product:p}),keepalive:true}).catch(function(){})}send('Viewed Product',window.SWM_PRODUCT);function added(){send('Added to Cart',window.SWM_PRODUCT)}var f=window.fetch;window.fetch=function(u){try{if(String(u&&u.url||u).indexOf('/cart/add')>-1)added()}catch(e){}return f.apply(this,arguments)};document.addEventListener('submit',function(e){var a=e.target&&e.target.getAttribute&&e.target.getAttribute('action')||'';if(a.indexOf('/cart/add')>-1)added()},true)}catch(e){}})();`);
  }
}

function readText(req: Request, limit = 256 * 1024) {
  return new Promise<string>((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > limit) { reject(new BadRequestException('Cuerpo demasiado grande.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

@Controller('marketing/integrations')
export class MarketingIntegrationController {
  constructor(private readonly marketing: MarketingService) {}
  @Post('events') event(@Headers('x-marketing-secret') secret: string | undefined, @Body() body: Payload) { return this.marketing.integrationEvent(secret, body ?? {}); }
  @Post('feedback') feedback(@Headers('x-marketing-secret') secret: string | undefined, @Body() body: Payload) { return this.marketing.integrationFeedback(secret, body ?? {}); }
  /** Amazon SNS posts text/plain, which no body parser consumes, so the stream is read here. */
  @Post('ses/:secret')
  async ses(@Param('secret') secret: string, @Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody?.toString('utf8') ?? (req.readable ? await readText(req) : JSON.stringify(req.body ?? {}));
    return this.marketing.sesNotification(secret, raw);
  }
  @Post('shopify')
  shopify(@Headers('x-shopify-topic') topic: string | undefined, @Headers('x-shopify-hmac-sha256') hmac: string | undefined, @Req() req: Request & { rawBody?: Buffer }, @Body() body: unknown) {
    return this.marketing.shopifyWebhook(topic, hmac, req.rawBody, body);
  }
}
