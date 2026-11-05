import Cocoa
import WebKit

// Standalone comparison tool. It does not change the game or system preferences.
final class ProbeLog {
    let path: String
    private var sequence = 0
    init(path: String) { self.path = path }
    func perform(_ label: String, pattern: NSHapticFeedbackManager.FeedbackPattern,
                 time: NSHapticFeedbackManager.PerformanceTime) {
        sequence += 1
        let performer = NSHapticFeedbackManager.defaultPerformer
        let event = NSApp.currentEvent
        let item: [String: Any] = [
            "sequence": sequence, "time": Date().timeIntervalSince1970, "label": label,
            "pattern": pattern.rawValue, "performanceTime": time.rawValue,
            "active": NSApp.isActive, "performer": String(describing: type(of: performer)),
            "event": event.map { String(describing: $0.type) } ?? "none",
            "sourcePID": event?.cgEvent?.getIntegerValueField(.eventSourceUnixProcessID) ?? -1
        ]
        if let data = try? JSONSerialization.data(withJSONObject: item, options: [.sortedKeys]),
           let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile(); handle.write(data); handle.write(Data("\n".utf8))
            try? handle.close()
        }
        performer.perform(pattern, performanceTime: time)
    }
}

final class NativePad: NSView {
    let titleText: String
    let mode: NSHapticFeedbackManager.PerformanceTime
    let log: ProbeLog
    private var lastBand = -1
    private var count = 0
    init(title: String, mode: NSHapticFeedbackManager.PerformanceTime, log: ProbeLog) {
        self.titleText = title; self.mode = mode; self.log = log
        super.init(frame: .zero)
        wantsLayer = true; layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        layer?.cornerRadius = 12
    }
    required init?(coder: NSCoder) { fatalError("init(coder:)") }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: .zero,
            options: [.activeInKeyWindow, .inVisibleRect, .mouseMoved, .mouseEnteredAndExited],
            owner: self, userInfo: nil))
    }
    override func mouseExited(with event: NSEvent) { lastBand = -1 }
    override func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let band = min(4, max(0, Int((bounds.height - point.y) / max(bounds.height / 5, 1))))
        guard band != lastBand else { return }
        lastBand = band; count += 1
        let patterns: [NSHapticFeedbackManager.FeedbackPattern] =
            [.generic, .alignment, .levelChange, .generic, .levelChange]
        log.perform("\(titleText)-band\(band)", pattern: patterns[band], time: mode)
        needsDisplay = true
    }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor.separatorColor.setStroke()
        for index in 1..<5 {
            let line = NSBezierPath()
            let y = bounds.height * CGFloat(index) / 5
            line.move(to: NSPoint(x: 14, y: y)); line.line(to: NSPoint(x: bounds.width - 14, y: y))
            line.stroke()
        }
        let text = "\(titleText)\n上下划过横线 · 已调用 \(count) 次"
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 17, weight: .semibold),
            .foregroundColor: NSColor.labelColor
        ]
        (text as NSString).draw(in: bounds.insetBy(dx: 20, dy: 24), withAttributes: attrs)
    }
}

final class ProbeDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: WKWebView!
    var log: ProbeLog!
    func applicationDidFinishLaunching(_ notification: Notification) {
        let defaultLog = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/AirHockeyHapticsTest/events.jsonl")
        let logPath = CommandLine.arguments.dropFirst().first ?? defaultLog.path
        try? FileManager.default.createDirectory(
            at: URL(fileURLWithPath: logPath).deletingLastPathComponent(),
            withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }
        log = ProbeLog(path: logPath)
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 880, height: 680))
        let title = NSTextField(wrappingLabelWithString:
            "触控板对照测试\n只用触控板移动光标，依次在 A、B、C、D 区内上下划过横线。无需点按。")
        title.font = .systemFont(ofSize: 18, weight: .medium)
        title.frame = NSRect(x: 24, y: 596, width: 830, height: 64); root.addSubview(title)
        let a = NativePad(title: "A · 原生立即触发", mode: .now, log: log)
        a.frame = NSRect(x: 24, y: 330, width: 408, height: 242); root.addSubview(a)
        let b = NativePad(title: "B · 原生随画面触发", mode: .default, log: log)
        b.frame = NSRect(x: 448, y: 330, width: 408, height: 242); root.addSubview(b)
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "probe")
        web = WKWebView(frame: NSRect(x: 24, y: 44, width: 832, height: 270), configuration: configuration)
        root.addSubview(web)
        web.loadHTMLString("""
        <!doctype html><meta charset="utf-8"><style>
        :root{color-scheme:light dark;font:17px system-ui}body{margin:0;display:flex;gap:16px}
        .pad{position:relative;flex:1;background:light-dark(#f2f2f7,#292a2d);border-radius:12px;overflow:hidden}
        .stripe{height:52px;border-bottom:1px solid #80808055}
        .label{pointer-events:none;position:absolute;left:20px;top:20px;font-weight:600;line-height:1.6}
        </style><div class="pad" data-mode="sync"><div class="label">C · 网页同步触发<br><span>已调用 0 次</span></div></div>
        <div class="pad" data-mode="async"><div class="label">D · 网页延后触发<br><span>已调用 0 次</span></div></div>
        <script>
        for(const pad of document.querySelectorAll('.pad')){
          let count=0;
          for(let i=0;i<5;i++){
            const stripe=document.createElement('div');stripe.className='stripe';
            stripe.addEventListener('pointerenter',()=>{
              pad.querySelector('span').textContent=`已调用 ${++count} 次`;
              window.webkit.messageHandlers.probe.postMessage({mode:pad.dataset.mode,band:i});
            });pad.append(stripe);
          }
        }
        </script>
        """, baseURL: nil)
        let note = NSTextField(labelWithString: "每组包含 generic、alignment、levelChange 三种系统触感；计数只表示调用，不代表实际震动。")
        note.font = .systemFont(ofSize: 12); note.textColor = .secondaryLabelColor
        note.frame = NSRect(x: 24, y: 13, width: 832, height: 20); root.addSubview(note)
        window = NSWindow(contentRect: root.bounds,
            styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "一拍即合 · 触感对照"; window.contentView = root
        window.acceptsMouseMovedEvents = true; window.center()
        let menu = NSMenu(); let item = NSMenuItem(); let appMenu = NSMenu()
        item.submenu = appMenu; menu.addItem(item)
        let showLog = appMenu.addItem(withTitle: "显示调用记录", action: #selector(showLogFolder), keyEquivalent: "l")
        showLog.target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出对照测试", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        NSApp.mainMenu = menu
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    @objc func showLogFolder() {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: log.path)])
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let mode = body["mode"] as? String, let band = body["band"] as? Int else { return }
        let patterns: [NSHapticFeedbackManager.FeedbackPattern] =
            [.generic, .alignment, .levelChange, .generic, .levelChange]
        guard patterns.indices.contains(band) else { return }
        let operation = { [self] in
            log.perform("web-\(mode)-band\(band)", pattern: patterns[band], time: .now)
        }
        if mode == "sync" { operation() }
        else { DispatchQueue.main.asyncAfter(deadline: .now(), execute: operation) }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let probeApp = NSApplication.shared
let probeDelegate = ProbeDelegate()
probeApp.delegate = probeDelegate
probeApp.setActivationPolicy(.regular)
probeApp.run()
