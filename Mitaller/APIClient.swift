//
//  APIClient.swift
//  Mitaller
//

import Foundation

enum APIClientError: LocalizedError {
    case invalidURL
    case invalidResponse
    case server(Int, String?)

    var errorDescription: String? {
        switch self {
        case .invalidURL: "URL de API no valida"
        case .invalidResponse: "Respuesta de API no valida"
        case .server(let status, let message):
            if let message, !message.isEmpty {
                "Error de servidor \(status): \(message)"
            } else {
                "Error de servidor \(status)"
            }
        }
    }
}

struct APISnapshot {
    let orders: [WorkshopOrder]
    let tasks: [WorkshopTask]
    let stock: [StockRow]
    let purchaseNeeds: [PurchaseNeed]
    let purchaseMatrix: [PurchaseMatrixGroup]
}

struct APIClient {
    var baseURL: URL
    var token: String? = nil

    static let shared: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpMaximumConnectionsPerHost = 8
        config.requestCachePolicy = .useProtocolCachePolicy
        config.urlCache = URLCache(memoryCapacity: 32 * 1024 * 1024, diskCapacity: 256 * 1024 * 1024, diskPath: "mitaller-http")
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 12
        config.timeoutIntervalForResource = 30
        return URLSession(configuration: config)
    }()

    func fetchSnapshot() async throws -> APISnapshot {
        async let orders: [OrderDTO] = get("/orders")
        async let tasks: [TaskDTO] = get("/production/tasks/priority-queue")
        async let stock: [StockDTO] = get("/stock")
        async let purchaseNeeds: [PurchaseNeedDTO] = get("/purchase-needs/today")
        async let purchaseMatrix: PurchaseMatrixDTO = get("/purchase-needs/matrix")

        return try await APISnapshot(
            orders: orders.map(\.workshopOrder),
            tasks: tasks.map(\.workshopTask),
            stock: stock.flatMap(\.stockRows),
            purchaseNeeds: purchaseNeeds.map(\.purchaseNeed),
            purchaseMatrix: purchaseMatrix.groups.map(\.purchaseMatrixGroup)
        )
    }

    func importShopifyOrders() async throws {
        let request = try jsonRequest(path: "/orders/import-shopify", method: "POST", body: EmptyBody())
        let _: EmptyResponse = try await perform(request)
    }

    func startTask(id: String) async throws {
        try await patchTask(path: "/production/tasks/\(id)/start")
    }

    func completeTask(id: String) async throws {
        try await patchTask(path: "/production/tasks/\(id)/complete")
    }

    func blockTask(id: String, reason: String) async throws {
        let request = try jsonRequest(path: "/production/tasks/\(id)/block", method: "PATCH", body: BlockRequest(reason: reason))
        let _: EmptyResponse = try await perform(request)
    }

    func markOrderPrepared(id: String, photo: Data? = nil) async throws -> WorkshopOrder {
        let request = try jsonRequest(
            path: "/orders/\(Self.pathSegment(id))/mark-prepared",
            method: "PATCH",
            body: MarkPreparedRequest(photoBase64: photo?.base64EncodedString())
        )
        let response: OrderDTO = try await perform(request)
        return response.workshopOrder
    }

    func confirmOrderPicking(id: String) async throws -> WorkshopOrder {
        let request = try jsonRequest(path: "/orders/\(Self.pathSegment(id))/confirm-picking", method: "PATCH", body: EmptyBody())
        let response: OrderDTO = try await perform(request)
        return response.workshopOrder
    }

    func orderPackagePhotoURL(orderId: String) -> URL? {
        URL(string: "/orders/\(Self.pathSegment(orderId))/package-photo", relativeTo: baseURL)?.absoluteURL
    }

    func reopenOrderPreparation(id: String) async throws -> WorkshopOrder {
        let request = try jsonRequest(path: "/orders/\(id)/reopen-preparation", method: "PATCH", body: EmptyBody())
        let response: OrderDTO = try await perform(request)
        return response.workshopOrder
    }

    func createLabel(orderId: String) async throws -> ShipmentDTO {
        let request = try jsonRequest(path: "/shipments/\(Self.pathSegment(orderId))/create-label", method: "POST", body: EmptyBody())
        return try await perform(request)
    }

    func scanLabel(orderId: String, barcode: String, photo: Data? = nil) async throws -> ShipmentDTO {
        let request = try jsonRequest(
            path: "/shipments/\(Self.pathSegment(orderId))/scan-label",
            method: "POST",
            body: ScanLabelRequest(barcode: barcode, photoBase64: photo?.base64EncodedString())
        )
        return try await perform(request)
    }

    func finalizeWithoutLabel(orderId: String) async throws -> ShipmentDTO {
        let request = try jsonRequest(path: "/shipments/\(Self.pathSegment(orderId))/finalize-without-label", method: "POST", body: EmptyBody())
        return try await perform(request)
    }

    func finalizeCreatedLabel(orderId: String) async throws -> ShipmentDTO {
        let request = try jsonRequest(path: "/shipments/\(Self.pathSegment(orderId))/finalize-created-label", method: "POST", body: EmptyBody())
        return try await perform(request)
    }

    func finalizedShipments() async throws -> [FinalizedShipment] {
        try await get("/shipments/finalized")
    }

    func reprintLabel(shipmentId: String) async throws {
        let request = try jsonRequest(path: "/shipments/\(Self.pathSegment(shipmentId))/reprint", method: "POST", body: EmptyBody())
        let _: EmptyResponse = try await perform(request)
    }

    func reprintLabelByOrder(orderId: String) async throws {
        let request = try jsonRequest(path: "/shipments/order/\(Self.pathSegment(orderId))/reprint", method: "POST", body: EmptyBody())
        let _: EmptyResponse = try await perform(request)
    }

    func shipmentTracking(_ id: String) async throws -> ShipmentTrackingResponse {
        try await get("/shipments/\(Self.pathSegment(id))/tracking")
    }

    func packagePhotoURL(shipmentId: String) -> URL? {
        URL(string: "/shipments/\(Self.pathSegment(shipmentId))/package-photo", relativeTo: baseURL)?.absoluteURL
    }

    func setStockQuantity(sku: String, quantity: Int) async throws {
        let request = try jsonRequest(path: "/stock/\(Self.pathSegment(sku))/quantity", method: "PATCH", body: SetStockQuantityRequest(quantity: quantity))
        let _: StockDTO = try await perform(request)
    }

    func mappingWorkbench() async throws -> MappingWorkbench {
        try await get("/purchase-needs/mapping-workbench")
    }

    func saveProductMapping(_ mapping: ProductMappingSaveRequest) async throws -> ProductMapping {
        let request = try jsonRequest(path: "/purchase-needs/product-mappings", method: "POST", body: mapping)
        return try await perform(request)
    }

    func orderPickingList(orderId: String) async throws -> OrderPickingList {
        try await get("/purchase-needs/order/\(Self.pathSegment(orderId))/picking-list")
    }

    func markRecommendedPurchasesOrdered() async throws -> PurchaseOrderResponse {
        let request = try jsonRequest(path: "/purchase-needs/mark-ordered", method: "POST", body: EmptyBody())
        return try await perform(request)
    }

    func receivePurchase(lines: [ReceivePurchaseLineRequest]) async throws -> ReceivePurchaseResponse {
        let request = try jsonRequest(path: "/purchase-needs/receive", method: "POST", body: ReceivePurchaseRequest(lines: lines))
        return try await perform(request)
    }

    func scanStockReceipt(rawText: String, photo: Data? = nil) async throws -> StockReceipt {
        let request = try jsonRequest(
            path: "/stock/receipts/scan",
            method: "POST",
            body: ScanStockReceiptRequest(rawText: rawText, photoBase64: photo?.base64EncodedString(), supplier: nil)
        )
        return try await perform(request)
    }

    func confirmStockReceipt(id: String, lines: [StockReceiptConfirmLine]) async throws -> StockReceipt {
        let request = try jsonRequest(path: "/stock/receipts/\(Self.pathSegment(id))/confirm", method: "POST", body: ConfirmStockReceiptRequest(lines: lines))
        return try await perform(request)
    }

    func uploadManualLabel(filename: String, pdfData: Data) async throws -> ManualPrintResponse {
        let request = try jsonRequest(
            path: "/manual-print",
            method: "POST",
            body: ManualPrintRequest(filename: filename, pdfBase64: pdfData.base64EncodedString())
        )
        return try await perform(request)
    }

    func economicsToday() async throws -> EconomicsSummary { try await get("/economics/today") }
    func economicsMonth() async throws -> EconomicsSummary { try await get("/economics/month") }
    func economicsRange(from: Date, to: Date) async throws -> EconomicsSummary {
        let formatter = DateFormatter.apiDay
        return try await get("/economics/range?from=\(formatter.string(from: from))&to=\(formatter.string(from: to))")
    }
    func economicsProducts() async throws -> [ProductMarginRow] { try await get("/economics/products") }
    func economicsPayouts() async throws -> ShopifyPayoutsSummary { try await get("/economics/payouts") }
    func economicsForOrder(_ id: String) async throws -> OrderBreakdown {
        try await get("/economics/order/\(Self.pathSegment(id))")
    }

    private func patchTask(path: String) async throws {
        let request = try jsonRequest(path: path, method: "PATCH", body: EmptyBody())
        let _: EmptyResponse = try await perform(request)
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        var request = try request(path: path, method: "GET")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await perform(request)
    }

    private func jsonRequest<T: Encodable>(path: String, method: String, body: T) throws -> URLRequest {
        var request = try request(path: path, method: method)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return request
    }

    private func request(path: String, method: String) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIClientError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 12
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await Self.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIClientError.server(http.statusCode, Self.errorMessage(from: data))
        }
        if T.self == EmptyResponse.self, data.isEmpty {
            return EmptyResponse() as! T
        }
        return try JSONDecoder.api.decode(T.self, from: data.isEmpty ? Data("{}".utf8) : data)
    }

    private static func pathSegment(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }

    private static func errorMessage(from data: Data) -> String? {
        guard !data.isEmpty else { return nil }
        if let apiError = try? JSONDecoder().decode(APIErrorResponse.self, from: data) {
            if let messages = apiError.messageArray {
                return messages.joined(separator: ", ")
            }
            return apiError.message
        }
        return String(data: data, encoding: .utf8)
    }
}

