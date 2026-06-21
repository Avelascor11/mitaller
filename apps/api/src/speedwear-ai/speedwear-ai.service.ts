import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollabStatus, OperationalStatus, PriorityLevel, PurchaseNeedStatus, ShipmentStatus } from '@prisma/client';
import { MetaService } from '../meta/meta.service';
import { PrismaService } from '../prisma/prisma.service';

export interface SpeedwearAiQuestionDto {
  question?: string;
}

type SpeedwearDomain = 'GENERAL' | 'META_ADS' | 'ORDERS' | 'PURCHASING' | 'STOCK' | 'SHIPPING' | 'INFLUENCERS' | 'ECONOMICS';

@Injectable()
export class SpeedwearAiService {
  private readonly logger = new Logger(SpeedwearAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaService,
    private readonly config: ConfigService
  ) {}

  async ask(body: SpeedwearAiQuestionDto) {
    const question = body?.question?.trim();
    if (!question) throw new BadRequestException('Escribe una pregunta para IA Speedwear');

    const domain = this.classify(question);
    const context = await this.buildContext();
    const history = await this.chat(12).catch(() => []);
    const metaAdvisor = domain === 'META_ADS'
      ? await this.meta.advisor({ question, from: context.today, to: context.today }).catch((error) => ({ error: (error as Error).message }))
      : null;
    const answer = this.hasOpenAi()
      ? await this.askOpenAI(domain, question, context, history, metaAdvisor)
      : await this.askBusiness(domain, question, context, metaAdvisor);

    await this.saveExchange(question, answer);
    return answer;
  }

