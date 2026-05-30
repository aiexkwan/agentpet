import SwiftUI

/// A searchable gallery to download new pets into the app.
struct BrowsePetsView: View {
    @StateObject private var browser = PetBrowser()
    var onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Browse pets").font(.headline)
                Spacer()
                Button("Done") { onClose() }
            }
            .padding(12)
            Divider()

            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search pets", text: $browser.query)
                    .textFieldStyle(.plain)
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 8).fill(.quaternary))
            .padding(12)

            content
        }
        .frame(width: 460, height: 580)
        .preferredColorScheme(.dark)
        .noFocusRing()
        .onAppear { browser.loadIfNeeded() }
    }

    @ViewBuilder private var content: some View {
        if browser.isLoading {
            VStack(spacing: 10) {
                ProgressView()
                Text("Loading pets…").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = browser.errorText {
            VStack(spacing: 10) {
                Image(systemName: "wifi.exclamationmark").font(.largeTitle).foregroundStyle(.secondary)
                Text(error).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button("Retry") { browser.loadIfNeeded() }
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(browser.results) { pet in
                        RemotePetRow(pet: pet, browser: browser)
                        Divider()
                    }
                }
            }
        }
    }
}

private struct RemotePetRow: View {
    let pet: RemotePet
    @ObservedObject var browser: PetBrowser

    var body: some View {
        HStack(spacing: 12) {
            FirstFrameThumb(urlString: pet.spritesheetUrl)
                .frame(width: 44, height: 48)
                .background(RoundedRectangle(cornerRadius: 8).fill(.quaternary))

            VStack(alignment: .leading, spacing: 2) {
                Text(pet.name).font(.system(size: 13, weight: .medium))
                Text("by \(pet.author)").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()

            if browser.downloading.contains(pet.slug) {
                ProgressView().controlSize(.small)
            } else if browser.installed.contains(pet.slug) {
                Label("Added", systemImage: "checkmark.circle.fill").foregroundStyle(.green).font(.caption)
            } else {
                Button("Get") { browser.download(pet) }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
    }
}

/// Shows just the top-left frame of an 8×9 spritesheet, loaded on demand.
private struct FirstFrameThumb: View {
    let urlString: String

    var body: some View {
        AsyncImage(url: URL(string: urlString)) { phase in
            if let image = phase.image {
                image
                    .resizable()
                    .frame(width: 44 * 8, height: 48 * 9)
                    .frame(width: 44, height: 48, alignment: .topLeading)
                    .clipped()
            } else if phase.error != nil {
                Image(systemName: "pawprint").foregroundStyle(.secondary)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