private extension JSONDecoder {
    static var api: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private extension DateFormatter {
    static let apiDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

private struct EmptyBody: Encodable {}
private struct EmptyResponse: Decodable {}
private struct BlockRequest: Encodable {
    let reason: String
}
private struct ScanLabelRequest: Encodable {
    let barcode: String
    let photoBase64: String?
}
private struct SetStockQuantityRequest: Encodable {
    let quantity: Int
}
private struct ManualPrintRequest: Encodable {
    let filename: String
    let pdfBase64: String
}
private struct MarkPreparedRequest: Encodable {
    let photoBase64: String?
}

struct ProductMappingSaveRequest: Encodable {
    let productName: String
    let productType: String?
    let color: String?
    let size: String?
    let sku: String?
    let subproductName: String
    let imageRef: String?
}

struct MappingWorkbench: Decodable {
    let mappings: [ProductMapping]
    let stockItems: [BlankSubproductOption]
    let unmapped: [UnmappedProduct]
}

struct ProductMapping: Decodable, Identifiable {
    let id: String
    let productName: String
    let productType: String?
    let color: String?
    let size: String?
    let sku: String
    let subproductName: String
    let imageRef: String?
}

struct BlankSubproductOption: Decodable, Identifiable {
    let id: String
    let sku: String
    let name: String
    let color: String?
    let size: String?
    let supplierSku: String?
}

struct UnmappedProduct: Decodable, Identifiable {
    var id: String { key }
    let key: String
    let productName: String
    let sku: String
    let productType: String?
    let color: String?
    let size: String?
    let variantTitle: String?
    let pendingQuantity: Int
    let orderNumbers: [String]
}

struct OrderPickingList: Decodable {
    let orderId: String
    let orderNumber: String
    let lines: [OrderPickingLine]
    let unmapped: [OrderPickingUnmapped]
}

struct OrderPickingLine: Decodable, Identifiable {
    var id: String { key }
    let key: String
    let kind: String
    let color: String
    let size: String
    let subproductName: String
    let sku: String?
    let stockItemId: String?
    let stockAvailable: Int
    let quantity: Int
    let orderItems: [OrderPickingSourceItem]
}

struct OrderPickingSourceItem: Decodable, Identifiable {
    let id: String
    let title: String
    let sku: String
    let quantity: Int
}

struct OrderPickingUnmapped: Decodable, Identifiable {
    var id: String { orderItemId }
    let orderItemId: String
    let title: String
    let sku: String
    let quantity: Int
}

struct ReceivePurchaseLineRequest: Encodable {
    let stockItemId: String
    let quantity: Int
}

private struct ReceivePurchaseRequest: Encodable {
    let lines: [ReceivePurchaseLineRequest]
}

private struct ScanStockReceiptRequest: Encodable {
    let rawText: String
    let photoBase64: String?
    let supplier: String?
}

private struct ConfirmStockReceiptRequest: Encodable {
    let lines: [StockReceiptConfirmLine]
}

struct PurchaseOrderResponse: Decodable {
    let ordered: Int
}

struct ReceivePurchaseResponse: Decodable {
    let received: Int
}

struct ManualPrintResponse: Decodable {
    let id: String
    let filename: String
}

struct EconomicsSummary: Decodable {
    let from: String
    let to: String
    let currency: String
    let grossRevenue: Double
    let itemsRevenue: Double
    let shippingRevenue: Double
    let totalDiscount: Double
    let shopifyFee: Double
    let productCost: Double
    let wasteCost: Double
    let shippingCost: Double
    let netMargin: Double
    let netMarginPct: Double?
    let shippingReserve: Double
    let orderCount: Int
    let orders: [OrderBreakdown]
}

struct OrderBreakdown: Decodable, Identifiable {
    var id: String { orderId }
    let orderId: String
    let orderNumber: String
    let customer: String
    let orderedAt: Date
    let currency: String
    let itemsRevenue: Double
    let shippingRevenue: Double
    let totalDiscount: Double
    let grossRevenue: Double
    let shopifyFee: Double
    let productCost: Double
    let wasteCost: Double
    let shippingCost: Double
    let netMargin: Double
    let netMarginPct: Double?
    let items: [OrderItemBreakdown]
    let shipmentCostKnown: Bool
    let shippingCostSource: String?
    let hasItemPrices: Bool
}

struct OrderItemBreakdown: Decodable, Identifiable {
    var id: String { itemId }
    let itemId: String
    let sku: String
    let title: String
    let variantTitle: String?
    let color: String?
    let size: String?
    let quantity: Int
    let unitPrice: Double
    let unitCost: Double
    let costDescription: String
    let revenue: Double
    let cost: Double
    let margin: Double
    let marginPct: Double?
}

struct ProductMarginRow: Decodable, Identifiable {
    var id: String { sku }
    let sku: String
    let title: String
    let quantity: Int
    let revenue: Double
    let cost: Double
    let margin: Double
    let marginPct: Double?
}

struct ShopifyPayoutsSummary: Decodable {
    let currency: String
    let payoutCount: Int
    let totalAmount: Double
    let totalCharges: Double
    let totalRefunds: Double
    let totalFees: Double
    let totalEstimatedMargin: Double
    let payouts: [ShopifyPayout]
}

struct ShopifyPayout: Decodable, Identifiable {
    let id: String
    let status: String
    let date: String
    let currency: String
    let amount: Double
    let charges: Double
    let refunds: Double
    let fees: Double
    let net: Double
    let estimatedMargin: Double
    let lines: [ShopifyPayoutLine]
}

struct ShopifyPayoutLine: Decodable, Identifiable {
    let id: String
    let processedAt: Date
    let orderNumber: String?
    let type: String
    let amount: Double
    let fee: Double
    let net: Double
    let currency: String
    let sourceOrderId: String?
    let orderId: String?
    let margin: Double?
    let productCost: Double?
    let shippingCost: Double?
}

struct FinalizedShipment: Decodable, Identifiable {
    let id: String
    let orderId: String
    let orderNumber: String
    let customer: String
    let shippingMethod: String
    let trackingNumber: String?
    let trackingUrl: String?
    let carrier: String?
    let status: String
    let trackingStatus: String?
    let hasPhoto: Bool
    let hasOrderPhoto: Bool?
    let packagePhotoAt: Date?
    let cost: Double?
    let createdAt: Date
    let updatedAt: Date
}

struct ShipmentTrackingResponse: Decodable {
    let shipmentId: String
    let trackingNumber: String?
    let trackingUrl: String?
    let status: String?
    let carrier: String?
    let events: [TrackingEvent]
    let cached: Bool?
    let error: String?
}

struct TrackingEvent: Decodable, Identifiable {
    var id: String { (at ?? "") + "-" + (status ?? message ?? "") }
    let status: String?
    let message: String?
    let at: String?
}
private struct APIErrorResponse: Decodable {
    let message: String?
    let messageArray: [String]?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        message = try? container.decode(String.self, forKey: .message)
        messageArray = try? container.decode([String].self, forKey: .message)
    }

    private enum CodingKeys: String, CodingKey {
        case message
    }
}

struct ShipmentDTO: Decodable {
    let id: String?
    let trackingNumber: String?
    let carrier: String?
    let labelUrl: String?
    let status: String?
}

private struct OrderDTO: Decodable {
    let id: String
    let shopifyOrderId: String?
    let orderNumber: String
    let customerName: String
    let shippingMethod: String
    let operationalStatus: String
    let priorityLevel: String
    let orderedAt: Date?
    let preparedAt: Date?
    let internalDeadlineAt: Date?
    let items: [OrderItemDTO]?
    let shipments: [ShipmentDTO]?