  async chat(limit = 30) {
    const rows = await this.prisma.speedwearAiChatMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(80, Number(limit) || 30))
    });
    return rows.reverse().map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      answer: row.answerJson,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async contextSnapshot() {
    return this.buildContext();
  }

  private async askBusiness(
    domain: SpeedwearDomain,
    question: string,
    context: Awaited<ReturnType<SpeedwearAiService['buildContext']>>,
    metaAdvisor?: unknown
  ) {
    if (domain === 'META_ADS' && metaAdvisor && !('error' in (metaAdvisor as object))) {
      return {
        ...(metaAdvisor as object),
        domain: 'META_ADS',
        title: 'Meta Ads',
        permissions: ['Leer campañas', 'Leer recomendaciones', 'Previsualizar cambios', 'Aplicar acciones de Meta con confirmación'],
        routedTo: 'Meta Ads'
      };
    }
    const domainLabel = this.domainLabel(domain);
    const headline = this.headlineFor(domain, context);
    const nextActions = this.nextActionsFor(domain, context);

    return {
      from: context.today,
      to: context.today,
      question,
      domain,
      title: domainLabel,
      routedTo: domainLabel,
      headline,
      answer: this.answerFor(domain, question, context),
      confidence: 'MEDIUM',
      nextActions,
      metrics: this.metricsFor(domain, context),
      campaigns: [],
      suggestedQuestions: [
        '¿Qué hago primero hoy?',
        '¿Qué pedidos me están quemando?',
        '¿Qué tengo que comprar?',
        '¿Vamos bien de caja?',
        '¿Qué influs tengo que perseguir?'
      ],
      actionSuggestions: [],
      permissions: [
        'Modo fallback: falta OPENAI_API_KEY para conversación real',
        'Leer pedidos Shopify importados',
        'Leer compras recomendadas',
        'Leer stock y albaranes',
        'Leer envíos y finalizados',
        'Leer caja/banco',
        'Leer influs y colaboraciones',
        'Aplicar acciones solo cuando exista botón de confirmación'
      ]
    };
  }

  private async askOpenAI(
    domain: SpeedwearDomain,
    question: string,
    context: Awaited<ReturnType<SpeedwearAiService['buildContext']>>,
    history: Array<{ role: string; text: string; answer?: unknown }>,
    metaAdvisor: unknown
  ) {
    const key = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!key) return this.askBusiness(domain, question, context, metaAdvisor);

    const model = this.config.get<string>('OPENAI_MODEL')?.trim() || 'gpt-4.1-mini';
    const baseUrl = this.config.get<string>('OPENAI_BASE_URL')?.trim() || 'https://api.openai.com/v1';
    const payload = {
      model,
      input: [
        {
          role: 'system',
          content: [
            'Eres IA SPEEDWEAR, el copiloto operativo de Speedwear.',
            'Hablas en español de España, directo, cercano y con criterio de negocio.',
            'No respondas como plantilla. Continúa la conversación y ten en cuenta el historial.',
            'Usa los datos reales del contexto. Si falta un dato, dilo claro y propón cómo resolverlo.',
            'Puedes aconsejar sobre pedidos, compras, stock, envíos, caja, influs y Meta Ads.',
            'No inventes importes, pedidos, campañas ni saldos.',
            'Para acciones reales, solo propone actionSuggestions cuando vengan ya preparadas en el contexto; no inventes targetIds.',
            'Devuelve solo JSON válido con el schema pedido.'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            question,
            detectedDomain: domain,
            businessContext: context,
            recentChat: history.map((item) => ({
              role: item.role,
              text: item.text,
              answerHeadline: (item.answer as { headline?: string } | undefined)?.headline,
              answerText: (item.answer as { answer?: string } | undefined)?.answer
            })),
            metaAdvisor
          })
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'speedwear_ai_answer',
          strict: true,
          schema: this.openAiAnswerSchema()
        }
      },
      max_output_tokens: 1800
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const raw = await response.text();
      if (!response.ok) {
        this.logger.warn(`OpenAI ${response.status}: ${raw.slice(0, 500)}`);
        return this.openAiUnavailableAnswer(domain, question, context, `OpenAI ${response.status}`);
      }
      const json = JSON.parse(raw) as Record<string, unknown>;
      const content = this.extractOpenAiText(json);
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return this.normalizeOpenAiAnswer(domain, question, context, parsed, metaAdvisor);
    } catch (error) {
      this.logger.warn(`No se pudo generar respuesta conversacional: ${(error as Error).message}`);
      return this.openAiUnavailableAnswer(domain, question, context, (error as Error).message);
    }
  }

  private async buildContext() {
    const todayDate = new Date();
    const today = todayDate.toISOString().slice(0, 10);
    const start = new Date(today);
    const tomorrow = new Date(start);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const pendingStatuses = [
      OperationalStatus.NEW,
      OperationalStatus.WAITING_STOCK,
      OperationalStatus.WAITING_PRODUCTION,
      OperationalStatus.IN_PRODUCTION,
      OperationalStatus.PRODUCED,
      OperationalStatus.WAITING_PICKING,
      OperationalStatus.PICKED,
      OperationalStatus.BLOCKED
    ];

    const [
      pendingOrders,
      criticalOrders,
      blockedOrders,
      oldPendingOrders,
      readyForShipping,
      labelsCreated,
      shippedToday,
      openPurchaseNeeds,
      purchaseQuantity,
      lowStockItems,
      supplierDrafts,
      bankAccounts,
      openInfluencers,
      awaitingContent,
      fixedExpenses,
      topCriticalOrders,
      topPurchaseNeeds,
      recentFinalized,
      supplierOrders
    ] = await Promise.all([
      this.prisma.order.count({ where: { operationalStatus: { in: pendingStatuses } } }),
      this.prisma.order.count({ where: { operationalStatus: { in: pendingStatuses }, priorityLevel: PriorityLevel.CRITICAL } }),
      this.prisma.order.count({ where: { operationalStatus: { in: pendingStatuses }, OR: [{ priorityLevel: PriorityLevel.BLOCKED }, { operationalStatus: OperationalStatus.BLOCKED }, { operationalStatus: OperationalStatus.WAITING_STOCK }] } }),
      this.prisma.order.count({ where: { operationalStatus: { in: pendingStatuses }, orderedAt: { lt: new Date(todayDate.getTime() - 72 * 60 * 60 * 1000) } } }),
      this.prisma.order.count({ where: { operationalStatus: OperationalStatus.READY_FOR_LABEL } }),
      this.prisma.shipment.count({ where: { status: ShipmentStatus.LABEL_CREATED } }),
      this.prisma.shipment.count({ where: { status: { in: [ShipmentStatus.PRINTED, ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED] }, updatedAt: { gte: start, lt: tomorrow } } }),
      this.prisma.purchaseNeed.count({ where: { status: PurchaseNeedStatus.OPEN, recommendedPurchaseQuantity: { gt: 0 } } }),
      this.prisma.purchaseNeed.aggregate({ _sum: { recommendedPurchaseQuantity: true }, where: { status: PurchaseNeedStatus.OPEN, recommendedPurchaseQuantity: { gt: 0 } } }),
      this.prisma.stockLevel.count({ where: { quantity: { lte: 0 }, stockItem: { type: { in: ['BLANK_GARMENT', 'TRANSFER'] } } } }),
      this.prisma.supplierPurchaseOrder.count({ where: { status: { in: ['DRAFT', 'READY', 'ERROR'] } } }),
      this.prisma.bankAccount.findMany({ select: { name: true, iban: true, currentBalance: true, availableBalance: true, currency: true, balanceUpdatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 4 }),
      this.prisma.influencer.count({ where: { stage: { in: ['PROSPECT', 'CONTACTED', 'NEGOTIATING'] } } }),
      this.prisma.collaboration.count({ where: { status: CollabStatus.AWAITING_CONTENT } }),
      this.prisma.fixedExpense.aggregate({ _sum: { amount: true }, where: { active: true } }),
      this.prisma.order.findMany({
        where: { operationalStatus: { in: pendingStatuses } },
        orderBy: [{ priorityLevel: 'asc' }, { orderedAt: 'asc' }],
        take: 8,
        select: {
          orderNumber: true,
          customerName: true,
          shippingMethod: true,
          operationalStatus: true,
          priorityLevel: true,
          orderedAt: true,
          internalDeadlineAt: true,
          items: { select: { title: true, variantTitle: true, quantity: true, sku: true, color: true, size: true }, take: 6 }
        }
      }),
      this.prisma.purchaseNeed.findMany({
        where: { status: PurchaseNeedStatus.OPEN, recommendedPurchaseQuantity: { gt: 0 } },
        orderBy: { recommendedPurchaseQuantity: 'desc' },
        take: 12,
        select: {
          recommendedPurchaseQuantity: true,
          neededForPendingOrders: true,
          currentInternalStock: true,
          supplierAvailableQuantity: true,
          stockItem: { select: { name: true, type: true, color: true, size: true, sku: true, supplierSku: true } }
        }
      }),
      this.prisma.shipment.findMany({
        where: { status: { in: [ShipmentStatus.PRINTED, ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED] }, updatedAt: { gte: start, lt: tomorrow } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: { trackingNumber: true, carrier: true, updatedAt: true, order: { select: { orderNumber: true, customerName: true } } }
      }),
      this.prisma.supplierPurchaseOrder.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { orderNumber: true, supplier: true, status: true, mode: true, orderDate: true, submittedAt: true, errorMessage: true, lines: { select: { name: true, color: true, size: true, quantity: true }, take: 8 } }
      })
    ]);

    const cash = bankAccounts.reduce((sum, account) => sum + Number(account.currentBalance ?? account.availableBalance ?? 0), 0);
    return {
      today,
      orders: { pending: pendingOrders, critical: criticalOrders, blocked: blockedOrders, old: oldPendingOrders },
      shipping: { ready: readyForShipping, labelsCreated, shippedToday },
      purchasing: { lines: openPurchaseNeeds, units: Number(purchaseQuantity._sum.recommendedPurchaseQuantity ?? 0), supplierDrafts },
      stock: { lowOrEmpty: lowStockItems },
      economics: { cash, currency: bankAccounts[0]?.currency ?? 'EUR', fixedMonthly: Number(fixedExpenses._sum.amount ?? 0), accounts: bankAccounts },
      influencers: { open: openInfluencers, awaitingContent },
      priorityOrders: topCriticalOrders.map((order) => ({
        ...order,
        orderedAt: order.orderedAt.toISOString(),
        internalDeadlineAt: order.internalDeadlineAt?.toISOString() ?? null
      })),
      purchaseNeeds: topPurchaseNeeds,
      finalizedToday: recentFinalized.map((shipment) => ({
        ...shipment,
        updatedAt: shipment.updatedAt.toISOString()
      })),
      supplierOrders: supplierOrders.map((order) => ({
        ...order,
        orderDate: order.orderDate.toISOString(),
        submittedAt: order.submittedAt?.toISOString() ?? null
      }))
    };
  }

  private classify(question: string): SpeedwearDomain {
    const q = question.toLowerCase();
    if (/(meta|ads|campaña|campanas|anuncio|roas|presupuesto|cpm|ctr|pausar|escalar)/.test(q)) return 'META_ADS';
    if (/(pedido|preparar|critico|crítico|shopify|retro|cliente)/.test(q)) return 'ORDERS';
    if (/(compr|proveedor|falk|ross|albaran|albarán|camiseta|sudadera|ropa)/.test(q)) return 'PURCHASING';
    if (/(stock|estanter|dtf|transfer|mala|malas|inventario)/.test(q)) return 'STOCK';
    if (/(envio|envío|sendcloud|etiqueta|tracking|devuelto|devolucion|devolución)/.test(q)) return 'SHIPPING';
    if (/(influ|ugc|creador|colab|contenido|reel|story)/.test(q)) return 'INFLUENCERS';
    if (/(caja|banco|n26|dinero|saldo|gasto|beneficio|alquiler|luz|pagar)/.test(q)) return 'ECONOMICS';
    return 'GENERAL';
  }

  private domainLabel(domain: SpeedwearDomain) {
    const labels: Record<SpeedwearDomain, string> = {
      GENERAL: 'Speedwear',
      META_ADS: 'Meta Ads',
      ORDERS: 'Pedidos',
      PURCHASING: 'Compras',
      STOCK: 'Stock',
      SHIPPING: 'Envíos',
      INFLUENCERS: 'Influs',
      ECONOMICS: 'Caja'
    };
    return labels[domain];
  }

  private headlineFor(domain: SpeedwearDomain, context: Awaited<ReturnType<SpeedwearAiService['buildContext']>>) {
    if (domain === 'ORDERS') return context.orders.critical > 0 ? 'Primero atacaría los críticos' : 'Pedidos bajo control relativo';
    if (domain === 'PURCHASING') return context.purchasing.units > 0 ? 'Hay compra pendiente que revisar' : 'No veo compra urgente abierta';
    if (domain === 'STOCK') return context.stock.lowOrEmpty > 0 ? 'Ojo: hay stock a cero o bajo' : 'Stock sin alertas fuertes';
    if (domain === 'SHIPPING') return context.shipping.ready > 0 || context.shipping.labelsCreated > 0 ? 'Hay trabajo pendiente en envíos' : 'Envíos tranquilos ahora mismo';
    if (domain === 'INFLUENCERS') return context.influencers.awaitingContent > 0 ? 'Toca perseguir contenido UGC' : 'Influs sin urgencia clara';
    if (domain === 'ECONOMICS') return context.economics.cash > 0 ? 'Caja leída, puedo ayudarte a decidir' : 'Caja incompleta o sin saldo leído';
    return 'Te hago una lectura global';
  }

  private answerFor(domain: SpeedwearDomain, question: string, context: Awaited<ReturnType<SpeedwearAiService['buildContext']>>) {
    if (domain === 'ORDERS') {
      return `Ahora mismo hay ${context.orders.pending} pedidos sin cerrar, ${context.orders.critical} críticos y ${context.orders.old} antiguos. Si preguntas qué haría yo: empezaría por los críticos/antiguos, después los bloqueados por stock y dejaría lo fácil para cerrar tanda.`;
    }
    if (domain === 'PURCHASING') {
      return `Compras recomienda ${context.purchasing.units} unidades repartidas en ${context.purchasing.lines} líneas. Si vas a comprar, revisaría primero camisetas/sudaderas con stock proveedor y evitaría mezclarlo con accesorios o bañadores.`;
    }
    if (domain === 'STOCK') {
      return `Veo ${context.stock.lowOrEmpty} referencias de stock base/DTF a cero o bajo. Para que compras cuadre, lo importante es mantener stock real actualizado por albarán o ajuste manual, y que cada pedido tenga bien mapeada su prenda base.`;
    }
    if (domain === 'SHIPPING') {
      return `Hay ${context.shipping.ready} pedidos preparados para etiqueta y ${context.shipping.labelsCreated} etiquetas creadas pendientes de cerrar/escanear. Hoy figuran ${context.shipping.shippedToday} envíos finalizados.`;
    }
    if (domain === 'INFLUENCERS') {
      return `Tienes ${context.influencers.open} influs abiertos y ${context.influencers.awaitingContent} esperando contenido. Yo priorizaría los que ya han recibido pedido: son los que más rápido pueden darte reels/stories.`;
    }
    if (domain === 'ECONOMICS') {
      return `Caja leída aproximada: ${this.money(context.economics.cash, context.economics.currency)}. Gastos fijos activos al mes: ${this.money(context.economics.fixedMonthly, context.economics.currency)}. Para decidir inversiones, miraría caja disponible, pagos próximos y gasto Meta acumulado antes de comprometer más stock.`;
    }
    return `Te leo la foto general: ${context.orders.pending} pedidos pendientes, ${context.purchasing.units} unidades recomendadas para comprar, ${context.shipping.ready} listos para envío, ${context.influencers.awaitingContent} influs esperando contenido y caja aproximada ${this.money(context.economics.cash, context.economics.currency)}. Dime el problema concreto y lo llevo a la sección correcta.`;
  }

  private nextActionsFor(domain: SpeedwearDomain, context: Awaited<ReturnType<SpeedwearAiService['buildContext']>>) {
    if (domain === 'ORDERS') return ['Filtrar sin preparar por críticos', 'Resolver bloqueados de stock', 'Cerrar pedidos antiguos antes de nuevos'];
    if (domain === 'PURCHASING') return ['Abrir compras proveedor', 'Revisar unidades por talla/color', 'Crear borrador Falk & Ross si cuadra'];
    if (domain === 'STOCK') return ['Actualizar stock real', 'Subir albarán si ha llegado ropa', 'Revisar mapeos de productos raros'];
    if (domain === 'SHIPPING') return ['Crear etiqueta', 'Imprimir', 'Escanear código para finalizar'];
    if (domain === 'INFLUENCERS') return ['Filtrar esperando contenido', 'Enviar recordatorio', 'Marcar recibido cuando llegue el vídeo'];
    if (domain === 'ECONOMICS') return ['Revisar saldo banco', 'Separar ads/gastos fijos', 'No invertir si caja operativa queda justa'];
    return ['Atacar pedidos críticos', 'Revisar compras recomendadas', 'Mirar caja antes de tocar ads'];
  }

  private metricsFor(domain: SpeedwearDomain, context: Awaited<ReturnType<SpeedwearAiService['buildContext']>>) {
    const base = [
      { label: 'Pendientes', value: String(context.orders.pending), tone: context.orders.critical > 0 ? 'red' : 'blue' },
      { label: 'Comprar', value: String(context.purchasing.units), tone: context.purchasing.units > 0 ? 'amber' : 'green' },
      { label: 'Caja', value: this.money(context.economics.cash, context.economics.currency), tone: context.economics.cash > 0 ? 'green' : 'amber' }
    ];
    if (domain === 'SHIPPING') return [{ label: 'Listos envío', value: String(context.shipping.ready), tone: 'blue' }, { label: 'Etiquetas', value: String(context.shipping.labelsCreated), tone: 'amber' }, { label: 'Finalizados hoy', value: String(context.shipping.shippedToday), tone: 'green' }];
    if (domain === 'INFLUENCERS') return [{ label: 'Influs abiertos', value: String(context.influencers.open), tone: 'purple' }, { label: 'Esperando UGC', value: String(context.influencers.awaitingContent), tone: context.influencers.awaitingContent > 0 ? 'amber' : 'green' }];
    return base;
  }

  private async saveExchange(question: string, answer: unknown) {
    try {
      const now = new Date();
      await this.prisma.speedwearAiChatMessage.createMany({
        data: [
          { id: `user-${crypto.randomUUID()}`, role: 'user', text: question, createdAt: now },
          {
            id: `assistant-${crypto.randomUUID()}`,
            role: 'assistant',
            text: (answer as { headline?: string; answer?: string }).headline ?? 'Respuesta IA Speedwear',
            answerJson: answer as object,
            createdAt: new Date(now.getTime() + 1)
          }
        ]
      });
    } catch (error) {
      this.logger.warn(`No se pudo guardar chat IA Speedwear: ${(error as Error).message}`);
    }
  }

  private money(value: number, currency = 'EUR') {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(Number(value || 0));
  }

  private hasOpenAi() {
    return Boolean(this.config.get<string>('OPENAI_API_KEY')?.trim());
  }

  private extractOpenAiText(response: Record<string, unknown>) {
    if (typeof response.output_text === 'string') return response.output_text;
    const output = Array.isArray(response.output) ? response.output : [];
    for (const item of output as Array<{ content?: Array<{ type?: string; text?: string }> }>) {
      for (const content of item.content ?? []) {
        if (typeof content.text === 'string') return content.text;
      }
    }
    throw new Error('OpenAI no devolvió texto');
  }

  private normalizeOpenAiAnswer(
    domain: SpeedwearDomain,
    question: string,
    context: Awaited<ReturnType<SpeedwearAiService['buildContext']>>,
    parsed: Record<string, unknown>,
    metaAdvisor: unknown
  ) {
    const metaActions = (metaAdvisor as { actionSuggestions?: unknown[] } | null)?.actionSuggestions ?? [];
    return {
      from: context.today,
      to: context.today,
      question,
      domain,
      title: typeof parsed.title === 'string' ? parsed.title : this.domainLabel(domain),
      routedTo: typeof parsed.routedTo === 'string' ? parsed.routedTo : this.domainLabel(domain),
      headline: typeof parsed.headline === 'string' ? parsed.headline : this.headlineFor(domain, context),
      answer: typeof parsed.answer === 'string' ? parsed.answer : this.answerFor(domain, question, context),
      confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(String(parsed.confidence)) ? parsed.confidence : 'MEDIUM',
      nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions.filter((item) => typeof item === 'string').slice(0, 6) : this.nextActionsFor(domain, context),
      metrics: Array.isArray(parsed.metrics) ? parsed.metrics.slice(0, 8) : this.metricsFor(domain, context),
      campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns.slice(0, 8) : [],
      suggestedQuestions: Array.isArray(parsed.suggestedQuestions)
        ? parsed.suggestedQuestions.filter((item) => typeof item === 'string').slice(0, 6)
        : ['¿Qué hago primero hoy?', '¿Vamos bien de caja?', '¿Qué tengo que comprar?'],
      actionSuggestions: domain === 'META_ADS' ? metaActions : [],
      permissions: [
        'Conversación real con OpenAI',
        'Lee contexto de pedidos, stock, compras, envíos, caja, influs y ads',
        'Mantiene historial reciente del chat',
        'Aplica acciones solo con botón de confirmación'
      ]
    };
  }

  private openAiUnavailableAnswer(
    domain: SpeedwearDomain,
    question: string,
    context: Awaited<ReturnType<SpeedwearAiService['buildContext']>>,
    reason: string
  ) {
    return {
      from: context.today,
      to: context.today,
      question,
      domain,
      title: 'IA Speedwear',
      routedTo: this.domainLabel(domain),
      headline: 'Estoy en modo fallback',
      answer: `La parte conversacional real no ha respondido (${reason}). Te doy una lectura operativa basica mientras tanto: ${this.answerFor(domain, question, context)}`,
      confidence: 'LOW',
      nextActions: ['Revisar OPENAI_API_KEY en Railway', 'Reintentar la pregunta', ...this.nextActionsFor(domain, context).slice(0, 2)],
      metrics: this.metricsFor(domain, context),
      campaigns: [],
      suggestedQuestions: ['¿Qué hago primero hoy?', '¿Qué tengo que comprar?', '¿Vamos bien de caja?'],
      actionSuggestions: [],
      permissions: ['Modo fallback por error de OpenAI']
    };
  }

  private openAiAnswerSchema() {
    const metric = {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'value', 'tone'],
      properties: {
        label: { type: 'string' },
        value: { type: 'string' },
        tone: { type: 'string', enum: ['green', 'red', 'amber', 'blue', 'purple', 'teal', 'muted'] }
      }
    };
    const campaign = {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'status', 'spend', 'purchases', 'roas', 'ctr', 'advice'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        status: { type: 'string' },
        spend: { type: 'number' },
        purchases: { type: 'number' },
        roas: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        ctr: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        advice: { type: 'string' }
      }
    };
    return {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'routedTo', 'headline', 'answer', 'confidence', 'nextActions', 'metrics', 'campaigns', 'suggestedQuestions'],
      properties: {
        title: { type: 'string' },
        routedTo: { type: 'string' },
        headline: { type: 'string' },
        answer: { type: 'string' },
        confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
        nextActions: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        metrics: { type: 'array', items: metric, maxItems: 8 },
        campaigns: { type: 'array', items: campaign, maxItems: 8 },
        suggestedQuestions: { type: 'array', items: { type: 'string' }, maxItems: 6 }
      }
    };
  }
}
