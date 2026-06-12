import AppKit
import SwiftUI
import Combine

/// A borderless, always-on-top, draggable floating window that hosts the pet.
/// Visibility is user-toggleable; size follows the pet-size setting.
@MainActor
final class PetWindowController: ObservableObject {
    static let shared = PetWindowController()

    @Published var isVisible: Bool = true {
        didSet { applyVisibility(isVisible) }
    }

    private var panel: NSPanel?
    private var sizeCancellable: AnyCancellable?
    private var chatLineCancellable: AnyCancellable?
    private var rightClickMonitor: Any?
    private var screenObserver: Any?
    private var moveObserver: Any?

    /// Screen position of the pet's bottom-center; kept stable across resizes.
    private var anchorBottomCenter: NSPoint?
    private var lastContentSize: CGSize = .zero
    private var resizeDebounce: DispatchWorkItem?

    func start() {
        let pet = PetController.shared.petPoint
        let size = CGSize(width: pet + 24, height: pet + 24)
        let panel = NSPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isMovableByWindowBackground = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.contentView = ClickThroughHostingView(rootView: FloatingPetView())
        self.panel = panel

        moveObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.didMoveNotification, object: panel, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.syncAnchorFromWindow() }
        }

        placeInitially(size: size)
        syncAnchorFromWindow()
        applyVisibility(isVisible)

        // On pet-size change, re-measure after SwiftUI relayouts.
        sizeCancellable = PetController.shared.$petPoint.sink { [weak self] _ in
            self?.remeasureContent()
        }

        // On agent rows added/removed, re-measure after SwiftUI relayouts.
        chatLineCancellable = PetController.shared.$chatLineCount.sink { [weak self] _ in
            self?.remeasureContent()
        }

        // If displays change (e.g. a monitor is unplugged), keep the pet on screen.
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.ensureOnScreen() }
        }

        // Right-click the pet to show its stats card (info only — controls
        // stay in the menu bar popover and Settings).
        rightClickMonitor = NSEvent.addLocalMonitorForEvents(matching: .rightMouseDown) { [weak self] event in
            let handled = MainActor.assumeIsolated { () -> Bool in
                guard let self, let panel = self.panel, event.window === panel,
                      let content = panel.contentView else { return false }
                // The pet sits at the visual bottom of the window. NSHostingView
                // is flipped (origin top-left), so the pet's rect starts at
                // bounds.height − petPoint there — anchoring at y:0 would point
                // the popover at the bubble high above the pet.
                let petPoint = PetController.shared.petPoint
                let y = content.isFlipped ? content.bounds.height - petPoint : 0
                let rect = NSRect(x: (content.bounds.width - petPoint) / 2, y: y,
                                  width: petPoint, height: petPoint)
                self.showStatsPopover(relativeTo: rect, of: content)
                return true
            }
            return handled ? nil : event
        }
    }

    /// Transient stats-only popover anchored at the pet.
    private var statsPopover: NSPopover?

    private func showStatsPopover(relativeTo rect: NSRect, of view: NSView) {
        if let shown = statsPopover, shown.isShown {
            shown.performClose(nil)
            return
        }
        let popover = NSPopover()
        popover.behavior = .transient
        popover.animates = true
        popover.contentViewController = NSHostingController(rootView: PetStatsView())
        statsPopover = popover
        // In a flipped view "above the pet's head" is the minY edge.
        popover.show(relativeTo: rect, of: view, preferredEdge: view.isFlipped ? .minY : .maxY)
    }

    /// First-time placement: bottom-right of the main screen.
    private func placeInitially(size: CGSize) {
        guard let panel, let visible = NSScreen.main?.visibleFrame else { return }
        let origin = NSPoint(x: visible.maxX - size.width - 16, y: visible.minY + 24)
        panel.setFrame(NSRect(origin: origin, size: size), display: true, animate: false)
    }

    /// Sizes the panel to hug the pet + bubble content.
    func resizeToContent(_ size: CGSize) {
        guard size.width > 0, size.height > 0 else { return }

        resizeDebounce?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.applyContentResize(size)
        }
        resizeDebounce = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: work)
    }

    private func applyContentResize(_ size: CGSize) {
        let padded = CGSize(width: size.width + 4, height: size.height + 4)
        let dw = abs(padded.width - lastContentSize.width)
        let dh = abs(padded.height - lastContentSize.height)
        guard dw > 1 || dh > 1 || lastContentSize == .zero else { return }
        lastContentSize = padded
        resizeInPlace(to: padded)
    }

    private func remeasureContent() {
        DispatchQueue.main.async { [weak self] in
            guard let host = self?.panel?.contentView as? NSHostingView<FloatingPetView> else { return }
            host.invalidateIntrinsicContentSize()
            host.layoutSubtreeIfNeeded()
            let size = host.fittingSize
            guard size.width > 0, size.height > 0 else { return }
            self?.resizeToContent(size)
        }
    }

    private func syncAnchorFromWindow() {
        guard let panel else { return }
        let frame = panel.frame
        anchorBottomCenter = NSPoint(x: frame.midX, y: frame.minY)
    }

    /// Resizes around a fixed bottom-center anchor so the pet doesn't drift.
    /// The pet stays pinned to its bottom-center; the bubble (centred above the
    /// pet) is free to grow wider/taller. We deliberately do NOT clamp the X
    /// origin to the screen: clamping a wide bubble back on-screen would shove
    /// the window , and therefore the pet , sideways. Keeping the pet put is
    /// more important than the bubble's far edge staying fully on-screen.
    private func resizeInPlace(to size: CGSize) {
        guard let panel else { return }
        if anchorBottomCenter == nil { syncAnchorFromWindow() }
        guard let anchor = anchorBottomCenter else { return }

        // X: keep the pet's centre fixed (no clamp -> no sideways jump).
        var origin = NSPoint(x: anchor.x - size.width / 2, y: anchor.y)
        // Y: only nudge down if the taller bubble would run off the top.
        let probe = NSRect(origin: origin, size: size)
        if let visible = currentScreen(for: probe)?.visibleFrame, origin.y + size.height > visible.maxY {
            origin.y = visible.maxY - size.height
        }
        panel.setFrame(NSRect(origin: origin, size: size), display: true, animate: false)
    }

    /// Keeps the pet visible after a display configuration change: if its
    /// screen vanished (unplugged), move it onto the main screen.
    private func ensureOnScreen() {
        guard let panel else { return }
        let frame = panel.frame
        if currentScreen(for: frame) != nil { return }   // still on a live screen
        guard let visible = NSScreen.main?.visibleFrame else { return }
        let origin = NSPoint(x: visible.maxX - frame.width - 16, y: visible.minY + 24)
        panel.setFrameOrigin(origin)
        syncAnchorFromWindow()
    }

    /// The screen whose frame contains the window's center, if any.
    private func currentScreen(for frame: NSRect) -> NSScreen? {
        let center = NSPoint(x: frame.midX, y: frame.midY)
        return NSScreen.screens.first { NSPointInRect(center, $0.frame) }
    }

    private func applyVisibility(_ visible: Bool) {
        if visible {
            panel?.orderFrontRegardless()
        } else {
            panel?.orderOut(nil)
        }
    }
}