    var workshopOrder: WorkshopOrder {
        WorkshopOrder(
            remoteID: id,
            number: orderNumber,
            customer: customerName,
            shippingMethod: shippingMethod,
            status: OrderStatus(apiValue: operationalStatus),
            priority: PriorityLevel(apiValue: priorityLevel),
            deadline: internalDeadlineAt?.formattedDeadline ?? "Sin deadline",
            items: items?.map(\.workshopItem) ?? [],
            tracking: shipments?.compactMap(\.trackingNumber).first,
            source: (shopifyOrderId ?? "").hasPrefix("sheet:") ? .sheet : .shopify,
            printStatus: WorkshopOrder.PrintStatus(shipments: shipments ?? []),
            createdAt: orderedAt,
            preparedAt: preparedAt
        )
    }
}

private struct OrderItemDTO: Decodable {
    let id: String
    let title: String
    let variantTitle: String?
    let sku: String?
    let quantity: Int
    let imageUrl: String?
    let imageUrlsJson: [String]?

    var workshopItem: WorkshopOrderItem {
        let urls = (imageUrlsJson ?? [imageUrl].compactMap { $0 }).compactMap(URL.init(string:))
        return WorkshopOrderItem(
            id: id,
            title: title,
            variantTitle: variantTitle,
            sku: sku ?? "",
            quantity: quantity,
            imageURL: urls.first,
            imageURLs: urls
        )
    }
}

private struct TaskDTO: Decodable {
    let id: String
    let order: OrderRefDTO?
    let orderId: String?
    let title: String
    let sku: String?
    let productName: String
    let color: String?
    let size: String?
    let quantity: Int
    let status: String
    let priorityLevel: String
    let internalDeadlineAt: Date?
    let blockedReason: String?

