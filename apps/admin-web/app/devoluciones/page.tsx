'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface OrderItem {
  id: string;
  sku: string;
  title: string;
  variantTitle?: string | null;
  quantity: number;
  returnableQuantity: number;
  imageUrl?: string | null;
  color?: string | null;
  size?: string | null;
  unitPrice?: number | null;
}

interface LookupResult {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail?: string | null;
  deliveredAt: string | null;
  referenceDate: string;
  daysSince: number;
  windowDays: number;
  windowExpired: boolean;
  labelFee: number;
  items: OrderItem[];
  reasons: Record<string, string>;
}

interface CatalogVariant {
  id: string;
  title: string;
  price: number;
  sku: string;
  available: boolean;
  imageUrl: string | null;
  size: string | null;
  color: string | null;
}
interface CatalogProduct {
  id: string;
  title: string;
  productType: string | null;
  handle: string;
  imageUrl: string | null;
  variants: CatalogVariant[];
}

interface CreateReturnResponse {
  returnId: string;
  type: string;
  status: string;
  paymentStatus: string;
  refundAmount: number | null;
  chargeAmount: number | null;
  labelFee: number | null;
  totalAmount: number | null;
  checkoutUrl: string | null;
  items: Array<{ title: string; variantTitle?: string | null; quantity: number; reason: string; replacementTitle?: string | null; replacementPrice?: number | null }>;
}

interface StatusResponse {
  returnId: string;
  type: string;
  status: string;
  paymentStatus: string;
  checkoutUrl: string | null;
  labelUrl: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  totalAmount: number | null;
  paidAt: string | null;
}

type Action = 'RETURN' | 'EXCHANGE';

interface ItemSelection {
  selected: boolean;
  action: Action;
  quantity: number;
  reason: string;
  notes: string;
  photo?: string; // base64 data URL — required for defect reasons
  replacement?: { variantId: string; productId: string; title: string; price: number; imageUrl?: string };
}

interface PortalConfig {
  logoUrl?: string | null;
  faviconUrl?: string | null;
  backgroundUrl?: string | null;
  primaryColor?: string | null;
  cardStyle?: string | null;
  titleText?: string | null;
  subtitleText?: string | null;
  policyUrl?: string | null;
}

const DEFAULT_PORTAL_CONFIG: PortalConfig = {
  logoUrl: null,
  faviconUrl: null,
  backgroundUrl: null,
  primaryColor: '#007AFF',
  cardStyle: 'light',
  titleText: 'Cambios & Devoluciones',
  subtitleText: 'Gestiona tu devolución de forma rápida',
  policyUrl: null,
};

const PHOTO_REASONS = ['DEFECTIVE', 'NOT_AS_DESCRIBED', 'WRONG_ITEM'];

type LangStrings = {
  step1: string; step2: string; step3: string;
  orderNumber: string; email: string; emailPlaceholder: string;
  searchBtn: string; searching: string; selectItems: string;
  managementType: string; returnBtn: string; exchangeBtn: string;
  exchangeProduct: string; changeBtn: string; chooseProduct: string;
  reason: string; reasonPlaceholder: string; notes: string; notesPlaceholder: string;
  photoLabel: string; photoHint: string; photoUploadBtn: string; photoChangeBtn: string;
  back: string; continueBtn: (n: number) => string; processing: string;
  selectAtLeast: string; chooseReason: string; chooseExchange: string; photoRequired: string;
  summary: string; refundLabel: string; chargeLabel: string; favorLabel: string;
  shippingLabel: string; totalLabel: string;
  searchProductPlaceholder: string; loadingProducts: string; noResults: string;
  chooseExchangeTitle: string; available: string; availablePlural: string; from: string;
  deliveredDaysAgo: (n: number) => string;
  daysLeft: (n: number) => string; lastDay: string;
  policyLink: string; termsText: string; termsLink: string; termsRequired: string;
  sessionRestored: string; sessionExpired: string;
};

