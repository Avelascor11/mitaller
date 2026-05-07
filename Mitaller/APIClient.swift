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

    func markOrderPrepared(id: String) async throws -> WorkshopOrder {
        let request = try jsonRequest(path: "/orders/\(id)/mark-prepared", method: "PATCH", body: EmptyBody())
        let response: OrderDTO = try await perform(request)
        return response.workshopOrder
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

    func scanLabel(orderId: String, barcode: String) async throws -> ShipmentDTO {
        let request = try jsonRequest(path: "/shipments/\(Self.pathSegment(orderId))/scan-label", method: "POST", body: ScanLabelRequest(barcode: barcode))
        return try await perform(request)
    }

    func setStockQuantity(sku: String, quantity: Int) async throws {
        let request = try jsonRequest(path: "/stock/\(Self.pathSegment(sku))/quantity", method: "PATCH", body: SetStockQuantityRequest(quantity: quantity))
        let _: StockDTO = try await perform(request)
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
        let (data, response) = try await URLSession.shared.data(for: request)
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

private struct EmptyBody: Encodable {}
private struct EmptyResponse: Decodable {}
private struct BlockRequest: Encodable {
    let reason: String
}
private struct ScanLabelRequest: Encodable {
    let barcode: String
}
private struct SetStockQuantityRequest: Encodable {
    let quantity: Int
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
}

private struct OrderDTO: Decodable {
    let id: String
    let orderNumber: String
    let customerName: String
    let shippingMethod: String
    let operationalStatus: String
    let priorityLevel: String
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
            tracking: shipments?.compactMap(\.trackingNumber).first
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
    let pendingOrderNeed: Int
    let currentInternalStock: Int
    let minStockTarget: Int
    let recommendedPurchaseQuantity: Int
    let supplierAvailableQuantity: Int?

    var purchaseMatrixEntry: PurchaseMatrixEntry {
        PurchaseMatrixEntry(
            size: size,
            subproductName: subproductName ?? size,
            sku: sku,
            supplierSku: supplierSku,
            pendingOrderNeed: pendingOrderNeed,
            currentInternalStock: currentInternalStock,
            minStockTarget: minStockTarget,
            recommendedPurchaseQuantity: recommendedPurchaseQuantity,
            supplierAvailableQuantity: supplierAvailableQuantity
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