    var workshopTask: WorkshopTask {
        WorkshopTask(
            remoteID: id,
            orderRemoteID: orderId ?? order?.id,
            orderNumber: order?.orderNumber ?? "Pedido",
            productName: productName.isEmpty ? title : productName,
            sku: sku ?? "",
            color: color ?? "",
            size: size ?? "",
            quantity: quantity,
            status: TaskStatus(apiValue: status),
            priority: PriorityLevel(apiValue: priorityLevel),
            deadline: internalDeadlineAt?.formattedDeadline ?? "Sin deadline",
            blockedReason: blockedReason
        )
    }
}

private struct OrderRefDTO: Decodable {
    let id: String
    let orderNumber: String
}

private struct StockDTO: Decodable {
    let sku: String
    let name: String
    let minStock: Int
    let levels: [StockLevelDTO]?

    var stockRows: [StockRow] {
        guard let levels, !levels.isEmpty else {
            return [StockRow(sku: sku, name: name, location: "Sin ubicacion", quantity: 0, minStock: minStock)]
        }
        return levels.map {
            StockRow(sku: sku, name: name, location: $0.location?.code ?? $0.location?.name ?? "Sin ubicacion", quantity: $0.quantity, minStock: minStock)
        }
    }
}

private struct StockLevelDTO: Decodable {
    let quantity: Int
    let location: LocationDTO?
}

private struct LocationDTO: Decodable {
    let code: String?
    let name: String?
}

private struct PurchaseNeedDTO: Decodable {
    let supplierSku: String?
    let recommendedPurchaseQuantity: Int
    let supplierAvailableQuantity: Int?
    let stockItem: StockItemRefDTO?