const TRANSLATIONS: Record<string, LangStrings> = {
  es: {
    step1: 'Paso 1 de 3 — Buscar pedido', step2: 'Paso 2 de 3 — Seleccionar artículos', step3: 'Paso 3 de 3 — Confirmación',
    orderNumber: 'Número de pedido', email: 'Email', emailPlaceholder: 'tu@email.com',
    searchBtn: 'Buscar pedido', searching: 'Buscando...', selectItems: 'Selecciona artículos',
    managementType: 'Tipo de gestión', returnBtn: 'Devolver', exchangeBtn: 'Cambiar',
    exchangeProduct: 'Producto de cambio', changeBtn: 'Cambiar', chooseProduct: '+ Elegir producto de cambio',
    reason: 'Motivo *', reasonPlaceholder: 'Selecciona un motivo…', notes: 'Notas (opcional)', notesPlaceholder: 'Ej: talla muy pequeña…',
    photoLabel: 'Foto del desperfecto *', photoHint: 'Necesitamos una foto del estado del artículo', photoUploadBtn: '📷 Subir foto', photoChangeBtn: 'Cambiar foto',
    back: 'Volver', continueBtn: (n) => `Continuar (${n} artículo${n !== 1 ? 's' : ''})`, processing: 'Procesando…',
    selectAtLeast: 'Selecciona al menos un artículo.', chooseReason: 'Elige un motivo para cada artículo.',
    chooseExchange: 'Elige producto de cambio para los artículos marcados como CAMBIO.', photoRequired: 'Sube una foto para los artículos con desperfecto.',
    summary: 'Resumen', refundLabel: 'Reembolso por devuelto', chargeLabel: 'Cargo por nuevo producto', favorLabel: 'Diferencia a favor',
    shippingLabel: 'Etiqueta Correos', totalLabel: 'Total a pagar',
    searchProductPlaceholder: 'Buscar producto…', loadingProducts: 'Cargando productos…', noResults: 'Sin resultados', chooseExchangeTitle: 'Elige producto de cambio',
    available: 'disponible', availablePlural: 'disponibles', from: 'Desde',
    deliveredDaysAgo: (n) => `Entregado hace ${n} días`,
    daysLeft: (n) => `Te ${n === 1 ? 'queda' : 'quedan'} ${n} día${n !== 1 ? 's' : ''} para devolver`, lastDay: 'Último día para iniciar tu devolución',
    policyLink: 'Política de devoluciones', termsText: 'He leído y acepto la', termsLink: 'política de devoluciones',
    termsRequired: 'Debes aceptar la política de devoluciones para continuar.',
    sessionRestored: 'Hemos recuperado tu progreso anterior.', sessionExpired: 'Tu sesión anterior ha expirado. Busca el pedido de nuevo.',
  },
  en: {
    step1: 'Step 1 of 3 — Find order', step2: 'Step 2 of 3 — Select items', step3: 'Step 3 of 3 — Confirmation',
    orderNumber: 'Order number', email: 'Email', emailPlaceholder: 'your@email.com',
    searchBtn: 'Find order', searching: 'Searching...', selectItems: 'Select items',
    managementType: 'Action', returnBtn: 'Return', exchangeBtn: 'Exchange',
    exchangeProduct: 'Exchange product', changeBtn: 'Change', chooseProduct: '+ Choose exchange product',
    reason: 'Reason *', reasonPlaceholder: 'Select a reason…', notes: 'Notes (optional)', notesPlaceholder: 'E.g. size too small…',
    photoLabel: 'Photo of the issue *', photoHint: 'We need a photo showing the item condition', photoUploadBtn: '📷 Upload photo', photoChangeBtn: 'Change photo',
    back: 'Back', continueBtn: (n) => `Continue (${n} item${n !== 1 ? 's' : ''})`, processing: 'Processing…',
    selectAtLeast: 'Select at least one item.', chooseReason: 'Choose a reason for each selected item.',
    chooseExchange: 'Choose an exchange product for items marked as EXCHANGE.', photoRequired: 'Please upload a photo for items with defects.',
    summary: 'Summary', refundLabel: 'Refund for returned', chargeLabel: 'Charge for new product', favorLabel: 'Amount in your favour',
    shippingLabel: 'Correos label', totalLabel: 'Total to pay',
    searchProductPlaceholder: 'Search product…', loadingProducts: 'Loading products…', noResults: 'No results', chooseExchangeTitle: 'Choose exchange product',
    available: 'available', availablePlural: 'available', from: 'From',
    deliveredDaysAgo: (n) => `Delivered ${n} day${n !== 1 ? 's' : ''} ago`,
    daysLeft: (n) => `${n} day${n !== 1 ? 's' : ''} left to return`, lastDay: 'Last day to start your return',
    policyLink: 'Return policy', termsText: 'I have read and accept the', termsLink: 'return policy',
    termsRequired: 'You must accept the return policy to continue.',
    sessionRestored: 'We recovered your previous progress.', sessionExpired: 'Your previous session has expired. Please search for your order again.',
  },
  fr: {
    step1: 'Étape 1 sur 3 — Rechercher commande', step2: 'Étape 2 sur 3 — Sélectionner articles', step3: 'Étape 3 sur 3 — Confirmation',
    orderNumber: 'Numéro de commande', email: 'Email', emailPlaceholder: 'votre@email.com',
    searchBtn: 'Rechercher commande', searching: 'Recherche...', selectItems: 'Sélectionnez les articles',
    managementType: 'Type de gestion', returnBtn: 'Retourner', exchangeBtn: 'Échanger',
    exchangeProduct: "Produit d'échange", changeBtn: 'Changer', chooseProduct: "+ Choisir produit d'échange",
    reason: 'Motif *', reasonPlaceholder: 'Sélectionnez un motif…', notes: 'Notes (optionnel)', notesPlaceholder: 'Ex: taille trop petite…',
    photoLabel: 'Photo du problème *', photoHint: "Nous avons besoin d'une photo de l'état de l'article", photoUploadBtn: '📷 Télécharger photo', photoChangeBtn: 'Changer photo',
    back: 'Retour', continueBtn: (n) => `Continuer (${n} article${n !== 1 ? 's' : ''})`, processing: 'Traitement…',
    selectAtLeast: 'Sélectionnez au moins un article.', chooseReason: 'Choisissez un motif pour chaque article.',
    chooseExchange: "Choisissez un produit d'échange pour les articles marqués ÉCHANGE.", photoRequired: 'Téléchargez une photo pour les articles défectueux.',
    summary: 'Résumé', refundLabel: 'Remboursement pour retourné', chargeLabel: 'Frais pour nouveau produit', favorLabel: 'Différence en votre faveur',
    shippingLabel: 'Étiquette Correos', totalLabel: 'Total à payer',
    searchProductPlaceholder: 'Rechercher produit…', loadingProducts: 'Chargement des produits…', noResults: 'Aucun résultat', chooseExchangeTitle: "Choisir produit d'échange",
    available: 'disponible', availablePlural: 'disponibles', from: 'À partir de',
    deliveredDaysAgo: (n) => `Livré il y a ${n} jour${n !== 1 ? 's' : ''}`,
    daysLeft: (n) => `Il vous reste ${n} jour${n !== 1 ? 's' : ''} pour retourner`, lastDay: 'Dernier jour pour initier votre retour',
    policyLink: 'Politique de retour', termsText: "J'ai lu et j'accepte la", termsLink: 'politique de retour',
    termsRequired: 'Vous devez accepter la politique de retour pour continuer.',
    sessionRestored: 'Nous avons récupéré votre progression précédente.', sessionExpired: 'Votre session précédente a expiré. Veuillez rechercher votre commande à nouveau.',
  },
  de: {
    step1: 'Schritt 1 von 3 — Bestellung suchen', step2: 'Schritt 2 von 3 — Artikel auswählen', step3: 'Schritt 3 von 3 — Bestätigung',
    orderNumber: 'Bestellnummer', email: 'E-Mail', emailPlaceholder: 'deine@email.com',
    searchBtn: 'Bestellung suchen', searching: 'Suche...', selectItems: 'Artikel auswählen',
    managementType: 'Art der Verwaltung', returnBtn: 'Zurücksenden', exchangeBtn: 'Umtauschen',
    exchangeProduct: 'Umtauschprodukt', changeBtn: 'Ändern', chooseProduct: '+ Umtauschprodukt wählen',
    reason: 'Grund *', reasonPlaceholder: 'Wählen Sie einen Grund…', notes: 'Anmerkungen (optional)', notesPlaceholder: 'z.B. Größe zu klein…',
    photoLabel: 'Foto des Schadens *', photoHint: 'Wir benötigen ein Foto des Artikelzustands', photoUploadBtn: '📷 Foto hochladen', photoChangeBtn: 'Foto ändern',
    back: 'Zurück', continueBtn: (n) => `Weiter (${n} Artikel)`, processing: 'Verarbeitung…',
    selectAtLeast: 'Wählen Sie mindestens einen Artikel aus.', chooseReason: 'Wählen Sie einen Grund für jeden Artikel.',
    chooseExchange: 'Wählen Sie ein Umtauschprodukt für als UMTAUSCH markierte Artikel.', photoRequired: 'Laden Sie ein Foto für defekte Artikel hoch.',
    summary: 'Zusammenfassung', refundLabel: 'Erstattung für zurückgesendete Artikel', chargeLabel: 'Gebühr für neues Produkt', favorLabel: 'Differenz zu Ihren Gunsten',
    shippingLabel: 'Correos-Etikett', totalLabel: 'Gesamt zu zahlen',
    searchProductPlaceholder: 'Produkt suchen…', loadingProducts: 'Produkte werden geladen…', noResults: 'Keine Ergebnisse', chooseExchangeTitle: 'Umtauschprodukt wählen',
    available: 'verfügbar', availablePlural: 'verfügbar', from: 'Ab',
    deliveredDaysAgo: (n) => `Vor ${n} Tag${n !== 1 ? 'en' : ''} geliefert`,
    daysLeft: (n) => `Noch ${n} Tag${n !== 1 ? 'e' : ''} für die Rücksendung`, lastDay: 'Letzter Tag für die Rücksendung',
    policyLink: 'Rückgaberichtlinie', termsText: 'Ich habe die Rückgaberichtlinie gelesen und akzeptiere', termsLink: 'sie',
    termsRequired: 'Sie müssen die Rückgaberichtlinie akzeptieren, um fortzufahren.',
    sessionRestored: 'Wir haben Ihren vorherigen Fortschritt wiederhergestellt.', sessionExpired: 'Ihre vorherige Sitzung ist abgelaufen. Bitte suchen Sie Ihre Bestellung erneut.',
  },
  it: {
    step1: 'Passo 1 di 3 — Cerca ordine', step2: 'Passo 2 di 3 — Seleziona articoli', step3: 'Passo 3 di 3 — Conferma',
    orderNumber: 'Numero ordine', email: 'Email', emailPlaceholder: 'tua@email.com',
    searchBtn: 'Cerca ordine', searching: 'Ricerca...', selectItems: 'Seleziona articoli',
    managementType: 'Tipo di gestione', returnBtn: 'Restituire', exchangeBtn: 'Cambiare',
    exchangeProduct: 'Prodotto di scambio', changeBtn: 'Cambia', chooseProduct: '+ Scegli prodotto di scambio',
    reason: 'Motivo *', reasonPlaceholder: 'Seleziona un motivo…', notes: 'Note (opzionale)', notesPlaceholder: 'Es: taglia troppo piccola…',
    photoLabel: 'Foto del difetto *', photoHint: "Abbiamo bisogno di una foto delle condizioni dell'articolo", photoUploadBtn: '📷 Carica foto', photoChangeBtn: 'Cambia foto',
    back: 'Indietro', continueBtn: (n) => `Continua (${n} ${n !== 1 ? 'articoli' : 'articolo'})`, processing: 'Elaborazione…',
    selectAtLeast: 'Seleziona almeno un articolo.', chooseReason: 'Scegli un motivo per ogni articolo.',
    chooseExchange: 'Scegli un prodotto di scambio per gli articoli marcati come CAMBIO.', photoRequired: 'Carica una foto per gli articoli con difetti.',
    summary: 'Riepilogo', refundLabel: 'Rimborso per restituito', chargeLabel: 'Addebito per nuovo prodotto', favorLabel: 'Differenza a tuo favore',
    shippingLabel: 'Etichetta Correos', totalLabel: 'Totale da pagare',
    searchProductPlaceholder: 'Cerca prodotto…', loadingProducts: 'Caricamento prodotti…', noResults: 'Nessun risultato', chooseExchangeTitle: 'Scegli prodotto di scambio',
    available: 'disponibile', availablePlural: 'disponibili', from: 'Da',
    deliveredDaysAgo: (n) => `Consegnato ${n} ${n !== 1 ? 'giorni' : 'giorno'} fa`,
    daysLeft: (n) => `Hai ancora ${n} ${n !== 1 ? 'giorni' : 'giorno'} per restituire`, lastDay: 'Ultimo giorno per avviare la restituzione',
    policyLink: 'Politica di reso', termsText: 'Ho letto e accetto la', termsLink: 'politica di reso',
    termsRequired: 'Devi accettare la politica di reso per continuare.',
    sessionRestored: 'Abbiamo recuperato il tuo progresso precedente.', sessionExpired: 'La tua sessione precedente è scaduta. Cerca di nuovo il tuo ordine.',
  },
  pt: {
    step1: 'Passo 1 de 3 — Pesquisar pedido', step2: 'Passo 2 de 3 — Selecionar artigos', step3: 'Passo 3 de 3 — Confirmação',
    orderNumber: 'Número do pedido', email: 'Email', emailPlaceholder: 'seu@email.com',
    searchBtn: 'Pesquisar pedido', searching: 'Pesquisando...', selectItems: 'Selecionar artigos',
    managementType: 'Tipo de gestão', returnBtn: 'Devolver', exchangeBtn: 'Trocar',
    exchangeProduct: 'Produto de troca', changeBtn: 'Alterar', chooseProduct: '+ Escolher produto de troca',
    reason: 'Motivo *', reasonPlaceholder: 'Selecione um motivo…', notes: 'Notas (opcional)', notesPlaceholder: 'Ex: tamanho muito pequeno…',
    photoLabel: 'Foto do defeito *', photoHint: 'Precisamos de uma foto do estado do artigo', photoUploadBtn: '📷 Enviar foto', photoChangeBtn: 'Alterar foto',
    back: 'Voltar', continueBtn: (n) => `Continuar (${n} artigo${n !== 1 ? 's' : ''})`, processing: 'Processando…',
    selectAtLeast: 'Selecione pelo menos um artigo.', chooseReason: 'Escolha um motivo para cada artigo.',
    chooseExchange: 'Escolha um produto de troca para os artigos marcados como TROCA.', photoRequired: 'Envie uma foto para os artigos com defeito.',
    summary: 'Resumo', refundLabel: 'Reembolso por devolvido', chargeLabel: 'Cobrança por novo produto', favorLabel: 'Diferença a seu favor',
    shippingLabel: 'Etiqueta Correos', totalLabel: 'Total a pagar',
    searchProductPlaceholder: 'Pesquisar produto…', loadingProducts: 'Carregando produtos…', noResults: 'Sem resultados', chooseExchangeTitle: 'Escolher produto de troca',
    available: 'disponível', availablePlural: 'disponíveis', from: 'A partir de',
    deliveredDaysAgo: (n) => `Entregue há ${n} dia${n !== 1 ? 's' : ''}`,
    daysLeft: (n) => `Faltam ${n} dia${n !== 1 ? 's' : ''} para devolver`, lastDay: 'Último dia para iniciar a devolução',
    policyLink: 'Política de devoluções', termsText: 'Li e aceito a', termsLink: 'política de devoluções',
    termsRequired: 'Deve aceitar a política de devoluções para continuar.',
    sessionRestored: 'Recuperamos o seu progresso anterior.', sessionExpired: 'A sua sessão anterior expirou. Pesquise o seu pedido novamente.',
  },
  nl: {
    step1: 'Stap 1 van 3 — Bestelling zoeken', step2: 'Stap 2 van 3 — Artikelen selecteren', step3: 'Stap 3 van 3 — Bevestiging',
    orderNumber: 'Bestelnummer', email: 'E-mail', emailPlaceholder: 'jouw@email.com',
    searchBtn: 'Bestelling zoeken', searching: 'Zoeken...', selectItems: 'Artikelen selecteren',
    managementType: 'Type beheer', returnBtn: 'Retourneren', exchangeBtn: 'Ruilen',
    exchangeProduct: 'Ruilproduct', changeBtn: 'Wijzigen', chooseProduct: '+ Ruilproduct kiezen',
    reason: 'Reden *', reasonPlaceholder: 'Selecteer een reden…', notes: 'Opmerkingen (optioneel)', notesPlaceholder: 'Bijv: maat te klein…',
    photoLabel: 'Foto van het defect *', photoHint: 'We hebben een foto nodig van de staat van het artikel', photoUploadBtn: '📷 Foto uploaden', photoChangeBtn: 'Foto wijzigen',
    back: 'Terug', continueBtn: (n) => `Doorgaan (${n} artikel${n !== 1 ? 'en' : ''})`, processing: 'Verwerking…',
    selectAtLeast: 'Selecteer minimaal één artikel.', chooseReason: 'Kies een reden voor elk artikel.',
    chooseExchange: 'Kies een ruilproduct voor artikelen gemarkeerd als RUILEN.', photoRequired: 'Upload een foto voor artikelen met defecten.',
    summary: 'Samenvatting', refundLabel: 'Terugbetaling voor geretourneerd', chargeLabel: 'Kosten voor nieuw product', favorLabel: 'Verschil in uw voordeel',
    shippingLabel: 'Correos label', totalLabel: 'Totaal te betalen',
    searchProductPlaceholder: 'Product zoeken…', loadingProducts: 'Producten laden…', noResults: 'Geen resultaten', chooseExchangeTitle: 'Ruilproduct kiezen',
    available: 'beschikbaar', availablePlural: 'beschikbaar', from: 'Vanaf',
    deliveredDaysAgo: (n) => `${n} dag${n !== 1 ? 'en' : ''} geleden geleverd`,
    daysLeft: (n) => `Nog ${n} dag${n !== 1 ? 'en' : ''} om te retourneren`, lastDay: 'Laatste dag om uw retour te starten',
    policyLink: 'Retourbeleid', termsText: 'Ik heb het retourbeleid gelezen en ga akkoord met', termsLink: 'het retourbeleid',
    termsRequired: 'U moet het retourbeleid accepteren om door te gaan.',
    sessionRestored: 'We hebben uw vorige voortgang hersteld.', sessionExpired: 'Uw vorige sessie is verlopen. Zoek uw bestelling opnieuw.',
  },
  pl: {
    step1: 'Krok 1 z 3 — Znajdź zamówienie', step2: 'Krok 2 z 3 — Wybierz artykuły', step3: 'Krok 3 z 3 — Potwierdzenie',
    orderNumber: 'Numer zamówienia', email: 'Email', emailPlaceholder: 'twoj@email.com',
    searchBtn: 'Znajdź zamówienie', searching: 'Szukanie...', selectItems: 'Wybierz artykuły',
    managementType: 'Typ zarządzania', returnBtn: 'Zwróć', exchangeBtn: 'Wymień',
    exchangeProduct: 'Produkt zamienny', changeBtn: 'Zmień', chooseProduct: '+ Wybierz produkt zamienny',
    reason: 'Powód *', reasonPlaceholder: 'Wybierz powód…', notes: 'Uwagi (opcjonalne)', notesPlaceholder: 'Np. rozmiar za mały…',
    photoLabel: 'Zdjęcie defektu *', photoHint: 'Potrzebujemy zdjęcia stanu artykułu', photoUploadBtn: '📷 Prześlij zdjęcie', photoChangeBtn: 'Zmień zdjęcie',
    back: 'Wróć', continueBtn: (n) => `Kontynuuj (${n})`, processing: 'Przetwarzanie…',
    selectAtLeast: 'Wybierz co najmniej jeden artykuł.', chooseReason: 'Wybierz powód dla każdego artykułu.',
    chooseExchange: 'Wybierz produkt zamienny dla artykułów oznaczonych jako WYMIANA.', photoRequired: 'Prześlij zdjęcie dla artykułów z defektem.',
    summary: 'Podsumowanie', refundLabel: 'Zwrot za odesłany', chargeLabel: 'Opłata za nowy produkt', favorLabel: 'Różnica na Twoją korzyść',
    shippingLabel: 'Etykieta Correos', totalLabel: 'Łącznie do zapłaty',
    searchProductPlaceholder: 'Szukaj produktu…', loadingProducts: 'Ładowanie produktów…', noResults: 'Brak wyników', chooseExchangeTitle: 'Wybierz produkt zamienny',
    available: 'dostępny', availablePlural: 'dostępnych', from: 'Od',
    deliveredDaysAgo: (n) => `Dostarczono ${n} dni temu`,
    daysLeft: (n) => `Pozostało ${n} dni na zwrot`, lastDay: 'Ostatni dzień na zgłoszenie zwrotu',
    policyLink: 'Polityka zwrotów', termsText: 'Przeczytałem i akceptuję', termsLink: 'politykę zwrotów',
    termsRequired: 'Musisz zaakceptować politykę zwrotów, aby kontynuować.',
    sessionRestored: 'Przywróciliśmy Twój poprzedni postęp.', sessionExpired: 'Poprzednia sesja wygasła. Wyszukaj swoje zamówienie ponownie.',
  },
  hu: {
    step1: '1. lépés / 3 — Rendelés keresése', step2: '2. lépés / 3 — Termékek kiválasztása', step3: '3. lépés / 3 — Megerősítés',
    orderNumber: 'Rendelésszám', email: 'Email', emailPlaceholder: 'te@email.com',
    searchBtn: 'Rendelés keresése', searching: 'Keresés...', selectItems: 'Termékek kiválasztása',
    managementType: 'Kezelés típusa', returnBtn: 'Visszaküldés', exchangeBtn: 'Csere',
    exchangeProduct: 'Csereterm ék', changeBtn: 'Módosítás', chooseProduct: '+ Cseretermék kiválasztása',
    reason: 'Ok *', reasonPlaceholder: 'Válasszon okot…', notes: 'Megjegyzések (opcionális)', notesPlaceholder: 'Pl. méret túl kicsi…',
    photoLabel: 'Fotó a hibáról *', photoHint: 'Fotóra van szükségünk a termék állapotáról', photoUploadBtn: '📷 Fotó feltöltése', photoChangeBtn: 'Fotó módosítása',
    back: 'Vissza', continueBtn: (n) => `Folytatás (${n} termék)`, processing: 'Feldolgozás…',
    selectAtLeast: 'Válasszon legalább egy terméket.', chooseReason: 'Válasszon okot minden termékhez.',
    chooseExchange: 'Válasszon csereterméket a CSERE jelölésű termékekhez.', photoRequired: 'Töltsön fel fotót a hibás termékekhez.',
    summary: 'Összefoglaló', refundLabel: 'Visszatérítés a visszaküldöttért', chargeLabel: 'Díj az új termékért', favorLabel: 'Különbség az Ön javára',
    shippingLabel: 'Correos címke', totalLabel: 'Fizetendő összeg',
    searchProductPlaceholder: 'Termék keresése…', loadingProducts: 'Termékek betöltése…', noResults: 'Nincs találat', chooseExchangeTitle: 'Cseretermék kiválasztása',
    available: 'elérhető', availablePlural: 'elérhető', from: 'Tól',
    deliveredDaysAgo: (n) => `${n} napja szállítva`,
    daysLeft: (n) => `Még ${n} nap van a visszaküldésre`, lastDay: 'Az utolsó nap a visszaküldésre',
    policyLink: 'Visszaküldési szabályzat', termsText: 'Elolvastam és elfogadom a', termsLink: 'visszaküldési szabályzatot',
    termsRequired: 'A folytatáshoz el kell fogadnia a visszaküldési szabályzatot.',
    sessionRestored: 'Visszaállítottuk a korábbi haladását.', sessionExpired: 'Előző munkamenete lejárt. Kérjük, keressen rá újra a rendelésére.',
  },
  hr: {
    step1: 'Korak 1 od 3 — Traženje narudžbe', step2: 'Korak 2 od 3 — Odabir artikala', step3: 'Korak 3 od 3 — Potvrda',
    orderNumber: 'Broj narudžbe', email: 'Email', emailPlaceholder: 'vaš@email.com',
    searchBtn: 'Pronađi narudžbu', searching: 'Traženje...', selectItems: 'Odaberite artikle',
    managementType: 'Vrsta upravljanja', returnBtn: 'Povrat', exchangeBtn: 'Zamjena',
    exchangeProduct: 'Zamjenski proizvod', changeBtn: 'Promijeni', chooseProduct: '+ Odaberi zamjenski proizvod',
    reason: 'Razlog *', reasonPlaceholder: 'Odaberite razlog…', notes: 'Bilješke (nije obavezno)', notesPlaceholder: 'Npr. veličina premala…',
    photoLabel: 'Fotografija kvara *', photoHint: 'Trebamo fotografiju stanja artikla', photoUploadBtn: '📷 Učitaj fotografiju', photoChangeBtn: 'Promijeni fotografiju',
    back: 'Natrag', continueBtn: (n) => `Nastavi (${n} artikl${n !== 1 ? 'a' : ''})`, processing: 'Obrada…',
    selectAtLeast: 'Odaberite barem jedan artikl.', chooseReason: 'Odaberite razlog za svaki artikl.',
    chooseExchange: 'Odaberite zamjenski proizvod za artikle označene kao ZAMJENA.', photoRequired: 'Učitajte fotografiju za artikle s kvarom.',
    summary: 'Sažetak', refundLabel: 'Povrat za vraćeni artikl', chargeLabel: 'Naknada za novi proizvod', favorLabel: 'Razlika u vašu korist',
    shippingLabel: 'Correos naljepnica', totalLabel: 'Ukupno za platiti',
    searchProductPlaceholder: 'Pretraži proizvod…', loadingProducts: 'Učitavanje proizvoda…', noResults: 'Nema rezultata', chooseExchangeTitle: 'Odaberi zamjenski proizvod',
    available: 'dostupan', availablePlural: 'dostupno', from: 'Od',
    deliveredDaysAgo: (n) => `Isporučeno prije ${n} ${n === 1 ? 'dan' : 'dana'}`,
    daysLeft: (n) => `Preostalo ${n} ${n === 1 ? 'dan' : 'dana'} za povrat`, lastDay: 'Posljednji dan za pokretanje povrata',
    policyLink: 'Politika povrata', termsText: 'Pročitao/la sam i prihvaćam', termsLink: 'politiku povrata',
    termsRequired: 'Morate prihvatiti politiku povrata da biste nastavili.',
    sessionRestored: 'Obnovili smo vaš prethodni napredak.', sessionExpired: 'Vaša prethodna sesija je istekla. Pretražite svoju narudžbu ponovo.',
  },
  cs: {
    step1: 'Krok 1 ze 3 — Vyhledat objednávku', step2: 'Krok 2 ze 3 — Vybrat položky', step3: 'Krok 3 ze 3 — Potvrzení',
    orderNumber: 'Číslo objednávky', email: 'Email', emailPlaceholder: 'vaše@email.com',
    searchBtn: 'Vyhledat objednávku', searching: 'Vyhledávání...', selectItems: 'Vyberte položky',
    managementType: 'Typ správy', returnBtn: 'Vrátit', exchangeBtn: 'Vyměnit',
    exchangeProduct: 'Výměnný produkt', changeBtn: 'Změnit', chooseProduct: '+ Vybrat výměnný produkt',
    reason: 'Důvod *', reasonPlaceholder: 'Vyberte důvod…', notes: 'Poznámky (volitelné)', notesPlaceholder: 'Např. velikost příliš malá…',
    photoLabel: 'Foto závady *', photoHint: 'Potřebujeme foto stavu položky', photoUploadBtn: '📷 Nahrát foto', photoChangeBtn: 'Změnit foto',
    back: 'Zpět', continueBtn: (n) => `Pokračovat (${n})`, processing: 'Zpracování…',
    selectAtLeast: 'Vyberte alespoň jednu položku.', chooseReason: 'Vyberte důvod pro každou položku.',
    chooseExchange: 'Vyberte výměnný produkt pro položky označené jako VÝMĚNA.', photoRequired: 'Nahrajte foto pro poškozené položky.',
    summary: 'Souhrn', refundLabel: 'Vrácení za vrácenou položku', chargeLabel: 'Poplatek za nový produkt', favorLabel: 'Rozdíl ve váš prospěch',
    shippingLabel: 'Štítek Correos', totalLabel: 'Celkem k zaplacení',
    searchProductPlaceholder: 'Hledat produkt…', loadingProducts: 'Načítání produktů…', noResults: 'Žádné výsledky', chooseExchangeTitle: 'Vybrat výměnný produkt',
    available: 'dostupný', availablePlural: 'dostupných', from: 'Od',
    deliveredDaysAgo: (n) => `Doručeno před ${n} dny`,
    daysLeft: (n) => `Zbývá ${n} dní na vrácení`, lastDay: 'Poslední den pro zahájení vrácení',
    policyLink: 'Zásady vrácení', termsText: 'Přečetl/a jsem a souhlasím s', termsLink: 'zásadami vrácení',
    termsRequired: 'Musíte přijmout zásady vrácení, abyste mohli pokračovat.',
    sessionRestored: 'Obnovili jsme váš předchozí postup.', sessionExpired: 'Vaše předchozí relace vypršela. Vyhledejte znovu svou objednávku.',
  },
  da: {
    step1: 'Trin 1 af 3 — Find ordre', step2: 'Trin 2 af 3 — Vælg artikler', step3: 'Trin 3 af 3 — Bekræftelse',
    orderNumber: 'Ordrenummer', email: 'Email', emailPlaceholder: 'din@email.com',
    searchBtn: 'Find ordre', searching: 'Søger...', selectItems: 'Vælg artikler',
    managementType: 'Type håndtering', returnBtn: 'Returner', exchangeBtn: 'Ombyt',
    exchangeProduct: 'Ombytningsprodukt', changeBtn: 'Ændre', chooseProduct: '+ Vælg ombytningsprodukt',
    reason: 'Årsag *', reasonPlaceholder: 'Vælg en årsag…', notes: 'Bemærkninger (valgfrit)', notesPlaceholder: 'F.eks. størrelse for lille…',
    photoLabel: 'Foto af fejlen *', photoHint: 'Vi har brug for et foto af artiklens tilstand', photoUploadBtn: '📷 Upload foto', photoChangeBtn: 'Skift foto',
    back: 'Tilbage', continueBtn: (n) => `Fortsæt (${n} artikel${n !== 1 ? 'er' : ''})`, processing: 'Behandling…',
    selectAtLeast: 'Vælg mindst én artikel.', chooseReason: 'Vælg en årsag for hver artikel.',
    chooseExchange: 'Vælg et ombytningsprodukt for artikler markeret som OMBYTNING.', photoRequired: 'Upload et foto for artikler med fejl.',
    summary: 'Oversigt', refundLabel: 'Refundering for returneret', chargeLabel: 'Gebyr for nyt produkt', favorLabel: 'Forskel til din fordel',
    shippingLabel: 'Correos etiket', totalLabel: 'I alt at betale',
    searchProductPlaceholder: 'Søg produkt…', loadingProducts: 'Indlæser produkter…', noResults: 'Ingen resultater', chooseExchangeTitle: 'Vælg ombytningsprodukt',
    available: 'tilgængelig', availablePlural: 'tilgængelige', from: 'Fra',
    deliveredDaysAgo: (n) => `Leveret for ${n} dag${n !== 1 ? 'e' : ''} siden`,
    daysLeft: (n) => `${n} dag${n !== 1 ? 'e' : ''} tilbage til returnering`, lastDay: 'Sidste dag for at starte returnering',
    policyLink: 'Returpolitik', termsText: 'Jeg har læst og accepterer', termsLink: 'returpolitikken',
    termsRequired: 'Du skal acceptere returpolitikken for at fortsætte.',
    sessionRestored: 'Vi har gendannet din tidligere fremgang.', sessionExpired: 'Din tidligere session er udløbet. Søg efter din ordre igen.',
  },
  sv: {
    step1: 'Steg 1 av 3 — Hitta beställning', step2: 'Steg 2 av 3 — Välj artiklar', step3: 'Steg 3 av 3 — Bekräftelse',
    orderNumber: 'Beställningsnummer', email: 'E-post', emailPlaceholder: 'din@email.com',
    searchBtn: 'Hitta beställning', searching: 'Söker...', selectItems: 'Välj artiklar',
    managementType: 'Typ av hantering', returnBtn: 'Returnera', exchangeBtn: 'Byta',
    exchangeProduct: 'Bytesprodukt', changeBtn: 'Ändra', chooseProduct: '+ Välj bytesprodukt',
    reason: 'Anledning *', reasonPlaceholder: 'Välj en anledning…', notes: 'Anteckningar (valfritt)', notesPlaceholder: 'T.ex. för liten storlek…',
    photoLabel: 'Foto på felet *', photoHint: 'Vi behöver ett foto på artikelns skick', photoUploadBtn: '📷 Ladda upp foto', photoChangeBtn: 'Byt foto',
    back: 'Tillbaka', continueBtn: (n) => `Fortsätt (${n} artikel${n !== 1 ? 'ar' : ''})`, processing: 'Behandlar…',
    selectAtLeast: 'Välj minst en artikel.', chooseReason: 'Välj en anledning för varje artikel.',
    chooseExchange: 'Välj en bytesprodukt för artiklar märkta som BYTE.', photoRequired: 'Ladda upp ett foto för artiklar med defekter.',
    summary: 'Sammanfattning', refundLabel: 'Återbetalning för returnerat', chargeLabel: 'Avgift för ny produkt', favorLabel: 'Skillnad till din fördel',
    shippingLabel: 'Correos etikett', totalLabel: 'Totalt att betala',
    searchProductPlaceholder: 'Sök produkt…', loadingProducts: 'Laddar produkter…', noResults: 'Inga resultat', chooseExchangeTitle: 'Välj bytesprodukt',
    available: 'tillgänglig', availablePlural: 'tillgängliga', from: 'Från',
    deliveredDaysAgo: (n) => `Levererades för ${n} dag${n !== 1 ? 'ar' : ''} sedan`,
    daysLeft: (n) => `${n} dag${n !== 1 ? 'ar' : ''} kvar att returnera`, lastDay: 'Sista dag att starta retur',
    policyLink: 'Returpolicy', termsText: 'Jag har läst och accepterar', termsLink: 'returpolicyn',
    termsRequired: 'Du måste acceptera returpolicyn för att fortsätta.',
    sessionRestored: 'Vi återställde ditt tidigare framsteg.', sessionExpired: 'Din tidigare session har löpt ut. Sök efter din beställning igen.',
  },
  fi: {
    step1: 'Vaihe 1/3 — Etsi tilaus', step2: 'Vaihe 2/3 — Valitse tuotteet', step3: 'Vaihe 3/3 — Vahvistus',
    orderNumber: 'Tilausnumero', email: 'Sähköposti', emailPlaceholder: 'sinun@email.com',
    searchBtn: 'Etsi tilaus', searching: 'Haetaan...', selectItems: 'Valitse tuotteet',
    managementType: 'Hallintamuoto', returnBtn: 'Palauta', exchangeBtn: 'Vaihda',
    exchangeProduct: 'Vaihtotuote', changeBtn: 'Muuta', chooseProduct: '+ Valitse vaihtotuote',
    reason: 'Syy *', reasonPlaceholder: 'Valitse syy…', notes: 'Huomautukset (valinnainen)', notesPlaceholder: 'Esim. koko liian pieni…',
    photoLabel: 'Kuva viasta *', photoHint: 'Tarvitsemme kuvan tuotteen kunnosta', photoUploadBtn: '📷 Lataa kuva', photoChangeBtn: 'Vaihda kuva',
    back: 'Takaisin', continueBtn: (n) => `Jatka (${n} tuote${n !== 1 ? 'tta' : ''})`, processing: 'Käsitellään…',
    selectAtLeast: 'Valitse vähintään yksi tuote.', chooseReason: 'Valitse syy jokaiselle tuotteelle.',
    chooseExchange: 'Valitse vaihtotuote VAIHTO-merkityille tuotteille.', photoRequired: 'Lataa kuva viallisille tuotteille.',
    summary: 'Yhteenveto', refundLabel: 'Hyvitys palautetuista', chargeLabel: 'Maksu uudesta tuotteesta', favorLabel: 'Erotus sinun eduksesi',
    shippingLabel: 'Correos tarra', totalLabel: 'Maksettava yhteensä',
    searchProductPlaceholder: 'Etsi tuotetta…', loadingProducts: 'Ladataan tuotteita…', noResults: 'Ei tuloksia', chooseExchangeTitle: 'Valitse vaihtotuote',
    available: 'saatavilla', availablePlural: 'saatavilla', from: 'Alkaen',
    deliveredDaysAgo: (n) => `Toimitettu ${n} päivää sitten`,
    daysLeft: (n) => `${n} päivää jäljellä palautukseen`, lastDay: 'Viimeinen päivä palautuksen aloittamiseen',
    policyLink: 'Palautuskäytäntö', termsText: 'Olen lukenut ja hyväksyn', termsLink: 'palautuskäytännön',
    termsRequired: 'Sinun on hyväksyttävä palautuskäytäntö jatkaaksesi.',
    sessionRestored: 'Palautimme aiemman edistymisesi.', sessionExpired: 'Edellinen istuntosi on vanhentunut. Etsi tilauksesi uudelleen.',
  },
  el: {
    step1: 'Βήμα 1 από 3 — Αναζήτηση παραγγελίας', step2: 'Βήμα 2 από 3 — Επιλογή προϊόντων', step3: 'Βήμα 3 από 3 — Επιβεβαίωση',
    orderNumber: 'Αριθμός παραγγελίας', email: 'Email', emailPlaceholder: 'email@example.com',
    searchBtn: 'Αναζήτηση παραγγελίας', searching: 'Αναζήτηση...', selectItems: 'Επιλέξτε προϊόντα',
    managementType: 'Τύπος διαχείρισης', returnBtn: 'Επιστροφή', exchangeBtn: 'Ανταλλαγή',
    exchangeProduct: 'Προϊόν ανταλλαγής', changeBtn: 'Αλλαγή', chooseProduct: '+ Επιλέξτε προϊόν ανταλλαγής',
    reason: 'Λόγος *', reasonPlaceholder: 'Επιλέξτε λόγο…', notes: 'Σημειώσεις (προαιρετικό)', notesPlaceholder: 'Π.χ. νούμερο πολύ μικρό…',
    photoLabel: 'Φωτογραφία ελαττώματος *', photoHint: 'Χρειαζόμαστε φωτογραφία της κατάστασης του προϊόντος', photoUploadBtn: '📷 Ανέβασμα φωτογραφίας', photoChangeBtn: 'Αλλαγή φωτογραφίας',
    back: 'Πίσω', continueBtn: (n) => `Συνέχεια (${n})`, processing: 'Επεξεργασία…',
    selectAtLeast: 'Επιλέξτε τουλάχιστον ένα προϊόν.', chooseReason: 'Επιλέξτε λόγο για κάθε προϊόν.',
    chooseExchange: 'Επιλέξτε προϊόν ανταλλαγής για τα προϊόντα που έχουν επισημανθεί ως ΑΝΤΑΛΛΑΓΗ.', photoRequired: 'Ανεβάστε φωτογραφία για τα ελαττωματικά προϊόντα.',
    summary: 'Περίληψη', refundLabel: 'Επιστροφή χρημάτων για επιστραφέν', chargeLabel: 'Χρέωση για νέο προϊόν', favorLabel: 'Διαφορά υπέρ σας',
    shippingLabel: 'Ετικέτα Correos', totalLabel: 'Σύνολο προς πληρωμή',
    searchProductPlaceholder: 'Αναζήτηση προϊόντος…', loadingProducts: 'Φόρτωση προϊόντων…', noResults: 'Δεν βρέθηκαν αποτελέσματα', chooseExchangeTitle: 'Επιλέξτε προϊόν ανταλλαγής',
    available: 'διαθέσιμο', availablePlural: 'διαθέσιμα', from: 'Από',
    deliveredDaysAgo: (n) => `Παραδόθηκε πριν από ${n} ημέρ${n !== 1 ? 'ες' : 'α'}`,
    daysLeft: (n) => `Απομένουν ${n} ημέρ${n !== 1 ? 'ες' : 'α'} για επιστροφή`, lastDay: 'Τελευταία ημέρα για έναρξη επιστροφής',
    policyLink: 'Πολιτική επιστροφών', termsText: 'Διάβασα και αποδέχομαι την', termsLink: 'πολιτική επιστροφών',
    termsRequired: 'Πρέπει να αποδεχτείτε την πολιτική επιστροφών για να συνεχίσετε.',
    sessionRestored: 'Αποκαταστήσαμε την προηγούμενη πρόοδό σας.', sessionExpired: 'Η προηγούμενη συνεδρία σας έχει λήξει. Αναζητήστε ξανά την παραγγελία σας.',
  },
  ro: {
    step1: 'Pasul 1 din 3 — Căutare comandă', step2: 'Pasul 2 din 3 — Selectare produse', step3: 'Pasul 3 din 3 — Confirmare',
    orderNumber: 'Numărul comenzii', email: 'Email', emailPlaceholder: 'al.tau@email.com',
    searchBtn: 'Caută comanda', searching: 'Căutare...', selectItems: 'Selectați produsele',
    managementType: 'Tip de gestionare', returnBtn: 'Returnare', exchangeBtn: 'Schimb',
    exchangeProduct: 'Produs de schimb', changeBtn: 'Schimbă', chooseProduct: '+ Alegeți produs de schimb',
    reason: 'Motiv *', reasonPlaceholder: 'Selectați un motiv…', notes: 'Note (opțional)', notesPlaceholder: 'Ex: dimensiunea prea mică…',
    photoLabel: 'Foto a defectului *', photoHint: 'Avem nevoie de o fotografie a stării produsului', photoUploadBtn: '📷 Încarcă fotografie', photoChangeBtn: 'Schimbă fotografia',
    back: 'Înapoi', continueBtn: (n) => `Continuați (${n} produs${n !== 1 ? 'e' : ''})`, processing: 'Se procesează…',
    selectAtLeast: 'Selectați cel puțin un produs.', chooseReason: 'Alegeți un motiv pentru fiecare produs.',
    chooseExchange: 'Alegeți un produs de schimb pentru produsele marcate ca SCHIMB.', photoRequired: 'Încărcați o fotografie pentru produsele cu defecte.',
    summary: 'Rezumat', refundLabel: 'Rambursare pentru returnat', chargeLabel: 'Taxă pentru produs nou', favorLabel: 'Diferență în favoarea dvs.',
    shippingLabel: 'Etichetă Correos', totalLabel: 'Total de plătit',
    searchProductPlaceholder: 'Caută produs…', loadingProducts: 'Se încarcă produsele…', noResults: 'Niciun rezultat', chooseExchangeTitle: 'Alegeți produs de schimb',
    available: 'disponibil', availablePlural: 'disponibile', from: 'De la',
    deliveredDaysAgo: (n) => `Livrat acum ${n} zi${n !== 1 ? 'le' : ''}`,
    daysLeft: (n) => `Mai sunt ${n} zi${n !== 1 ? 'le' : 'ua'} pentru returnare`, lastDay: 'Ultima zi pentru inițierea returnării',
    policyLink: 'Politica de returnare', termsText: 'Am citit și accept', termsLink: 'politica de returnare',
    termsRequired: 'Trebuie să acceptați politica de returnare pentru a continua.',
    sessionRestored: 'Am recuperat progresul dvs. anterior.', sessionExpired: 'Sesiunea dvs. anterioară a expirat. Căutați din nou comanda dvs.',
  },
  bg: {
    step1: 'Стъпка 1 от 3 — Търсене на поръчка', step2: 'Стъпка 2 от 3 — Избор на артикули', step3: 'Стъпка 3 от 3 — Потвърждение',
    orderNumber: 'Номер на поръчката', email: 'Имейл', emailPlaceholder: 'вашият@email.com',
    searchBtn: 'Търси поръчка', searching: 'Търсене...', selectItems: 'Изберете артикули',
    managementType: 'Тип управление', returnBtn: 'Върни', exchangeBtn: 'Замени',
    exchangeProduct: 'Продукт за замяна', changeBtn: 'Промени', chooseProduct: '+ Избери продукт за замяна',
    reason: 'Причина *', reasonPlaceholder: 'Изберете причина…', notes: 'Бележки (незадължително)', notesPlaceholder: 'Напр. размерът е твърде малък…',
    photoLabel: 'Снимка на дефекта *', photoHint: 'Необходима ни е снимка на състоянието на артикула', photoUploadBtn: '📷 Качи снимка', photoChangeBtn: 'Промени снимката',
    back: 'Назад', continueBtn: (n) => `Продължи (${n})`, processing: 'Обработка…',
    selectAtLeast: 'Изберете поне един артикул.', chooseReason: 'Изберете причина за всеки артикул.',
    chooseExchange: 'Изберете продукт за замяна за артикулите, отбелязани като ЗАМЯНА.', photoRequired: 'Качете снимка за артикулите с дефекти.',
    summary: 'Резюме', refundLabel: 'Възстановяване за върнат артикул', chargeLabel: 'Такса за нов продукт', favorLabel: 'Разлика във ваша полза',
    shippingLabel: 'Етикет Correos', totalLabel: 'Общо за плащане',
    searchProductPlaceholder: 'Търси продукт…', loadingProducts: 'Зареждане на продукти…', noResults: 'Няма резултати', chooseExchangeTitle: 'Избери продукт за замяна',
    available: 'наличен', availablePlural: 'налични', from: 'От',
    deliveredDaysAgo: (n) => `Доставено преди ${n} дни`,
    daysLeft: (n) => `Остават ${n} дни за връщане`, lastDay: 'Последен ден за стартиране на връщането',
    policyLink: 'Политика за връщане', termsText: 'Прочетох и приемам', termsLink: 'политиката за връщане',
    termsRequired: 'Трябва да приемете политиката за връщане, за да продължите.',
    sessionRestored: 'Възстановихме предишния ви напредък.', sessionExpired: 'Предишната ви сесия е изтекла. Моля, потърсете поръчката си отново.',
  },
  sk: {
    step1: 'Krok 1 z 3 — Vyhľadať objednávku', step2: 'Krok 2 z 3 — Vybrať položky', step3: 'Krok 3 z 3 — Potvrdenie',
    orderNumber: 'Číslo objednávky', email: 'Email', emailPlaceholder: 'vaše@email.com',
    searchBtn: 'Vyhľadať objednávku', searching: 'Vyhľadávanie...', selectItems: 'Vyberte položky',
    managementType: 'Typ správy', returnBtn: 'Vrátiť', exchangeBtn: 'Vymeniť',
    exchangeProduct: 'Výmenný produkt', changeBtn: 'Zmeniť', chooseProduct: '+ Vybrať výmenný produkt',
    reason: 'Dôvod *', reasonPlaceholder: 'Vyberte dôvod…', notes: 'Poznámky (voliteľné)', notesPlaceholder: 'Napr. veľkosť príliš malá…',
    photoLabel: 'Foto závady *', photoHint: 'Potrebujeme foto stavu položky', photoUploadBtn: '📷 Nahrať foto', photoChangeBtn: 'Zmeniť foto',
    back: 'Späť', continueBtn: (n) => `Pokračovať (${n})`, processing: 'Spracovávanie…',
    selectAtLeast: 'Vyberte aspoň jednu položku.', chooseReason: 'Vyberte dôvod pre každú položku.',
    chooseExchange: 'Vyberte výmenný produkt pre položky označené ako VÝMENA.', photoRequired: 'Nahrajte foto pre poškodené položky.',
    summary: 'Súhrn', refundLabel: 'Vrátenie za vrátenú položku', chargeLabel: 'Poplatok za nový produkt', favorLabel: 'Rozdiel vo váš prospech',
    shippingLabel: 'Štítok Correos', totalLabel: 'Celkom na zaplatenie',
    searchProductPlaceholder: 'Hľadať produkt…', loadingProducts: 'Načítavanie produktov…', noResults: 'Žiadne výsledky', chooseExchangeTitle: 'Vybrať výmenný produkt',
    available: 'dostupný', availablePlural: 'dostupných', from: 'Od',
    deliveredDaysAgo: (n) => `Doručené pred ${n} dňami`,
    daysLeft: (n) => `Zostáva ${n} dní na vrátenie`, lastDay: 'Posledný deň na začatie vrátenia',
    policyLink: 'Zásady vrátenia', termsText: 'Prečítal/a som a súhlasím so', termsLink: 'zásadami vrátenia',
    termsRequired: 'Musíte prijať zásady vrátenia, aby ste mohli pokračovať.',
    sessionRestored: 'Obnovili sme váš predchádzajúci postup.', sessionExpired: 'Vaša predchádzajúca relácia vypršala. Vyhľadajte znovu svoju objednávku.',
  },
  sl: {
    step1: 'Korak 1 od 3 — Iskanje naročila', step2: 'Korak 2 od 3 — Izbira artiklov', step3: 'Korak 3 od 3 — Potrditev',
    orderNumber: 'Številka naročila', email: 'Email', emailPlaceholder: 'vaše@email.com',
    searchBtn: 'Poišči naročilo', searching: 'Iskanje...', selectItems: 'Izberite artikle',
    managementType: 'Vrsta upravljanja', returnBtn: 'Vrni', exchangeBtn: 'Zamenjaj',
    exchangeProduct: 'Nadomestni izdelek', changeBtn: 'Spremeni', chooseProduct: '+ Izberi nadomestni izdelek',
    reason: 'Razlog *', reasonPlaceholder: 'Izberite razlog…', notes: 'Opombe (neobvezno)', notesPlaceholder: 'Npr. velikost premajhna…',
    photoLabel: 'Fotografija napake *', photoHint: 'Potrebujemo fotografijo stanja artikla', photoUploadBtn: '📷 Naloži fotografijo', photoChangeBtn: 'Zamenjaj fotografijo',
    back: 'Nazaj', continueBtn: (n) => `Nadaljuj (${n})`, processing: 'Obdelava…',
    selectAtLeast: 'Izberite vsaj en artikel.', chooseReason: 'Izberite razlog za vsak artikel.',
    chooseExchange: 'Izberite nadomestni izdelek za artikle, označene kot ZAMENJAVA.', photoRequired: 'Naložite fotografijo za napačne artikle.',
    summary: 'Povzetek', refundLabel: 'Povračilo za vrnjen artikel', chargeLabel: 'Pristojbina za nov izdelek', favorLabel: 'Razlika v vaše dobro',
    shippingLabel: 'Nalepka Correos', totalLabel: 'Skupaj za plačilo',
    searchProductPlaceholder: 'Iskanje izdelka…', loadingProducts: 'Nalaganje izdelkov…', noResults: 'Ni rezultatov', chooseExchangeTitle: 'Izberi nadomestni izdelek',
    available: 'na voljo', availablePlural: 'na voljo', from: 'Od',
    deliveredDaysAgo: (n) => `Dostavljeno pred ${n} dnevi`,
    daysLeft: (n) => `Še ${n} dni za vrnitev`, lastDay: 'Zadnji dan za začetek vračila',
    policyLink: 'Politika vračil', termsText: 'Prebral/a sem in se strinjam s', termsLink: 'politiko vračil',
    termsRequired: 'Za nadaljevanje morate sprejeti politiko vračil.',
    sessionRestored: 'Obnovili smo vaš prejšnji napredek.', sessionExpired: 'Vaša prejšnja seja je potekla. Poiščite svoje naročilo znova.',
  },
  et: {
    step1: 'Samm 1/3 — Otsi tellimus', step2: 'Samm 2/3 — Vali artiklid', step3: 'Samm 3/3 — Kinnitus',
    orderNumber: 'Tellimuse number', email: 'Email', emailPlaceholder: 'sinu@email.com',
    searchBtn: 'Otsi tellimus', searching: 'Otsimine...', selectItems: 'Vali artiklid',
    managementType: 'Halduse tüüp', returnBtn: 'Tagasta', exchangeBtn: 'Vaheta',
    exchangeProduct: 'Vahetatav toode', changeBtn: 'Muuda', chooseProduct: '+ Vali vahetatav toode',
    reason: 'Põhjus *', reasonPlaceholder: 'Vali põhjus…', notes: 'Märkused (valikuline)', notesPlaceholder: 'Nt. suurus liiga väike…',
    photoLabel: 'Foto defektist *', photoHint: 'Vajame fotot artikli seisukorrast', photoUploadBtn: '📷 Laadi foto üles', photoChangeBtn: 'Muuda fotot',
    back: 'Tagasi', continueBtn: (n) => `Jätka (${n})`, processing: 'Töötlemine…',
    selectAtLeast: 'Vali vähemalt üks artikkel.', chooseReason: 'Vali põhjus iga artikli jaoks.',
    chooseExchange: 'Vali vahetatav toode VAHETA-ga märgitud artiklite jaoks.', photoRequired: 'Laadi üles foto defektiga artiklite jaoks.',
    summary: 'Kokkuvõte', refundLabel: 'Tagastus tagastatud eest', chargeLabel: 'Tasu uue toote eest', favorLabel: 'Vahe sinu kasuks',
    shippingLabel: 'Correos silt', totalLabel: 'Kokku maksta',
    searchProductPlaceholder: 'Otsi toodet…', loadingProducts: 'Toodete laadimine…', noResults: 'Tulemusi pole', chooseExchangeTitle: 'Vali vahetatav toode',
    available: 'saadaval', availablePlural: 'saadaval', from: 'Alates',
    deliveredDaysAgo: (n) => `Kohale toimetatud ${n} päeva tagasi`,
    daysLeft: (n) => `${n} päeva jäänud tagastamiseks`, lastDay: 'Viimane päev tagastuse alustamiseks',
    policyLink: 'Tagastuspoliitika', termsText: 'Olen lugenud ja nõustun', termsLink: 'tagastuspoliitikaga',
    termsRequired: 'Jätkamiseks peate tagastuspoliitikaga nõustuma.',
    sessionRestored: 'Taastasime teie eelmise edenemise.', sessionExpired: 'Teie eelmine seanss on aegunud. Otsige oma tellimus uuesti.',
  },
  lv: {
    step1: '1. solis no 3 — Meklēt pasūtījumu', step2: '2. solis no 3 — Izvēlieties preces', step3: '3. solis no 3 — Apstiprinājums',
    orderNumber: 'Pasūtījuma numurs', email: 'E-pasts', emailPlaceholder: 'jūsu@email.com',
    searchBtn: 'Meklēt pasūtījumu', searching: 'Meklē...', selectItems: 'Izvēlieties preces',
    managementType: 'Pārvaldības veids', returnBtn: 'Atgriezt', exchangeBtn: 'Apmainīt',
    exchangeProduct: 'Apmaiņas prece', changeBtn: 'Mainīt', chooseProduct: '+ Izvēlieties apmaiņas preci',
    reason: 'Iemesls *', reasonPlaceholder: 'Izvēlieties iemeslu…', notes: 'Piezīmes (neobligāti)', notesPlaceholder: 'Piem. izmērs pārāk mazs…',
    photoLabel: 'Foto par defektu *', photoHint: 'Mums ir nepieciešams foto par preces stāvokli', photoUploadBtn: '📷 Augšupielādēt foto', photoChangeBtn: 'Mainīt foto',
    back: 'Atpakaļ', continueBtn: (n) => `Turpināt (${n})`, processing: 'Apstrāde…',
    selectAtLeast: 'Izvēlieties vismaz vienu preci.', chooseReason: 'Izvēlieties iemeslu katrai precei.',
    chooseExchange: 'Izvēlieties apmaiņas preci precēm, kas atzīmētas kā APMAIŅA.', photoRequired: 'Augšupielādējiet foto precēm ar defektiem.',
    summary: 'Kopsavilkums', refundLabel: 'Atmaksa par atgriezto', chargeLabel: 'Maksa par jauno preci', favorLabel: 'Starpība jūsu labā',
    shippingLabel: 'Correos uzlīme', totalLabel: 'Kopā jāmaksā',
    searchProductPlaceholder: 'Meklēt preci…', loadingProducts: 'Ielādē preces…', noResults: 'Nav rezultātu', chooseExchangeTitle: 'Izvēlieties apmaiņas preci',
    available: 'pieejams', availablePlural: 'pieejami', from: 'No',
    deliveredDaysAgo: (n) => `Piegādāts pirms ${n} dienām`,
    daysLeft: (n) => `Atlikušas ${n} dienas atgriešanai`, lastDay: 'Pēdējā diena atgriešanas uzsākšanai',
    policyLink: 'Atgriešanas politika', termsText: 'Esmu izlasījis/usi un piekrītu', termsLink: 'atgriešanas politikai',
    termsRequired: 'Lai turpinātu, jums jāpiekrīt atgriešanas politikai.',
    sessionRestored: 'Mēs atjaunojām jūsu iepriekšējo progresu.', sessionExpired: 'Jūsų iepriekšējā sesija ir beigusies. Meklējiet savu pasūtījumu vēlreiz.',
  },
  lt: {
    step1: '1 žingsnis iš 3 — Rasti užsakymą', step2: '2 žingsnis iš 3 — Pasirinkite prekes', step3: '3 žingsnis iš 3 — Patvirtinimas',
    orderNumber: 'Užsakymo numeris', email: 'El. paštas', emailPlaceholder: 'jusu@email.com',
    searchBtn: 'Rasti užsakymą', searching: 'Ieškoma...', selectItems: 'Pasirinkite prekes',
    managementType: 'Valdymo tipas', returnBtn: 'Grąžinti', exchangeBtn: 'Keisti',
    exchangeProduct: 'Keitimo prekė', changeBtn: 'Keisti', chooseProduct: '+ Pasirinkite keitimo prekę',
    reason: 'Priežastis *', reasonPlaceholder: 'Pasirinkite priežastį…', notes: 'Pastabos (neprivaloma)', notesPlaceholder: 'Pvz. dydis per mažas…',
    photoLabel: 'Defekto nuotrauka *', photoHint: 'Mums reikia prekės būklės nuotraukos', photoUploadBtn: '📷 Įkelti nuotrauką', photoChangeBtn: 'Pakeisti nuotrauką',
    back: 'Atgal', continueBtn: (n) => `Tęsti (${n})`, processing: 'Apdorojama…',
    selectAtLeast: 'Pasirinkite bent vieną prekę.', chooseReason: 'Pasirinkite priežastį kiekvienai prekei.',
    chooseExchange: 'Pasirinkite keitimo prekę pažymėtoms kaip KEITIMAS prekėms.', photoRequired: 'Įkelkite nuotrauką defektų turinčioms prekėms.',
    summary: 'Santrauka', refundLabel: 'Grąžinimas už grąžintą', chargeLabel: 'Mokestis už naują prekę', favorLabel: 'Skirtumas jūsų naudai',
    shippingLabel: 'Correos lipdukas', totalLabel: 'Iš viso mokėti',
    searchProductPlaceholder: 'Ieškoti prekės…', loadingProducts: 'Kraunamos prekės…', noResults: 'Rezultatų nėra', chooseExchangeTitle: 'Pasirinkite keitimo prekę',
    available: 'prieinamas', availablePlural: 'prieinami', from: 'Nuo',
    deliveredDaysAgo: (n) => `Pristatyta prieš ${n} dienas`,
    daysLeft: (n) => `Liko ${n} dienos grąžinimui`, lastDay: 'Paskutinė diena grąžinimui pradėti',
    policyLink: 'Grąžinimo politika', termsText: 'Perskaičiau ir sutinku su', termsLink: 'grąžinimo politika',
    termsRequired: 'Norėdami tęsti, turite sutikti su grąžinimo politika.',
    sessionRestored: 'Atkūrėme jūsų ankstesnę pažangą.', sessionExpired: 'Jūsų ankstesnis seansas baigėsi. Ieškokite savo užsakymo iš naujo.',
  },
  mt: {
    step1: 'Pass 1 minn 3 — Fittex l-ordni', step2: 'Pass 2 minn 3 — Agħżel l-oġġetti', step3: 'Pass 3 minn 3 — Konferma',
    orderNumber: "Numru tal-ordni", email: 'Email', emailPlaceholder: 'tiegħek@email.com',
    searchBtn: "Fittex l-ordni", searching: 'Tfittxija...', selectItems: "Agħżel l-oġġetti",
    managementType: "Tip ta' ġestjoni", returnBtn: 'Irritorna', exchangeBtn: 'Ibdel',
    exchangeProduct: 'Prodott tal-bdil', changeBtn: 'Ibdel', chooseProduct: '+ Agħżel prodott tal-bdil',
    reason: 'Raġuni *', reasonPlaceholder: 'Agħżel raġuni…', notes: 'Noti (mhux obbligatorju)', notesPlaceholder: 'Eż. daqs żgħir wisq…',
    photoLabel: 'Ritratt tad-difett *', photoHint: "Għandna bżonn ritratt tal-kundizzjoni tal-oġġett", photoUploadBtn: "📷 Itella' ritratt", photoChangeBtn: 'Ibdel ir-ritratt',
    back: 'Lura', continueBtn: (n) => `Kompli (${n})`, processing: 'Qed jipproċessa…',
    selectAtLeast: 'Agħżel tal-inqas oġġett wieħed.', chooseReason: 'Agħżel raġuni għal kull oġġett.',
    chooseExchange: 'Agħżel prodott tal-bdil għall-oġġetti mmarkati bħala BDIL.', photoRequired: "Itella' ritratt għall-oġġetti b'difetti.",
    summary: 'Sommarju', refundLabel: 'Rimborż għal dak li rritorna', chargeLabel: 'Ħlas għal prodott ġdid', favorLabel: 'Differenza favurik',
    shippingLabel: 'Tikketta Correos', totalLabel: 'Total biex tħallas',
    searchProductPlaceholder: 'Fittex prodott…', loadingProducts: 'Qed jgħabbi l-prodotti…', noResults: 'Ebda riżultati', chooseExchangeTitle: 'Agħżel prodott tal-bdil',
    available: 'disponibbli', availablePlural: 'disponibbli', from: 'Minn',
    deliveredDaysAgo: (n) => `Ġie kkonsenjat ${n} ġurnata ilu`,
    daysLeft: (n) => `Fadal ${n} ġurnata biex tirritorna`, lastDay: 'L-aħħar jum biex tibda r-ritorn',
    policyLink: 'Politika tar-ritorni', termsText: "Qrajt u naċċetta l-", termsLink: 'politika tar-ritorni',
    termsRequired: "Trid taċċetta l-politika tar-ritorni biex tkompli.",
    sessionRestored: 'Irrestawrajna l-progress preċedenti tiegħek.', sessionExpired: "Is-sessjoni preċedenti tiegħek skadiet. Fittex l-ordni tiegħek mill-ġdid.",
  },
  ga: {
    step1: 'Céim 1 as 3 — Cuardaigh ordú', step2: 'Céim 2 as 3 — Roghnaigh earraí', step3: 'Céim 3 as 3 — Deimhniú',
    orderNumber: 'Uimhir ordaithe', email: 'Ríomhphost', emailPlaceholder: 'do@email.com',
    searchBtn: 'Cuardaigh ordú', searching: 'Ag cuardach...', selectItems: 'Roghnaigh earraí',
    managementType: 'Cineál bainistíochta', returnBtn: 'Aischur', exchangeBtn: 'Malartú',
    exchangeProduct: 'Táirge malartaithe', changeBtn: 'Athraigh', chooseProduct: '+ Roghnaigh táirge malartaithe',
    reason: 'Cúis *', reasonPlaceholder: 'Roghnaigh cúis…', notes: 'Nótaí (roghnach)', notesPlaceholder: 'M.sh. méid rómhionlach…',
    photoLabel: 'Grianghraf den locht *', photoHint: 'Teastaíonn grianghraf uainn de staid an earra', photoUploadBtn: '📷 Uaslódáil grianghraf', photoChangeBtn: 'Athraigh grianghraf',
    back: 'Ar ais', continueBtn: (n) => `Lean ar aghaidh (${n})`, processing: 'Ag próiseáil…',
    selectAtLeast: 'Roghnaigh earra amháin ar a laghad.', chooseReason: 'Roghnaigh cúis do gach earra.',
    chooseExchange: 'Roghnaigh táirge malartaithe do earraí marcáilte mar MALARTÚ.', photoRequired: 'Uaslódáil grianghraf do earraí lochtacha.',
    summary: 'Achoimre', refundLabel: 'Aisíocaíocht as aischurtha', chargeLabel: 'Táille as táirge nua', favorLabel: 'Difríocht i do bhfabhar',
    shippingLabel: 'Lipéad Correos', totalLabel: 'Iomlán le híoc',
    searchProductPlaceholder: 'Cuardaigh táirge…', loadingProducts: 'Ag lódáil táirgí…', noResults: 'Gan torthaí', chooseExchangeTitle: 'Roghnaigh táirge malartaithe',
    available: 'ar fáil', availablePlural: 'ar fáil', from: 'Ó',
    deliveredDaysAgo: (n) => `Seachadta ${n} lá ó shin`,
    daysLeft: (n) => `${n} lá fágtha chun aischur`, lastDay: 'An lá deireanach chun aischur a thosú',
    policyLink: 'Polasaí aischurtha', termsText: "Léigh mé agus glacaim leis an", termsLink: 'bpolasaí aischurtha',
    termsRequired: 'Ní mór duit glacadh leis an bpolasaí aischurtha chun leanúint ar aghaidh.',
    sessionRestored: "D'athchuireamar do dhul chun cinn roimhe seo.", sessionExpired: "Tá do sheisiún roimhe seo dulta in éag. Cuardaigh d'ordú arís.",
  },
};

