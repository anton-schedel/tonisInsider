import UIKit

/// Photos, crests and banners: decoded images in memory, the downloads in a large URL cache on disk,
/// so a photo seen once shows at once next time (also offline).
final class ImageLoader: Sendable {
    static let shared = ImageLoader()

    /// NSCache is thread-safe.
    nonisolated(unsafe) private let memory = NSCache<NSURL, UIImage>()
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 20 << 20, diskCapacity: 100 << 20)
        config.requestCachePolicy = .returnCacheDataElseLoad
        session = URLSession(configuration: config)
        memory.countLimit = 400
    }

    /// Already decoded: shown without any fade.
    func cached(_ url: URL) -> UIImage? {
        memory.object(forKey: url as NSURL)
    }

    func image(_ url: URL) async -> UIImage? {
        if let hit = cached(url) { return hit }
        guard let (data, _) = try? await session.data(from: url), let image = UIImage(data: data) else { return nil }
        let decoded = await image.byPreparingForDisplay() ?? image
        memory.setObject(decoded, forKey: url as NSURL)
        return decoded
    }
}