    var purchaseNeed: PurchaseNeed {
        PurchaseNeed(
            supplierSku: supplierSku ?? stockItem?.supplierSku ?? "SIN-SKU",
            name: stockItem?.name ?? "Articulo",
            quantity: recommendedPurchaseQuantity,
            supplierAvailable: supplierAvailableQuantity ?? 0
        )
    }
}

private struct StockItemRefDTO: Decodable {
    let name: String
    let supplierSku: String?
}

private struct PurchaseMatrixDTO: Decodable {
    let groups: [PurchaseMatrixGroupDTO]
}

private struct PurchaseMatrixGroupDTO: Decodable {
    let key: String
    let garmentType: String
    let color: String
    let title: String
    let theme: PurchaseMatrixThemeDTO
    let sizes: [PurchaseMatrixEntryDTO]

    var purchaseMatrixGroup: PurchaseMatrixGroup {
        PurchaseMatrixGroup(
            key: key,
            title: title,
            garmentType: garmentType,
            color: color,
            backgroundHex: theme.background,
            foregroundHex: theme.foreground,
            entries: sizes.map(\.purchaseMatrixEntry)
        )
    }
}

private struct PurchaseMatrixThemeDTO: Decodable {
    let background: String
    let foreground: String
}

private struct PurchaseMatrixEntryDTO: Decodable {
    let size: String
    let subproductName: String?
    let sku: String?
    let supplierSku: String?
    let stockItemId: String?
    let pendingOrderNeed: Int
    let demandOrders: [PurchaseDemandOrderDTO]?
    let currentInternalStock: Int
    let minStockTarget: Int
    let alreadyOrderedQuantity: Int?
    let recommendedPurchaseQuantity: Int
    let supplierAvailableQuantity: Int?
    let imageRef: String?

