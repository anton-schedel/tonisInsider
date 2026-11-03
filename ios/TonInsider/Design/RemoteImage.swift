import SwiftUI

/// A photo from the site: shown at once when it's in memory, else fades in once loaded (placeholder meanwhile).
struct RemoteImage: View {
    let url: URL?
    var contentMode: ContentMode = .fill
    /// The grey placeholder behind (crests sit on the page without one).
    var placeholder = true

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if placeholder { Color.tiSurface }
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            }
        }
        .task(id: url) {
            guard let url else { image = nil; return }
            if let hit = ImageLoader.shared.cached(url) { image = hit; return }
            let loaded = await ImageLoader.shared.image(url)
            withAnimation(.easeOut(duration: 0.2)) { image = loaded }
        }
    }
}
