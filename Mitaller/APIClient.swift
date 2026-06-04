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
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 90
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

    func fulfillableOrders() async throws -> FulfillableOrdersResponse {
        try await get("/purchase-needs/fulfillable")
    }

    func supplierPurchaseOrders() async throws -> [SupplierPurchaseOrder] {
        try await get("/supplier/purchase-orders")
    }

    func generateDailySupplierPurchaseOrder(submit: Bool = false) async throws -> SupplierPurchaseOrderActionResponse {
        let request = try jsonRequest(path: "/supplier/purchase-orders/daily", method: "POST", body: SupplierPurchaseOrderGenerateRequest(submit: submit))
        return try await perform(request)
    }

    func submitSupplierPurchaseOrder(id: String) async throws -> SupplierPurchaseOrderActionResponse {
        let request = try jsonRequest(path: "/supplier/purchase-orders/\(Self.pathSegment(id))/submit", method: "POST", body: EmptyBody())
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

    func bankStatus() async throws -> BankStatus {
        try await get("/bank/status")
    }

    func bankInstitutions(country: String = "ES") async throws -> [BankInstitution] {
        try await get("/bank/institutions?country=\(country)")
    }

    func bankConnect(institutionId: String, institutionName: String?) async throws -> BankConnection {
        let request = try jsonRequest(
            path: "/bank/connect",
            method: "POST",
            body: BankConnectRequest(institutionId: institutionId, institutionName: institutionName, redirectUrl: nil)
        )
        return try await perform(request)
    }

    func bankSync(from: Date? = nil, to: Date? = nil) async throws -> BankSyncResponse {
        let formatter = DateFormatter.apiDay
        let request = try jsonRequest(
            path: "/bank/sync",
            method: "POST",
            body: BankSyncRequest(from: from.map { formatter.string(from: $0) }, to: to.map { formatter.string(from: $0) })
        )
        return try await perform(request)
    }

    func bankAllocation() async throws -> AllocationPlan { try await get("/bank/allocation") }
    func cashflow() async throws -> CashflowSummary { try await get("/economics/cashflow") }
    func markPayout(_ id: String) async throws {
        let request = try jsonRequest(path: "/economics/cashflow/\(Self.pathSegment(id))/mark", method: "POST", body: EmptyBody())
        let _: EmptyResponse = try await perform(request)
    }
    func unmarkPayout(_ id: String) async throws {
        var request = try self.request(path: "/economics/cashflow/\(Self.pathSegment(id))/mark", method: "DELETE")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let _: EmptyResponse = try await perform(request)
    }

    func listReturns() async throws -> [ReturnRecord] { try await get("/mobile-returns") }

    func returnByTracking(_ tracking: String) async throws -> ReturnRecord {
        try await get("/mobile-returns/by-tracking/\(Self.pathSegment(tracking))")
    }

    func markReturnReceived(_ id: String) async throws -> ReturnRecord {
        let request = try jsonRequest(path: "/mobile-returns/\(Self.pathSegment(id))/received", method: "POST", body: EmptyBody())
        return try await perform(request)
    }

    func verifyReturn(_ id: String, status: String, notes: String?) async throws -> ReturnRecord {
        let request = try jsonRequest(path: "/mobile-returns/\(Self.pathSegment(id))/verify", method: "POST", body: VerifyReturnRequest(verificationStatus: status, verificationNotes: notes))
        return try await perform(request)
    }

    // MARK: - Meta Ads
    func metaSummary(from: Date, to: Date) async throws -> MetaSummary {
        let f = DateFormatter.apiDay
        return try await get("/meta/summary?from=\(f.string(from: from))&to=\(f.string(from: to))")
    }
    func metaDailySpend(date: Date) async throws -> MetaDailySpend {
        let f = DateFormatter.apiDay
        return try await get("/meta/spend/daily?date=\(f.string(from: date))")
    }
    func metaCampaignDetail(id: String, from: Date, to: Date) async throws -> MetaCampaignDetail {
        let f = DateFormatter.apiDay
        return try await get("/meta/campaigns/\(Self.pathSegment(id))?from=\(f.string(from: from))&to=\(f.string(from: to))")
    }
    func metaTemplates() async throws -> [MetaTemplate] { try await get("/meta/templates") }
    func metaCreateCampaign(_ body: MetaCreateCampaignRequest) async throws -> MetaCreateCampaignResult {
        let request = try jsonRequest(path: "/meta/campaigns", method: "POST", body: body)
        return try await perform(request)
    }
    func metaSetCampaignStatus(_ id: String, status: String) async throws {
        let request = try jsonRequest(path: "/meta/campaigns/\(Self.pathSegment(id))/status", method: "POST", body: MetaStatusRequest(status: status))
        let _: EmptyResponse = try await perform(request)
    }
    func adsHealth(from: Date? = nil, to: Date? = nil) async throws -> AdsHealth {
        let f = DateFormatter.apiDay
        if let from, let to { return try await get("/economics/ads-health?from=\(f.string(from: from))&to=\(f.string(from: to))") }
        return try await get("/economics/ads-health")
    }
    func metaApplyRecommendation(_ body: MetaApplyRecommendationRequest) async throws -> MetaApplyRecommendationResult {
        let request = try jsonRequest(path: "/meta/recommendations/apply", method: "POST", body: body)
        return try await perform(request)
    }

    // MARK: - Influencers
    func influencerSummary() async throws -> InfluencerSummary {
        try await get("/influencers/summary")
    }

    func influencers(stage: String? = nil, query: String? = nil) async throws -> [InfluencerProfile] {
        var params: [String] = []
        if let stage, !stage.isEmpty {
            params.append("stage=\(Self.queryValue(stage))")
        }
        if let query, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            params.append("q=\(Self.queryValue(query))")
        }
        let suffix = params.isEmpty ? "" : "?\(params.joined(separator: "&"))"
        return try await get("/influencers\(suffix)")
    }

    func importInfluencerConversations(limit: Int = 50) async throws -> InfluencerImportResult {
        let request = try jsonRequest(path: "/meta/influencers/import-conversations", method: "POST", body: InfluencerImportRequest(limit: limit))
        return try await perform(request)
    }

    func createInfluencer(_ body: InfluencerSaveRequest) async throws -> InfluencerProfile {
        let request = try jsonRequest(path: "/influencers", method: "POST", body: body)
        return try await perform(request)
    }

    func updateInfluencer(id: String, body: InfluencerUpdateRequest) async throws -> InfluencerProfile {
        let request = try jsonRequest(path: "/influencers/\(Self.pathSegment(id))", method: "PATCH", body: body)
        return try await perform(request)
    }

    func bankDaily(from: Date, to: Date) async throws -> BankDailySummary {
        let formatter = DateFormatter.apiDay
        return try await get("/bank/daily?from=\(formatter.string(from: from))&to=\(formatter.string(from: to))")
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

    private func jsonRequest<T: Encodable>(path: String, method: String, body: T, timeout: TimeInterval = 60) throws -> URLRequest {
        var request = try request(path: path, method: method, timeout: timeout)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return request
    }

    private func request(path: String, method: String, timeout: TimeInterval = 12) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIClientError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeout
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

    private static func queryValue(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
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

// MARK: - Meta Ads models
struct MetaDailySpend: Decodable {
    let date: String
    let spend: Double
    let currency: String
}

struct MetaCampaign: Decodable, Identifiable {
    let id: String
    let name: String
    let status: String
    let objective: String?
    let spend: Double
    let impressions: Int
    let clicks: Int
    let ctr: Double?
    let cpc: Double?
    let reach: Int
    let purchases: Int
    let purchaseValue: Double
    let roas: Double?
}

struct MetaAdSet: Decodable, Identifiable {
    let id: String
    let name: String
    let status: String
    let effectiveStatus: String?
    let dailyBudget: Double?
    let lifetimeBudget: Double?
    let optimizationGoal: String?
    let billingEvent: String?
    let spend: Double
    let impressions: Int
    let clicks: Int
    let ctr: Double?
    let cpc: Double?
    let reach: Int
    let purchases: Int
    let purchaseValue: Double
    let roas: Double?
}

struct MetaAd: Decodable, Identifiable {
    let id: String
    let name: String
    let status: String
    let effectiveStatus: String?
    let adsetId: String?
    let creativeId: String?
    let creativeName: String?
    let thumbnailUrl: String?
    let spend: Double
    let impressions: Int
    let clicks: Int
    let ctr: Double?
    let cpc: Double?
    let reach: Int
    let purchases: Int
    let purchaseValue: Double
    let roas: Double?
}

struct AdsHealthCampaign: Decodable, Identifiable {
    let id: String
    let name: String
    let spend: Double
    let purchases: Int
    let roas: Double?
    let cpa: Double?
    let status: String
    let message: String
}

struct AdsHealth: Decodable {
    let from: String
    let to: String
    let currency: String
    let status: String        // GOOD | WATCH | BAD | INFO
    let headline: String
    let spend: Double
    let attributedRevenue: Double
    let roas: Double?
    let orders: Int
    let salesRevenue: Double
    let netMarginAfterAds: Double
    let marginPerOrder: Double?
    let breakEvenCpa: Double?
    let campaigns: [AdsHealthCampaign]
}

struct MetaRecommendation: Decodable, Identifiable {
    let id: String
    let targetType: String
    let targetId: String?
    let targetName: String
    let severity: String
    let title: String
    let reason: String
    let action: String
    let metricLabel: String
    let priority: Int
    let currentDailyBudget: Double?
    let suggestedDailyBudget: Double?

    var isAutomaticallyApplicable: Bool {
        guard targetId != nil else { return false }
        if severity == "PAUSE" { return targetType == "CAMPAIGN" || targetType == "ADSET" || targetType == "AD" }
        if severity == "SCALE" {
            // ADSET needs a suggested budget; CAMPAIGN is resolved server-side.
            if targetType == "ADSET" { return suggestedDailyBudget != nil }
            return targetType == "CAMPAIGN"
        }
        return false
    }
}

struct MetaApplyRecommendationRequest: Encodable {
    let targetType: String
    let targetId: String
    let severity: String
    let suggestedDailyBudget: Double?
}

struct MetaApplyRecommendationResult: Decodable {
    let ok: Bool
    let applied: Bool
    let targetType: String?
    let targetId: String?
    let action: String?
    let suggestedDailyBudget: Double?
    let message: String
}

struct MetaCampaignDetail: Decodable {
    let from: String
    let to: String
    let campaign: MetaCampaign
    let createdTime: String?
    let updatedTime: String?
    let effectiveStatus: String?
    let adsets: [MetaAdSet]
    let ads: [MetaAd]
    let recommendations: [MetaRecommendation]?
}

struct MetaBestSeller: Decodable, Identifiable {
    let sku: String?
    let title: String
    let quantity: Int
    let revenue: Double
    var id: String { sku ?? title }
}

struct MetaSummary: Decodable {
    let from: String
    let to: String
    let configured: Bool
    let currency: String
    let spend: Double
    let attributedRevenue: Double
    let purchases: Int
    let roas: Double?
    let activeCampaigns: Int
    let campaigns: [MetaCampaign]
    let recommendations: [MetaRecommendation]?
    let bestSellers: [MetaBestSeller]
}

struct MetaTemplate: Decodable, Identifiable {
    let id: String
    let name: String
    let status: String
    let objective: String?
}

struct MetaCreateCampaignRequest: Encodable {
    let name: String
    let templateCampaignId: String?
    let objective: String?
    let dailyBudget: Double
    let message: String
    let headline: String?
    let description: String?
    let link: String
    let imageUrl: String
    let callToAction: String?
    let startTime: String?
}

struct MetaCreateCampaignResult: Decodable {
    let campaignId: String
    let adsetId: String
    let creativeId: String
    let adId: String
    let status: String
    let objective: String
    let note: String
}

private struct MetaStatusRequest: Encodable {
    let status: String
}

// MARK: - Influencers models
struct InfluencerSummary: Decodable {
    let influencers: Int
    let activeCollaborations: Int
    let awaitingContent: Int
    let pendingSubmissions: Int
    let byStage: [String: Int]
    let byCollaborationStatus: [String: Int]
    let bySubmissionStatus: [String: Int]

    enum CodingKeys: String, CodingKey {
        case influencers, activeCollaborations, awaitingContent, pendingSubmissions
        case byStage, byCollaborationStatus, bySubmissionStatus
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        influencers = try container.decodeIfPresent(Int.self, forKey: .influencers) ?? 0
        activeCollaborations = try container.decodeIfPresent(Int.self, forKey: .activeCollaborations) ?? 0
        awaitingContent = try container.decodeIfPresent(Int.self, forKey: .awaitingContent) ?? 0
        pendingSubmissions = try container.decodeIfPresent(Int.self, forKey: .pendingSubmissions) ?? 0
        byStage = try container.decodeIfPresent([String: Int].self, forKey: .byStage) ?? [:]
        byCollaborationStatus = try container.decodeIfPresent([String: Int].self, forKey: .byCollaborationStatus) ?? [:]
        bySubmissionStatus = try container.decodeIfPresent([String: Int].self, forKey: .bySubmissionStatus) ?? [:]
    }
}

struct InfluencerProfile: Decodable, Identifiable, Hashable {
    let id: String
    let igHandle: String
    let fullName: String?
    let manychatId: String?
    let followers: Int?
    let email: String?
    let stage: String
    let tags: [String]
    let notes: String?
    let lastMessage: String?
    let lastMessageAt: Date?
    let source: String?
    let detectionScore: Int
    let detectionReason: String?
    let suggestedAction: String?
    let firstDetectedAt: Date?
    let lastInboundAt: Date?
    let createdAt: Date?
    let updatedAt: Date?
    let collaborations: [InfluencerCollaboration]
    let submissions: [InfluencerSubmission]

    enum CodingKeys: String, CodingKey {
        case id, igHandle, fullName, manychatId, followers, email, stage, tags, notes, lastMessage, lastMessageAt
        case source, detectionScore, detectionReason, suggestedAction, firstDetectedAt, lastInboundAt
        case createdAt, updatedAt, collaborations, submissions
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        igHandle = try container.decodeIfPresent(String.self, forKey: .igHandle) ?? "sin_usuario"
        fullName = try container.decodeIfPresent(String.self, forKey: .fullName)
        manychatId = try container.decodeIfPresent(String.self, forKey: .manychatId)
        followers = try container.decodeIfPresent(Int.self, forKey: .followers)
        email = try container.decodeIfPresent(String.self, forKey: .email)
        stage = try container.decodeIfPresent(String.self, forKey: .stage) ?? "PROSPECT"
        tags = try container.decodeIfPresent([String].self, forKey: .tags) ?? []
        notes = try container.decodeIfPresent(String.self, forKey: .notes)
        lastMessage = try container.decodeIfPresent(String.self, forKey: .lastMessage)
        lastMessageAt = try container.decodeIfPresent(Date.self, forKey: .lastMessageAt)
        source = try container.decodeIfPresent(String.self, forKey: .source)
        detectionScore = try container.decodeIfPresent(Int.self, forKey: .detectionScore) ?? 0
        detectionReason = try container.decodeIfPresent(String.self, forKey: .detectionReason)
        suggestedAction = try container.decodeIfPresent(String.self, forKey: .suggestedAction)
        firstDetectedAt = try container.decodeIfPresent(Date.self, forKey: .firstDetectedAt)
        lastInboundAt = try container.decodeIfPresent(Date.self, forKey: .lastInboundAt)
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
        collaborations = try container.decodeIfPresent([InfluencerCollaboration].self, forKey: .collaborations) ?? []
        submissions = try container.decodeIfPresent([InfluencerSubmission].self, forKey: .submissions) ?? []
    }
}

struct InfluencerCollaboration: Decodable, Identifiable, Hashable {
    let id: String
    let influencerId: String
    let title: String
    let status: String
    let type: String
    let compensation: Double?
    let productSent: String?
    let deliverables: String?
    let discountCode: String?
    let metaCampaignId: String?
    let deadline: Date?
    let openedAt: Date?
    let closedAt: Date?
    let notes: String?
    let createdAt: Date?
    let updatedAt: Date?
}

struct InfluencerSubmission: Decodable, Identifiable, Hashable {
    let id: String
    let influencerId: String
    let collaborationId: String?
    let videoUrl: String?
    let thumbnailUrl: String?
    let caption: String?
    let type: String
    let status: String
    let metaCampaignId: String?
    let createdAt: Date?
    let updatedAt: Date?
}

struct InfluencerImportRequest: Encodable {
    let limit: Int
}

struct InfluencerImportResult: Decodable {
    let ok: Bool
    let checked: Int
    let imported: Int
    let ignored: Int
}

struct InfluencerSaveRequest: Encodable {
    let igHandle: String
    let fullName: String?
    let followers: Int?
    let email: String?
    let stage: String?
    let tags: [String]?
    let notes: String?
}

struct InfluencerUpdateRequest: Encodable {
    let stage: String?
    let notes: String?
    let lastMessage: String?
    let lastMessageAt: String?

    init(stage: String? = nil, notes: String? = nil, lastMessage: String? = nil, lastMessageAt: String? = nil) {
        self.stage = stage
        self.notes = notes
        self.lastMessage = lastMessage
        self.lastMessageAt = lastMessageAt
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
private struct BankConnectRequest: Encodable {
    let institutionId: String
    let institutionName: String?
    let redirectUrl: String?
}
private struct BankSyncRequest: Encodable {
    let from: String?
    let to: String?
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

private struct ScanStockReceiptRequest: Encodable {
    let rawText: String
    let photoBase64: String?
    let supplier: String?
}

private struct ConfirmStockReceiptRequest: Encodable {
    let lines: [StockReceiptConfirmLine]
}

private struct SupplierPurchaseOrderGenerateRequest: Encodable {
    let submit: Bool
}

struct SupplierPurchaseOrderActionResponse: Decodable {
    let status: String
    let order: SupplierPurchaseOrder?
    let lines: [SupplierPurchaseOrderLine]?
}

struct SupplierPurchaseOrder: Decodable, Identifiable {
    let id: String
    let supplier: String
    let orderNumber: String
    let externalOrderId: String?
    let status: String
    let mode: String
    let orderDate: Date?
    let submittedAt: Date?
    let errorMessage: String?
    let orderNote: String?
    let createdAt: Date?
    let lines: [SupplierPurchaseOrderLine]

    var totalQuantity: Int {
        lines.reduce(0) { $0 + $1.quantity }
    }
}

struct SupplierPurchaseOrderLine: Decodable, Identifiable {
    let id: String
    let supplierSku: String
    let name: String
    let color: String?
    let size: String?
    let quantity: Int
    let supplierAvailableQuantity: Int?
    let supplierStockSpain24h: Int?
    let supplierStockCentral3To5Days: Int?
    let supplierStockSupplier5To20Days: Int?
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
    let taxReserve: Double
    let replacementReserve: Double
    let taxReserveRate: Double
    let cashOut: Double
    let cashFree: Double
    let cashFreePct: Double?
    let cashStatus: String?
    let netMargin: Double
    let netMarginPct: Double?
    let shippingReserve: Double
    let adSpend: Double?
    let adsReserve: Double?
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
    let taxReserve: Double
    let cashFree: Double
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

struct BankStatus: Decodable {
    let provider: String
    let configured: Bool
}

struct BankInstitution: Decodable, Identifiable {
    let id: String
    let name: String
    let bic: String?
    let logo: String?
}

struct BankConnection: Decodable, Identifiable {
    let id: String
    let provider: String
    let institutionId: String
    let institutionName: String?
    let requisitionId: String
    let reference: String
    let link: String?
    let status: String
}

struct BankSyncResponse: Decodable {
    let imported: Int
    let accounts: Int
}

struct BankDailySummary: Decodable {
    let currency: String
    let income: Double
    let expense: Double
    let net: Double
    let count: Int
    let byCategory: [String: Double]
    let transactions: [BankTransaction]
}

struct BankTransaction: Decodable, Identifiable {
    let id: String
    let bookingDate: Date
    let amount: Double
    let currency: String
    let description: String
    let counterpartyName: String?
    let category: String
    let orderNumber: String?
}

struct CashflowSummary: Decodable {
    let today: String
    let currency: String
    let receivedToday: Double
    let payouts: [CashflowPayout]
    let allocation: CashflowAllocation
    let pending: CashflowPending
    let scheduled: CashflowPending
}

struct CashflowPayout: Decodable, Identifiable {
    let id: String
    let date: String
    let amount: Double
    let currency: String
    let marked: Bool
    let shopifyFee: Double
    let refunds: Double
    let orders: [CashflowOrder]
    let salesDays: [CashflowSalesDay]
    let allocation: CashflowAllocation
}

struct CashflowOrder: Decodable {
    let orderNumber: String?
    let saleDate: String?
    let amount: Double
    let fee: Double
    let processedAt: String?
}

struct CashflowSalesDay: Decodable, Identifiable {
    var id: String { date }
    let date: String
    let orders: [CashflowOrder]
    let subtotal: Double
}

struct CashflowAllocation: Decodable {
    let taxReserve: Double
    let production: Double
    let shipping: Double
    let cashFree: Double
}

struct CashflowPending: Decodable {
    let amount: Double
    let payouts: [CashflowPayout]
}

struct FulfillableLine: Decodable {
    let key: String
    let subproductName: String
    let color: String
    let size: String
    let required: Int
    let available: Int
    let canFulfill: Bool
}

enum Fulfillability: String, Decodable {
    case full = "FULL"
    case partial = "PARTIAL"
    case none = "NONE"
}

struct FulfillableOrderItem: Decodable, Identifiable {
    let id: String
    let title: String
    let variantTitle: String?
    let sku: String
    let quantity: Int
    let color: String?
    let size: String?
    let unitPrice: Double?
    let imageUrl: String?
}

struct FulfillableOrder: Decodable, Identifiable {
    let orderId: String
    let orderNumber: String
    let customer: String
    let operationalStatus: String
    let orderedAt: Date
    let fulfillability: Fulfillability
    let fulfillableItems: Int
    let totalItems: Int
    let lines: [FulfillableLine]
    let items: [FulfillableOrderItem]
    var id: String { orderId }
}

struct FulfillableSummary: Decodable {
    let full: Int
    let partial: Int
    let none: Int
}

struct FulfillableOrdersResponse: Decodable {
    let orders: [FulfillableOrder]
    let summary: FulfillableSummary
}

struct AllocationPlan: Decodable {
    let currency: String
    let rates: AllocationRates
    let payouts: [PayoutAllocation]
}

struct AllocationRates: Decodable {
    let taxReserve: Double
    let production: Double
    let shipping: Double
    let cashFree: Double
}

struct PayoutAllocation: Decodable, Identifiable {
    let id: String
    let date: String
    let description: String
    let totalAmount: Double
    let allocation: AllocationBreakdown
}

struct AllocationBreakdown: Decodable {
    let taxReserve: Double
    let production: Double
    let shipping: Double
    let cashFree: Double
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

struct FinalizedShipmentItem: Decodable, Identifiable {
    let id: String
    let sku: String
    let title: String
    let variantTitle: String?
    let quantity: Int
    let color: String?
    let size: String?
    let unitPrice: Double?
    let imageUrl: String?
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
    let preparedAt: Date?
    let cost: Double?
    let createdAt: Date
    let updatedAt: Date
    let items: [FinalizedShipmentItem]
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
// MARK: - Returns

struct ReturnOrderItem: Decodable, Identifiable {
    let id: String
    let quantity: Int
    let reason: String
    let replacementTitle: String?
    let orderItem: ReturnOrderItemDetails?

    struct ReturnOrderItemDetails: Decodable {
        let title: String?
        let variantTitle: String?
        let sku: String?
        let imageUrl: String?
    }

    var title: String { orderItem?.title ?? "Artículo" }
    var variantTitle: String? { orderItem?.variantTitle }
    var sku: String? { orderItem?.sku }
    var imageUrl: String? { orderItem?.imageUrl }
}

struct ReturnRecord: Decodable, Identifiable {
    let id: String
    let shopifyOrderNumber: String
    let customerName: String
    let customerEmail: String
    let type: String
    let status: String
    let paymentStatus: String
    let trackingNumber: String?
    let carrier: String?
    let labelUrl: String?
    let checkoutUrl: String?
    let createdAt: Date
    let receivedAt: Date?
    let verificationStatus: String?
    let verificationNotes: String?
    let totalAmount: Double
    let refundAmount: Double
    let items: [ReturnOrderItem]
}

struct VerifyReturnRequest: Encodable {
    let verificationStatus: String
    let verificationNotes: String?
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