    var purchaseMatrixEntry: PurchaseMatrixEntry {
        PurchaseMatrixEntry(
            size: size,
            subproductName: subproductName ?? size,
            sku: sku,
            supplierSku: supplierSku,
            stockItemId: stockItemId,
            pendingOrderNeed: pendingOrderNeed,
            demandOrders: demandOrders?.map(\.purchaseDemandOrder) ?? [],
            currentInternalStock: currentInternalStock,
            minStockTarget: minStockTarget,
            alreadyOrderedQuantity: alreadyOrderedQuantity ?? 0,
            recommendedPurchaseQuantity: recommendedPurchaseQuantity,
            supplierAvailableQuantity: supplierAvailableQuantity,
            imageRef: imageRef
        )
    }
}

private struct PurchaseDemandOrderDTO: Decodable {
    let orderId: String
    let orderNumber: String
    let customerName: String
    let orderItemId: String
    let title: String
    let sku: String?
    let quantity: Int

    var purchaseDemandOrder: PurchaseDemandOrder {
        PurchaseDemandOrder(
            orderId: orderId,
            orderNumber: orderNumber,
            customerName: customerName,
            orderItemId: orderItemId,
            title: title,
            sku: sku ?? "",
            quantity: quantity
        )
    }
}

extension PriorityLevel {
    init(apiValue: String) {
        switch apiValue.uppercased() {
        case "CRITICAL": self = .critical
        case "HIGH": self = .high
        case "LOW": self = .low
        case "BLOCKED": self = .blocked
        default: self = .normal
        }
    }
}

extension TaskStatus {
    init(apiValue: String) {
        switch apiValue.uppercased() {
        case "IN_PROGRESS": self = .inProgress
        case "DONE": self = .done
        case "BLOCKED": self = .blocked
        default: self = .pending
        }
    }

    var apiValue: String {
        switch self {
        case .pending: "PENDING"
        case .inProgress: "IN_PROGRESS"
        case .done: "DONE"
        case .blocked: "BLOCKED"
        }
    }
}

extension OrderStatus {
    init(apiValue: String) {
        switch apiValue.uppercased() {
        case "WAITING_STOCK", "BLOCKED": self = .waitingStock
        case "READY_FOR_LABEL": self = .readyForLabel
        case "PICKED": self = .picked
        case "WAITING_PICKING": self = .waitingPicking
        case "IN_PRODUCTION": self = .inProduction
        case "PRODUCED": self = .produced
        case "LABEL_CREATED": self = .labelCreated
        case "SHIPPED": self = .shipped
        case "CANCELLED": self = .cancelled
        default: self = .waitingProduction
        }
    }
}

private extension Date {
    var formattedDeadline: String {
        formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }
}