const LANG_NAMES: Record<string, string> = {
  es: '🇪🇸 Español', en: '🇬🇧 English', fr: '🇫🇷 Français', de: '🇩🇪 Deutsch',
  it: '🇮🇹 Italiano', pt: '🇵🇹 Português', nl: '🇳🇱 Nederlands', pl: '🇵🇱 Polski',
  hu: '🇭🇺 Magyar', hr: '🇭🇷 Hrvatski', cs: '🇨🇿 Čeština', da: '🇩🇰 Dansk',
  sv: '🇸🇪 Svenska', fi: '🇫🇮 Suomi', el: '🇬🇷 Ελληνικά', ro: '🇷🇴 Română',
  bg: '🇧🇬 Български', sk: '🇸🇰 Slovenčina', sl: '🇸🇮 Slovenščina',
  et: '🇪🇪 Eesti', lv: '🇱🇻 Latviešu', lt: '🇱🇹 Lietuvių', mt: '🇲🇹 Malti', ga: '🇮🇪 Gaeilge',
};

type Lang = string;

export default function DevolucionesPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [orderNumber, setOrderNumber] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [selections, setSelections] = useState<Record<string, ItemSelection>>({});
  const [portalConfig, setPortalConfig] = useState<PortalConfig>(DEFAULT_PORTAL_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [returnResult, setReturnResult] = useState<CreateReturnResponse | null>(null);

  // Exchange picker modal
  const [pickerForItem, setPickerForItem] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  // Language — fixed 'es', user can change via selector
  const [lang, setLang] = useState<Lang>('es');
  const t: LangStrings = TRANSLATIONS[lang] ?? TRANSLATIONS['es'];

  // Policy checkbox
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Session banner
  const [sessionBanner, setSessionBanner] = useState<'restored' | 'expired' | null>(null);

  // After Shopify checkout: poll status
  const [polling, setPolling] = useState(false);
  const [pollStatus, setPollStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnId = params.get('return_id');
    if (returnId) {
      setPolling(true);
      setStep(3);
      const poll = async () => {
        try {
          const res = await fetch(`${API_URL}/returns/${returnId}/status`);
          if (!res.ok) return;
          const data = (await res.json()) as StatusResponse;
          setPollStatus(data);
          if (data.paymentStatus === 'PAID' && data.labelUrl) {
            setPolling(false);
          }
        } catch {}
      };
      poll();
      const interval = setInterval(poll, 5000);
      return () => clearInterval(interval);
    }
  }, []);

  // Restore session from localStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('return_id')) return; // already in poll flow, skip restore

    try {
      const saved = localStorage.getItem('sw_return_session');
      if (!saved) return;
      const { orderNumber: on, email: em, lookup: lk, selections: sl, savedAt, lang: lg } = JSON.parse(saved);

      // Expire after 2 hours
      if (Date.now() - savedAt > 2 * 60 * 60 * 1000) {
        localStorage.removeItem('sw_return_session');
        setSessionBanner('expired');
        if (on) setOrderNumber(on);
        if (em) setEmail(em);
        return;
      }

      if (lk && sl) {
        setOrderNumber(on ?? '');
        setEmail(em ?? '');
        setLookup(lk);
        setSelections(sl);
        // lang not restored — always default 'es'
        setStep(2);
        setSessionBanner('restored');
      } else {
        if (on) setOrderNumber(on);
        if (em) setEmail(em);
      }
    } catch {
      localStorage.removeItem('sw_return_session');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist session to localStorage whenever key state changes
  useEffect(() => {
    if (step === 3) return; // don't save completed session
    try {
      localStorage.setItem('sw_return_session', JSON.stringify({
        orderNumber, email,
        lookup: lookup ?? undefined,
        selections: Object.keys(selections).length > 0 ? selections : undefined,
        savedAt: Date.now(),
        lang,
      }));
    } catch {}
  }, [orderNumber, email, lookup, selections, step, lang]);

  useEffect(() => {
    fetch(`${API_URL}/portal-config`)
      .then((r) => {
        if (!r.ok) throw new Error('no config');
        return r.json();
      })
      .then((data: PortalConfig) => {
        const merged = { ...DEFAULT_PORTAL_CONFIG, ...data };
        setPortalConfig(merged);
        // Apply custom favicon if set
        if (merged.faviconUrl) {
          const link: HTMLLinkElement = document.querySelector("link[rel='icon']") || document.createElement('link');
          link.rel = 'icon';
          link.href = merged.faviconUrl;
          document.head.appendChild(link);
        }
        if (merged.backgroundUrl) {
          const img = new Image();
          img.onload = () => setConfigLoaded(true);
          img.onerror = () => setConfigLoaded(true);
          img.src = merged.backgroundUrl;
        } else {
          setConfigLoaded(true);
        }
      })
      .catch(() => setConfigLoaded(true));
  }, []);

  function compressImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new window.Image();
        img.onerror = reject;
        img.onload = () => {
          const MAX = 1200;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width > height) { height = Math.round((height * MAX) / width); width = MAX; }
            else { width = Math.round((width * MAX) / height); height = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('canvas')); return; }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  async function loadCatalog() {
    if (catalog.length > 0) return;
    setCatalogLoading(true);
    try {
      const res = await fetch(`${API_URL}/returns/catalog`);
      const data = await res.json();
      setCatalog(Array.isArray(data) ? data : []);
    } catch {
      setError('No se pudo cargar el catálogo de productos.');
    } finally {
      setCatalogLoading(false);
    }
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/returns/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: orderNumber.trim(), email: email.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Error al buscar pedido');
      const lr = data as LookupResult;
      if (lr.windowExpired) {
        setError(`Han pasado ${lr.daysSince} días desde la entrega. El plazo de devolución es ${lr.windowDays} días.`);
        setLoading(false);
        return;
      }
      // strip address object to avoid React #31 error
      const { shippingAddressJson: _addr, ...lrClean } = lr as LookupResult & { shippingAddressJson?: unknown };
      void _addr;
      setLookup(lrClean as LookupResult);
      const initial: Record<string, ItemSelection> = {};
      for (const item of lr.items) {
        initial[item.id] = { selected: false, action: 'RETURN', quantity: 1, reason: '', notes: '' };
      }
      setSelections(initial);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }

  function updateSelection(itemId: string, patch: Partial<ItemSelection>) {
    setSelections((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  function openPicker(itemId: string) {
    setPickerForItem(itemId);
    loadCatalog();
  }

  function pickReplacement(variant: CatalogVariant, product: CatalogProduct) {
    if (!pickerForItem) return;
    updateSelection(pickerForItem, {
      replacement: {
        variantId: variant.id,
        productId: product.id,
        title: `${product.title} — ${variant.title}`,
        price: variant.price,
        imageUrl: variant.imageUrl ?? product.imageUrl ?? undefined
      }
    });
    setPickerForItem(null);
    setExpandedProduct(null);
  }

  async function handleSubmitReturn(e: React.FormEvent) {
    e.preventDefault();
    if (!lookup) return;
    setError(null);

    const selectedEntries = Object.entries(selections).filter(([, s]) => s.selected);
    if (selectedEntries.length === 0) {
      setError('Selecciona al menos un artículo.');
      return;
    }

    const hasExchange = selectedEntries.some(([, s]) => s.action === 'EXCHANGE');
    const type: Action = hasExchange ? 'EXCHANGE' : 'RETURN';

    for (const [, s] of selectedEntries) {
      if (!s.reason) {
        setError(t.chooseReason);
        return;
      }
      if (s.action === 'EXCHANGE' && !s.replacement) {
        setError(t.chooseExchange);
        return;
      }
      if (PHOTO_REASONS.includes(s.reason) && !s.photo) {
        setError(t.photoRequired);
        return;
      }
    }

    const items = selectedEntries.map(([id, s]) => ({
      orderItemId: id,
      quantity: s.quantity,
      reason: s.reason,
      notes: s.notes || undefined,
      ...(s.replacement
        ? {
            replacementVariantId: s.replacement.variantId,
            replacementProductId: s.replacement.productId,
            replacementTitle: s.replacement.title,
            replacementImageUrl: s.replacement.imageUrl,
            replacementPrice: s.replacement.price
          }
        : {})
    }));

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: lookup.orderNumber, email, type, items })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Error al procesar');
      const result = data as CreateReturnResponse;

      // Upload photos for defect items
      const photoEntries = selectedEntries.filter(([, s]) => PHOTO_REASONS.includes(s.reason) && s.photo);
      for (const [, s] of photoEntries) {
        try {
          await fetch(`${API_URL}/returns/${result.returnId}/photos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: s.photo })
          });
        } catch { /* non-critical */ }
      }

      localStorage.removeItem('sw_return_session');
      setReturnResult(result);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }

  const selectedCount = Object.values(selections).filter((s) => s.selected).length;

  const summary = (() => {
    if (!lookup) return null;
    const selectedItems = Object.entries(selections).filter(([, s]) => s.selected);
    let refund = 0;
    let charge = 0;
    let exchangeCount = 0;
    for (const [id, s] of selectedItems) {
      const orig = lookup.items.find((i) => i.id === id);
      const origPrice = orig?.unitPrice ?? 0;
      refund += origPrice * s.quantity;
      if (s.action === 'EXCHANGE' && s.replacement) {
        charge += s.replacement.price * s.quantity;
        exchangeCount++;
      }
    }
    const labelFee = lookup.labelFee;
    const netDiff = charge - refund;
    const totalToPay = exchangeCount > 0 ? Math.max(0, netDiff) + labelFee : labelFee;
    return { refund, charge, labelFee, netDiff, totalToPay, exchangeCount, returnCount: selectedItems.length - exchangeCount };
  })();

  const filteredCatalog = catalog.filter((p) =>
    !catalogQuery || p.title.toLowerCase().includes(catalogQuery.toLowerCase())
  );

  const isDark = portalConfig.cardStyle === 'dark';
  const primaryColor = portalConfig.primaryColor || '#007AFF';
  const cardBg = isDark ? '#2C2C2C' : '#FFFFFF';
  const cardText = isDark ? '#FFFFFF' : '#111111';
  const cardSecondary = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
  const cardSeparator = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
  const cardFill = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const cardBlueSoft = isDark ? 'rgba(0,122,255,0.18)' : 'rgba(0,122,255,0.10)';
  const cardGreenSoft = isDark ? 'rgba(52,199,89,0.15)' : 'rgba(52,199,89,0.10)';

  return (
    <>
      <style>{`
        :root {
          --ios-blue: ${primaryColor};
          --ios-green: #34C759;
          --ios-orange: #FF9500;
          --ios-red: #FF3B30;
          --ios-bg: transparent;
          --ios-white: ${cardBg};
          --ios-text: ${cardText};
          --ios-secondary: ${cardSecondary};
          --ios-separator: ${cardSeparator};
          --ios-label2: ${isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)'};
          --ios-fill: ${cardFill};
          --ios-blue-soft: ${cardBlueSoft};
          --ios-green-soft: ${cardGreenSoft};
          --ios-red-soft: ${isDark ? 'rgba(255,59,48,0.15)' : 'rgba(255,59,48,0.08)'};
          --ios-orange-soft: rgba(255,149,0,0.15);
        }
        * { box-sizing: border-box; }
        body { background: transparent; margin: 0; }
        .ios-page {
          min-height: 100vh;
          position: relative !important;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 48px 16px 40px;
          font-family: -apple-system, 'SF Pro Display', 'SF Pro Text', BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
        }
        .ios-input {
          width: 100%;
          padding: 14px 16px;
          border-radius: 12px;
          border: 1.5px solid var(--ios-separator);
          background: var(--ios-white);
          font-size: 16px;
          color: var(--ios-text);
          outline: none;
          transition: border-color 0.15s;
          font-family: inherit;
          appearance: none;
          -webkit-appearance: none;
        }
        .ios-input:focus { border-color: var(--ios-blue); }
        .ios-input::placeholder { color: var(--ios-secondary); }
        .ios-btn-primary {
          width: 100%;
          padding: 16px 20px;
          background: var(--ios-blue);
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 17px;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: -0.2px;
          font-family: inherit;
          transition: opacity 0.15s, transform 0.1s;
        }
        .ios-btn-primary:active { opacity: 0.85; transform: scale(0.99); }
        .ios-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
        .ios-btn-secondary {
          padding: 12px 18px;
          background: var(--ios-white);
          color: var(--ios-blue);
          border: 1.5px solid var(--ios-blue);
          border-radius: 10px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: opacity 0.15s;
          text-align: center;
        }
        .ios-btn-secondary:active { opacity: 0.7; }
        .ios-card {
          background: var(--ios-white);
          border-radius: 16px;
          box-shadow: 0 2px 16px rgba(0,0,0,0.35);
          width: 100%;
          max-width: 480px;
          overflow: hidden;
        }
        .ios-card-wide { max-width: 720px; }
        .ios-error-banner {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          background: var(--ios-red-soft);
          border: 1px solid rgba(255,59,48,0.25);
          border-radius: 12px;
          padding: 12px 14px;
          color: var(--ios-red);
          font-size: 14px;
          font-weight: 500;
          margin-top: 12px;
        }
        .ios-error-dismiss {
          background: none;
          border: none;
          color: var(--ios-red);
          cursor: pointer;
          font-size: 16px;
          padding: 0;
          line-height: 1;
          margin-left: auto;
          flex-shrink: 0;
        }
        .ios-step-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255,255,255,0.35);
          transition: all 0.2s;
        }
        .ios-step-dot.active {
          width: 24px;
          border-radius: 4px;
          background: #fff;
        }
        .ios-step-dot.done { background: var(--ios-green); }
        .ios-item-card {
          background: var(--ios-white);
          border-radius: 16px;
          box-shadow: 0 2px 16px rgba(0,0,0,0.35);
          overflow: hidden;
          transition: box-shadow 0.2s;
        }
        .ios-item-card.selected { box-shadow: 0 2px 16px rgba(0,122,255,0.18); }
        .ios-segment {
          display: flex;
          background: var(--ios-fill);
          border-radius: 9px;
          padding: 2px;
          gap: 2px;
        }
        .ios-segment-btn {
          flex: 1;
          padding: 8px 12px;
          border-radius: 7px;
          border: none;
          background: transparent;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          color: var(--ios-secondary);
          font-family: inherit;
          transition: all 0.15s;
        }
        .ios-segment-btn.active {
          background: var(--ios-white);
          color: var(--ios-blue);
          box-shadow: 0 1px 4px rgba(0,0,0,0.12);
        }
        .ios-checkbox {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 2px solid var(--ios-separator);
          background: var(--ios-white);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: all 0.15s;
        }
        .ios-checkbox.checked {
          background: var(--ios-blue);
          border-color: var(--ios-blue);
        }
        .ios-checkbox-check {
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          line-height: 1;
        }
        .ios-image-placeholder {
          width: 56px;
          height: 56px;
          border-radius: 10px;
          background: var(--ios-fill);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 22px;
        }
        .ios-summary-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 0;
          font-size: 15px;
          color: var(--ios-text);
        }
        .ios-summary-row.total {
          font-weight: 700;
          font-size: 17px;
          border-top: 1px solid var(--ios-separator);
          margin-top: 6px;
          padding-top: 12px;
        }
        .ios-select {
          width: 100%;
          padding: 14px 40px 14px 16px;
          border-radius: 12px;
          border: 1.5px solid var(--ios-separator);
          background: var(--ios-white);
          font-size: 15px;
          color: var(--ios-text);
          outline: none;
          font-family: inherit;
          appearance: none;
          -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23FFFFFF' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 14px center;
          cursor: pointer;
          transition: border-color 0.15s;
        }
        .ios-select:focus { border-color: var(--ios-blue); }
        @keyframes shimmer {
          0% { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        .ios-spinner {
          width: 20px;
          height: 20px;
          border: 2.5px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          display: inline-block;
          animation: spin 0.7s linear infinite;
        }
        .ios-spinner-blue {
          width: 32px;
          height: 32px;
          border: 3px solid var(--ios-fill);
          border-top-color: var(--ios-blue);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          margin: 0 auto;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ios-fade-in { animation: fadeIn 0.35s ease forwards; }
        .ios-splash {
          position: fixed; inset: 0;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          background: #0f0f1a;
          z-index: 200;
          transition: opacity 0.4s ease;
        }
        .ios-splash-spinner {
          width: 36px; height: 36px;
          border: 3px solid rgba(255,255,255,0.15);
          border-top-color: rgba(255,255,255,0.7);
          border-radius: 50%;
          animation: spin 0.75s linear infinite;
        }
        @keyframes success-pop {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        .ios-success-icon {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: var(--ios-green);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          animation: success-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .ios-success-checkmark {
          color: #fff;
          font-size: 36px;
          font-weight: 700;
          line-height: 1;
        }
        .ios-download-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          padding: 16px 20px;
          background: var(--ios-blue);
          color: #fff;
          border-radius: 10px;
          font-size: 17px;
          font-weight: 600;
          text-decoration: none;
          letter-spacing: -0.2px;
          transition: opacity 0.15s;
        }
        .ios-download-btn:active { opacity: 0.85; }
        .ios-tracking-chip {
          background: var(--ios-fill);
          border-radius: 10px;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
        }
        .ios-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding: 0;
          z-index: 100;
        }
        .ios-modal {
          background: var(--ios-white);
          border-radius: 20px 20px 0 0;
          width: 100%;
          max-width: 720px;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .ios-modal-handle {
          width: 36px;
          height: 5px;
          border-radius: 3px;
          background: var(--ios-separator);
          margin: 12px auto 0;
        }
        .ios-product-card {
          background: var(--ios-white);
          border: 1.5px solid var(--ios-separator);
          border-radius: 14px;
          padding: 12px;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
        }
        .ios-product-card.expanded {
          border-color: var(--ios-blue);
          background: var(--ios-blue-soft);
        }
        .ios-variant-btn {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 10px 12px;
          background: var(--ios-fill);
          border: none;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
          color: var(--ios-text);
          transition: background 0.12s;
        }
        .ios-variant-btn:active { background: var(--ios-separator); }
        .ios-replacement-chip {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          background: var(--ios-green-soft);
          border-radius: 12px;
          border: 1px solid rgba(52,199,89,0.2);
        }
        .ios-section-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--ios-secondary);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 8px;
        }
      `}</style>

      {/* Splash screen — hidden once config + bg image ready */}
      {!configLoaded && (
        <div className="ios-splash">
          <div className="ios-splash-spinner" />
        </div>
      )}

      <div className="ios-page" style={{ opacity: configLoaded ? 1 : 0, transition: 'opacity 0.4s ease' }}>

        {/* Background image */}
        <div style={{
          position: 'fixed', inset: 0,
          background: portalConfig.backgroundUrl
            ? `url(${portalConfig.backgroundUrl}) center/cover no-repeat`
            : 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          zIndex: -2
        }} />
        {/* Dark overlay */}
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: -1
        }} />

        {/* Steps indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`ios-step-dot ${step === s ? 'active' : step > s ? 'done' : ''}`}
            />
          ))}
        </div>

        {/* Step labels */}
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: sessionBanner ? 12 : 24, fontWeight: 500 }}>
          {step === 1 && t.step1}
          {step === 2 && t.step2}
          {step === 3 && t.step3}
        </div>

        {/* Session banner */}
        {sessionBanner && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: sessionBanner === 'restored' ? 'rgba(52,199,89,0.18)' : 'rgba(255,149,0,0.18)',
            border: `1px solid ${sessionBanner === 'restored' ? 'rgba(52,199,89,0.4)' : 'rgba(255,149,0,0.4)'}`,
            borderRadius: 12, padding: '10px 14px',
            marginBottom: 16, width: '100%', maxWidth: 480,
            fontSize: 13, fontWeight: 500,
            color: sessionBanner === 'restored' ? '#34C759' : '#FF9500',
          }}>
            <span>{sessionBanner === 'restored' ? '💾' : '⚠️'}</span>
            <span style={{ flex: 1 }}>
              {sessionBanner === 'restored' ? t.sessionRestored : t.sessionExpired}
            </span>
            <button
              type="button"
              onClick={() => setSessionBanner(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'inherit', padding: 0 }}
            >✕</button>
          </div>
        )}

        <div
          className={`ios-card ios-fade-in${step === 2 ? ' ios-card-wide' : ''}`}
          style={{
            padding: '28px 24px',
            background: cardBg,
            boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
            borderRadius: 20
          }}
        >
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            {portalConfig.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={portalConfig.logoUrl}
                alt="Logo"
                style={{
                  maxHeight: 64,
                  maxWidth: 200,
                  objectFit: 'contain',
                  filter: isDark ? 'brightness(0) invert(1)' : 'none'
                }}
              />
            ) : (
              <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: -2, color: cardText }}>SW</div>
            )}
          </div>

          {/* Title + subtitle shown only on step 1 */}
          {step === 1 && (
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: cardText, letterSpacing: -0.5, marginBottom: 6 }}>
                {portalConfig.titleText || 'Cambios & Devoluciones'}
              </div>
              <div style={{ color: cardSecondary, fontSize: 15 }}>
                {portalConfig.subtitleText || 'Gestiona tu devolución de forma rápida'}
              </div>
            </div>
          )}

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <form onSubmit={handleLookup}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div className="ios-section-label">{t.orderNumber}</div>
                  <input
                    className="ios-input"
                    type="text"
                    placeholder="#12345"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <div className="ios-section-label">{t.email}</div>
                  <input
                    className="ios-input"
                    type="email"
                    placeholder={t.emailPlaceholder}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="ios-error-banner">
                  <span>⚠</span>
                  <span style={{ flex: 1 }}>{error}</span>
                  <button type="button" className="ios-error-dismiss" onClick={() => setError(null)}>✕</button>
                </div>
              )}

              <button
                type="submit"
                className="ios-btn-primary"
                style={{ marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                disabled={loading}
              >
                {loading ? <><span className="ios-spinner" />{t.searching}</> : t.searchBtn}
              </button>
            </form>
          )}

          {/* ── STEP 2 ── */}
          {step === 2 && lookup && (
            <form onSubmit={handleSubmitReturn}>
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: 'var(--ios-text)', letterSpacing: -0.3 }}>
                  {t.selectItems}
                </h2>
                <div style={{ color: 'var(--ios-secondary)', fontSize: 14, marginBottom: 14 }}>
                  #{lookup.orderNumber} · {lookup.customerName}
                </div>

                {/* Days remaining bar */}
                {(() => {
                  const daysLeft = Math.max(0, lookup.windowDays - lookup.daysSince);
                  const pct = Math.min(100, Math.round((lookup.daysSince / lookup.windowDays) * 100));
                  const urgent = daysLeft <= 3;
                  const warning = daysLeft <= 7 && !urgent;
                  const barColor = urgent ? 'var(--ios-red)' : warning ? 'var(--ios-orange)' : 'var(--ios-green)';
                  const bgColor = urgent
                    ? 'var(--ios-red-soft)'
                    : warning
                    ? 'var(--ios-orange-soft)'
                    : 'var(--ios-green-soft)';
                  const icon = urgent ? '⚠️' : warning ? '⏳' : '✅';
                  const label = daysLeft === 0 ? t.lastDay : t.daysLeft(daysLeft);
                  return (
                    <div style={{
                      background: bgColor,
                      borderRadius: 12,
                      padding: '10px 14px',
                      border: `1px solid ${barColor}33`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: barColor }}>
                          <span>{icon}</span>
                          <span>{label}</span>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--ios-secondary)', fontWeight: 500 }}>
                          {lookup.daysSince}/{lookup.windowDays}d
                        </span>
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: 'var(--ios-fill)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${pct}%`,
                          borderRadius: 3,
                          background: barColor,
                          transition: 'width 0.6s ease',
                        }} />
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                {lookup.items.map((item) => {
                  const sel = selections[item.id];
                  if (!sel) return null;
                  return (
                    <div key={item.id} className={`ios-item-card${sel.selected ? ' selected' : ''}`}>
                      {/* Item header row */}
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px', cursor: 'pointer' }}
                        onClick={() => updateSelection(item.id, { selected: !sel.selected })}
                      >
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.imageUrl}
                            alt={item.title}
                            style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10, flexShrink: 0 }}
                          />
                        ) : (
                          <div className="ios-image-placeholder">👕</div>
                        )}

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ios-text)', marginBottom: 3, letterSpacing: -0.2 }}>
                            {item.title}
                          </div>
                          {item.variantTitle && (
                            <div style={{ fontSize: 13, color: 'var(--ios-secondary)', marginBottom: 2 }}>
                              {item.variantTitle}
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {item.unitPrice != null && (
                              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ios-blue)' }}>
                                {item.unitPrice.toFixed(2)}€
                              </span>
                            )}
                            <span style={{ fontSize: 12, color: 'var(--ios-secondary)' }}>
                              ×{item.returnableQuantity} {item.returnableQuantity !== 1 ? t.availablePlural : t.available}
                            </span>
                          </div>
                        </div>

                        <div
                          className={`ios-checkbox${sel.selected ? ' checked' : ''}`}
                          style={{ flexShrink: 0 }}
                        >
                          {sel.selected && <span className="ios-checkbox-check">✓</span>}
                        </div>
                      </div>

                      {/* Expanded options */}
                      {sel.selected && (
                        <div style={{ borderTop: '1px solid var(--ios-fill)', padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

                          {/* Action segmented control */}
                          <div>
                            <div className="ios-section-label">{t.managementType}</div>
                            <div className="ios-segment">
                              <button
                                type="button"
                                className={`ios-segment-btn${sel.action === 'RETURN' ? ' active' : ''}`}
                                onClick={() => updateSelection(item.id, { action: 'RETURN', replacement: undefined })}
                              >
                                {t.returnBtn}
                              </button>
                              <button
                                type="button"
                                className={`ios-segment-btn${sel.action === 'EXCHANGE' ? ' active' : ''}`}
                                onClick={() => updateSelection(item.id, { action: 'EXCHANGE' })}
                              >
                                {t.exchangeBtn}
                              </button>
                            </div>
                          </div>

                          {/* Exchange replacement picker */}
                          {sel.action === 'EXCHANGE' && (
                            <div>
                              <div className="ios-section-label">{t.exchangeProduct}</div>
                              {sel.replacement ? (
                                <div className="ios-replacement-chip">
                                  {sel.replacement.imageUrl && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={sel.replacement.imageUrl} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                                  )}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ios-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {sel.replacement.title}
                                    </div>
                                    <div style={{ fontSize: 13, color: 'var(--ios-secondary)' }}>{sel.replacement.price.toFixed(2)}€</div>
                                  </div>
                                  <button
                                    type="button"
                                    className="ios-btn-secondary"
                                    style={{ padding: '8px 12px', fontSize: 13 }}
                                    onClick={() => openPicker(item.id)}
                                  >
                                    {t.changeBtn}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="ios-btn-secondary"
                                  style={{ width: '100%', padding: '13px 16px' }}
                                  onClick={() => openPicker(item.id)}
                                >
                                  {t.chooseProduct}
                                </button>
                              )}
                            </div>
                          )}

                          {/* Reason */}
                          <div>
                            <div className="ios-section-label">{t.reason}</div>
                            <select
                              className="ios-select"
                              value={sel.reason}
                              onChange={(e) => updateSelection(item.id, { reason: e.target.value, photo: undefined })}
                              required={sel.selected}
                            >
                              <option value="">{t.reasonPlaceholder}</option>
                              {Object.entries(lookup.reasons).map(([key, label]) => (
                                <option key={key} value={key}>{label}</option>
                              ))}
                            </select>
                          </div>

                          {/* Photo upload — required for defect reasons */}
                          {PHOTO_REASONS.includes(sel.reason) && (
                            <div>
                              <div className="ios-section-label">{t.photoLabel}</div>
                              <div style={{ fontSize: 12, color: 'var(--ios-secondary)', marginBottom: 8 }}>{t.photoHint}</div>
                              {sel.photo ? (
                                <div style={{ position: 'relative', display: 'inline-block' }}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={sel.photo}
                                    alt="Foto adjunta"
                                    style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 12, border: '2px solid var(--ios-green)', display: 'block' }}
                                  />
                                  <label
                                    htmlFor={`photo-${item.id}`}
                                    style={{
                                      position: 'absolute', bottom: 6, right: 6,
                                      background: 'rgba(0,0,0,0.6)',
                                      color: '#fff', borderRadius: 8,
                                      padding: '3px 8px', fontSize: 11,
                                      cursor: 'pointer', fontWeight: 600
                                    }}
                                  >
                                    {t.photoChangeBtn}
                                  </label>
                                  <input
                                    id={`photo-${item.id}`}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      compressImage(file)
                                        .then((data) => updateSelection(item.id, { photo: data }))
                                        .catch(() => {});
                                    }}
                                  />
                                </div>
                              ) : (
                                <label
                                  htmlFor={`photo-${item.id}`}
                                  style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    gap: 8, width: '100%', padding: '14px 16px',
                                    background: 'var(--ios-fill)',
                                    border: '2px dashed var(--ios-separator)',
                                    borderRadius: 12, cursor: 'pointer',
                                    fontSize: 15, fontWeight: 600,
                                    color: 'var(--ios-blue)', fontFamily: 'inherit'
                                  }}
                                >
                                  {t.photoUploadBtn}
                                  <input
                                    id={`photo-${item.id}`}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      compressImage(file)
                                        .then((data) => updateSelection(item.id, { photo: data }))
                                        .catch(() => {});
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                          )}

                          {/* Notes */}
                          <div>
                            <div className="ios-section-label">{t.notes}</div>
                            <input
                              className="ios-input"
                              type="text"
                              placeholder={t.notesPlaceholder}
                              value={sel.notes}
                              onChange={(e) => updateSelection(item.id, { notes: e.target.value })}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Summary card */}
              {summary && summary.exchangeCount + summary.returnCount > 0 && (
                <div style={{
                  background: 'var(--ios-bg)',
                  borderRadius: 16,
                  padding: '16px 18px',
                  marginBottom: 20
                }}>
                  <div className="ios-section-label">{t.summary}</div>
                  {summary.exchangeCount > 0 && (
                    <>
                      <div className="ios-summary-row">
                        <span style={{ color: 'var(--ios-secondary)' }}>{t.refundLabel}</span>
                        <span>−{summary.refund.toFixed(2)}€</span>
                      </div>
                      <div className="ios-summary-row">
                        <span style={{ color: 'var(--ios-secondary)' }}>{t.chargeLabel}</span>
                        <span>+{summary.charge.toFixed(2)}€</span>
                      </div>
                      {summary.netDiff < 0 && (
                        <div className="ios-summary-row" style={{ color: 'var(--ios-green)', fontSize: 13 }}>
                          <span>{t.favorLabel}</span>
                          <span>{Math.abs(summary.netDiff).toFixed(2)}€</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="ios-summary-row">
                    <span style={{ color: 'var(--ios-secondary)' }}>{t.shippingLabel}</span>
                    <span>+{summary.labelFee.toFixed(2)}€</span>
                  </div>
                  <div className="ios-summary-row total">
                    <span>{t.totalLabel}</span>
                    <span style={{ color: 'var(--ios-blue)' }}>{summary.totalToPay.toFixed(2)}€</span>
                  </div>
                </div>
              )}

              {error && (
                <div className="ios-error-banner" style={{ marginBottom: 16 }}>
                  <span>⚠</span>
                  <span style={{ flex: 1 }}>{error}</span>
                  <button type="button" className="ios-error-dismiss" onClick={() => setError(null)}>✕</button>
                </div>
              )}

              {/* Terms checkbox */}
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                marginBottom: 16, cursor: 'pointer',
                fontSize: 13, color: 'var(--ios-secondary)', lineHeight: 1.5,
              }}>
                <div
                  onClick={() => setTermsAccepted(!termsAccepted)}
                  style={{
                    width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
                    border: `2px solid ${termsAccepted ? 'var(--ios-blue)' : 'var(--ios-separator)'}`,
                    background: termsAccepted ? 'var(--ios-blue)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s', cursor: 'pointer',
                  }}
                >
                  {termsAccepted && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                </div>
                <span onClick={() => setTermsAccepted(!termsAccepted)}>
                  {t.termsText}{' '}
                  {portalConfig.policyUrl ? (
                    <a
                      href={portalConfig.policyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: 'var(--ios-blue)', textDecoration: 'underline' }}
                    >
                      {t.termsLink}
                    </a>
                  ) : (
                    <span style={{ color: 'var(--ios-blue)' }}>{t.termsLink}</span>
                  )}
                </span>
              </label>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="ios-btn-secondary"
                  style={{ flexShrink: 0 }}
                  onClick={() => { setStep(1); setError(null); setTermsAccepted(false); }}
                >
                  {t.back}
                </button>
                <button
                  type="submit"
                  className="ios-btn-primary"
                  style={{ flex: 1, margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                  disabled={loading || selectedCount === 0 || !termsAccepted}
                >
                  {loading
                    ? <><span className="ios-spinner" />{t.processing}</>
                    : t.continueBtn(selectedCount)
                  }
                </button>
              </div>
            </form>
          )}

          {/* ── STEP 3 ── */}
          {step === 3 && (
            <Step3
              result={returnResult}
              pollStatus={pollStatus}
              polling={polling}
              apiUrl={API_URL}
              onReset={() => {
                localStorage.removeItem('sw_return_session');
                setStep(1); setOrderNumber(''); setEmail(''); setLookup(null);
                setSelections({}); setReturnResult(null); setPollStatus(null); setError(null);
                setTermsAccepted(false); setSessionBanner(null);
                window.history.replaceState({}, '', '/devoluciones');
              }}
            />
          )}
        </div>

        {/* Language selector */}
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 20,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              padding: '6px 32px 6px 12px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              outline: 'none',
              backdropFilter: 'blur(8px)',
              appearance: 'none',
              WebkitAppearance: 'none',
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23FFFFFF' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 10px center',
            }}
          >
            {Object.entries(LANG_NAMES).map(([code, name]) => (
              <option key={code} value={code} style={{ background: '#1a1a2e', color: '#fff' }}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {portalConfig.policyUrl && (
          <div style={{ marginTop: 10, textAlign: 'center' }}>
            <a href={portalConfig.policyUrl} target="_blank" rel="noopener noreferrer"
              style={{
                color: 'rgba(255,255,255,0.7)',
                fontSize: 12,
                textDecoration: 'none',
                letterSpacing: '0.04em',
              }}>
              {t.policyLink}
            </a>
          </div>
        )}

        {/* ── Catalog Picker Modal ── */}
        {pickerForItem && (
          <div
            className="ios-modal-overlay"
            onClick={() => { setPickerForItem(null); setExpandedProduct(null); }}
          >
            <div
              className="ios-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="ios-modal-handle" />

              <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ios-text)', flex: 1, letterSpacing: -0.3 }}>
                  {t.chooseExchangeTitle}
                </div>
                <button
                  type="button"
                  onClick={() => { setPickerForItem(null); setExpandedProduct(null); }}
                  style={{
                    width: 30, height: 30, borderRadius: '50%',
                    background: 'var(--ios-fill)', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontSize: 14, color: 'var(--ios-secondary)'
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ padding: '0 16px 12px' }}>
                <input
                  className="ios-input"
                  type="text"
                  placeholder={t.searchProductPlaceholder}
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                />
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px' }}>
                {catalogLoading ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <div className="ios-spinner-blue" style={{ marginBottom: 12 }} />
                    <div style={{ color: 'var(--ios-secondary)', fontSize: 15 }}>{t.loadingProducts}</div>
                  </div>
                ) : filteredCatalog.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--ios-secondary)', padding: 40, fontSize: 15 }}>
                    {t.noResults}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                    {filteredCatalog.slice(0, 100).map((product) => (
                      <div
                        key={product.id}
                        className={`ios-product-card${expandedProduct === product.id ? ' expanded' : ''}`}
                        onClick={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}
                      >
                        {product.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.imageUrl}
                            alt={product.title}
                            style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }}
                          />
                        ) : (
                          <div style={{ width: '100%', height: 110, background: 'var(--ios-fill)', borderRadius: 8, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
                            👕
                          </div>
                        )}
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ios-text)', marginBottom: 3, lineHeight: 1.3 }}>
                          {product.title}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ios-secondary)' }}>
                          {t.from} {product.variants[0]?.price?.toFixed(2)}€
                        </div>
                        {expandedProduct === product.id && (
                          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {product.variants.map((v) => (
                              <button
                                key={v.id}
                                type="button"
                                className="ios-variant-btn"
                                onClick={(e) => { e.stopPropagation(); pickReplacement(v, product); }}
                              >
                                <span style={{ fontWeight: 500 }}>{v.title}</span>
                                <span style={{ color: 'var(--ios-blue)', fontWeight: 600 }}>{v.price.toFixed(2)}€</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Step3({ result, pollStatus, polling, apiUrl, onReset }: {
  result: CreateReturnResponse | null;
  pollStatus: StatusResponse | null;
  polling: boolean;
  apiUrl: string;
  onReset: () => void;
}) {
  const isPaid = pollStatus?.paymentStatus === 'PAID' || result?.paymentStatus === 'PAID';
  const labelUrl = pollStatus?.labelUrl ?? null;
  const trackingNumber = pollStatus?.trackingNumber ?? null;

  if (polling && !isPaid) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ marginBottom: 20 }}>
          <div className="ios-spinner-blue" />
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: 'var(--ios-text)', letterSpacing: -0.3 }}>
          Confirmando pago…
        </h2>
        <p style={{ margin: 0, color: 'var(--ios-secondary)', fontSize: 15, lineHeight: 1.5 }}>
          Esperando confirmación de Shopify. La etiqueta se generará en cuanto recibamos el pago.
        </p>
      </div>
    );
  }

  if (isPaid && labelUrl) {
    return (
      <div>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div className="ios-success-icon">
            <span className="ios-success-checkmark">✓</span>
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: 'var(--ios-text)', letterSpacing: -0.3 }}>
            ¡Etiqueta lista!
          </h2>
          <p style={{ margin: 0, color: 'var(--ios-secondary)', fontSize: 15, lineHeight: 1.5 }}>
            Tu pago se ha confirmado. Descarga, imprime y pega en el paquete.
          </p>
        </div>

        {trackingNumber && (
          <div className="ios-tracking-chip">
            <span style={{ fontSize: 20 }}>📦</span>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ios-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                Número de tracking
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ios-text)' }}>{trackingNumber}</div>
            </div>
          </div>
        )}

        <a
          href={labelUrl.startsWith('http') ? labelUrl : `${apiUrl}${labelUrl}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ios-download-btn"
          style={{ marginBottom: 12 }}
        >
          <span style={{ fontSize: 20 }}>⬇</span>
          Descargar etiqueta PDF
        </a>

        <button type="button" className="ios-btn-secondary" style={{ width: '100%' }} onClick={onReset}>
          Nueva devolución
        </button>
      </div>
    );
  }

  if (result?.checkoutUrl) {
    const returnUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/devoluciones?return_id=${result.returnId}`;
    return (
      <div>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'var(--ios-blue-soft)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: 32
          }}>
            💳
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: 'var(--ios-text)', letterSpacing: -0.3 }}>
            Último paso: pagar
          </h2>
          <p style={{ margin: 0, color: 'var(--ios-secondary)', fontSize: 15, lineHeight: 1.5 }}>
            {result.type === 'EXCHANGE'
              ? 'Para procesar el cambio, paga la diferencia + etiqueta.'
              : 'Para procesar la devolución, paga la etiqueta de Correos.'}
          </p>
        </div>

        <div style={{ background: 'var(--ios-bg)', borderRadius: 16, padding: '16px 18px', marginBottom: 20 }}>
          <div
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--ios-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}
          >
            Desglose
          </div>
          {result.type === 'EXCHANGE' && (
            <>
              <div className="ios-summary-row">
                <span style={{ color: 'var(--ios-secondary)' }}>Reembolso</span>
                <span>−{result.refundAmount?.toFixed(2) ?? '0.00'}€</span>
              </div>
              <div className="ios-summary-row">
                <span style={{ color: 'var(--ios-secondary)' }}>Cargo</span>
                <span>+{result.chargeAmount?.toFixed(2) ?? '0.00'}€</span>
              </div>
            </>
          )}
          <div className="ios-summary-row">
            <span style={{ color: 'var(--ios-secondary)' }}>Etiqueta Correos</span>
            <span>+{result.labelFee?.toFixed(2) ?? '0.00'}€</span>
          </div>
          <div className="ios-summary-row total">
            <span>Total</span>
            <span style={{ color: 'var(--ios-blue)' }}>{result.totalAmount?.toFixed(2) ?? '0.00'}€</span>
          </div>
        </div>

        <a
          href={`${result.checkoutUrl}?return_url=${encodeURIComponent(returnUrl)}`}
          className="ios-download-btn"
          style={{ marginBottom: 12 }}
        >
          Pagar {result.totalAmount?.toFixed(2)}€
        </a>

        <p style={{ fontSize: 13, color: 'var(--ios-secondary)', textAlign: 'center', margin: '0 0 16px' }}>
          Serás redirigido al checkout seguro de Shopify. Al volver, tendrás tu etiqueta lista.
        </p>

        <button type="button" className="ios-btn-secondary" style={{ width: '100%' }} onClick={onReset}>
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <div className="ios-spinner-blue" style={{ marginBottom: 12 }} />
      <p style={{ color: 'var(--ios-secondary)', fontSize: 15 }}>Cargando…</p>
    </div>
  );
}
