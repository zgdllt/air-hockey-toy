import Cocoa
import WebKit

// Serves only this app's bundled assets. No TCP listener or external runtime.
final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root.standardizedFileURL; super.init() }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "bundle" else { return }
        let relative = url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(relative).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist)); return
        }
        let mime = ["html": "text/html", "mjs": "text/javascript", "css": "text/css", "svg": "image/svg+xml", "mp4": "video/mp4"][file.pathExtension] ?? "application/octet-stream"
        var headers = [
            "Content-Type": mime, "Content-Length": String(data.count), "Access-Control-Allow-Origin": "*"
        ]
        var status = 200
        var body = data
        if file.pathExtension == "mp4" {
            headers["Accept-Ranges"] = "bytes"
            if let range = task.request.value(forHTTPHeaderField: "Range"), range.hasPrefix("bytes=") {
                let limits = range.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
                if limits.count == 2, let start = Int(limits[0]), start >= 0, start < data.count {
                    let end = min(Int(limits[1]) ?? data.count - 1, data.count - 1)
                    if end >= start {
                        status = 206; body = data.subdata(in: start..<(end + 1))
                        headers["Content-Range"] = "bytes \(start)-\(end)/\(data.count)"
                        headers["Content-Length"] = String(body.count)
                    }
                }
            }
        }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response); task.didReceive(body); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) { }
}

final class HapticMessageHandler: NSObject, WKScriptMessageHandler {
    private var pending: [DispatchWorkItem] = []
    private(set) var diagnosticCounts: [String: Int] = [:]
    private let diagnosing = CommandLine.arguments.contains("--smoke-test")
    func cancel() { pending.forEach { $0.cancel() }; pending.removeAll() }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.host == "bundle",
              let profile = message.body as? [String: Any] else { return }
        cancel()
        guard profile["action"] as? String != "cancel", NSApp.isActive,
              let kind = profile["kind"] as? String, let pulses = profile["pulses"] as? [[String: Any]] else { return }
        for pulse in pulses {
            guard let at = pulse["at"] as? Double, let intensity = pulse["intensity"] as? Double,
                  let sharpness = pulse["sharpness"] as? Double else { continue }
            let pattern: NSHapticFeedbackManager.FeedbackPattern = intensity >= 0.8 ? .levelChange : (intensity <= 0.42 || sharpness >= 0.95 ? .alignment : .generic)
            let work = DispatchWorkItem { [weak self] in
                if NSApp.isActive {
                    NSHapticFeedbackManager.defaultPerformer.perform(pattern, performanceTime: .now)
                    if let self, self.diagnosing { self.diagnosticCounts[kind, default: 0] += 1 }
                }
            }
            pending.append(work)
            DispatchQueue.main.asyncAfter(deadline: .now() + at / 1000, execute: work)
        }
        print("haptic kind=\(kind) pulses=\(pulses.count) engine=NSHapticFeedbackManager")
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    private(set) var lastSavedImage: URL?
    private let haptics = HapticMessageHandler()
    var hapticCounts: [String: Int] { haptics.diagnosticCounts }
    private var smoke: SmokeTest?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let controller = WKUserContentController()
        controller.add(haptics, name: "macHaptics")
        controller.add(self, name: "macWindow")
        let bootstrap = """
        window.AirHockeyNative = {
          fullscreen: false,
          getFullscreen() { return this.fullscreen; },
          setFullscreen(value) { window.webkit.messageHandlers.macWindow.postMessage({action:'fullscreen', value:!!value}); },
          openToyAuthorization(code) { window.webkit.messageHandlers.macWindow.postMessage({action:'toyAuth', code}); },
          saveImage(data) { window.webkit.messageHandlers.macWindow.postMessage({action:'saveImage', data}); }
        };
        window.__airHockeyErrors = [];
        window.addEventListener('error', e => window.__airHockeyErrors.push(e.message || e.target?.src || 'Resource error'), true);
        window.addEventListener('unhandledrejection', e => window.__airHockeyErrors.push(String(e.reason)));
        """
        controller.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let configuration = WKWebViewConfiguration()
        if CommandLine.arguments.contains("--smoke-test") { configuration.websiteDataStore = .nonPersistent() }
        configuration.userContentController = controller
        configuration.setURLSchemeHandler(AssetSchemeHandler(root: Bundle.main.resourceURL!.appendingPathComponent("web")), forURLScheme: "toyasset")
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "一拍即合 · Air Hockey"
        window.minSize = NSSize(width: 390, height: 620)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.center(); window.delegate = self; window.contentView = webView
        let menu = NSMenu()
        let appMenu = NSMenu(); let appItem = NSMenuItem(); appItem.submenu = appMenu; menu.addItem(appItem)
        appMenu.addItem(withTitle: "退出一拍即合", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let viewMenu = NSMenu(title: "显示"); let viewItem = NSMenuItem(title: "显示", action: nil, keyEquivalent: "")
        viewItem.submenu = viewMenu; menu.addItem(viewItem)
        let full = viewMenu.addItem(withTitle: "进入 / 退出全屏", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.control, .command]
        NSApp.mainMenu = menu
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        if let index = CommandLine.arguments.firstIndex(of: "--smoke-test"), CommandLine.arguments.count > index + 1 {
            smoke = SmokeTest(app: self, directory: CommandLine.arguments[index + 1])
        }
        webView.load(URLRequest(url: URL(string: "toyasset://bundle/index.html")!))
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.host == "bundle",
              let body = message.body as? [String: Any] else { return }
        if body["action"] as? String == "saveImage" {
            guard let text = body["data"] as? String, text.hasPrefix("data:image/png;base64,"),
                  let image = Data(base64Encoded: String(text.dropFirst(22))) else { return }
            do {
                let downloads = try FileManager.default.url(for: .downloadsDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let url = downloads.appendingPathComponent("一拍即合-战绩-\(UUID().uuidString.prefix(8)).png")
                try image.write(to: url, options: .withoutOverwriting)
                lastSavedImage = url
                webView.evaluateJavaScript("window.airHockeyNativeSaved?.(true, '已保存到下载文件夹。')")
            } catch {
                lastSavedImage = nil
                webView.evaluateJavaScript("window.airHockeyNativeSaved?.(false, '保存失败，请检查下载文件夹的访问权限。')")
            }
            return
        }
        if body["action"] as? String == "toyAuth" {
            guard NSApp.isActive, let code = body["code"] as? String, code.count == 6,
                  code.range(of: "^[A-Fa-f0-9]{6}$", options: .regularExpression) != nil else { return }
            var target = URLComponents(string: "https://www.bilibili.com/toy/yi-pai-ji-he-air-hockey/index.html")!
            target.queryItems = [URLQueryItem(name: "link", value: code.uppercased())]
            if let url = target.url, !NSWorkspace.shared.open(url) {
                webView.evaluateJavaScript("window.airHockeyNativeAuthFailed?.()")
            }
            return
        }
        guard body["action"] as? String == "fullscreen", let desired = body["value"] as? Bool else { return }
        if desired != window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
        else { syncFullscreen() }
    }
    func syncFullscreen() {
        let value = window.styleMask.contains(.fullScreen) ? "true" : "false"
        webView.evaluateJavaScript("window.AirHockeyNative.fullscreen = \(value); window.airHockeyNativeFullscreen?.(\(value))")
    }
    func windowDidEnterFullScreen(_ notification: Notification) { syncFullscreen() }
    func windowDidExitFullScreen(_ notification: Notification) { syncFullscreen() }
    func windowDidFailToEnterFullScreen(_ window: NSWindow) { syncFullscreen() }
    func windowDidFailToExitFullScreen(_ window: NSWindow) { syncFullscreen() }
    func applicationDidResignActive(_ notification: Notification) {
        haptics.cancel(); webView?.evaluateJavaScript("window.airHockeyNativePause?.()")
    }
    func windowDidMiniaturize(_ notification: Notification) { haptics.cancel(); webView.evaluateJavaScript("window.airHockeyNativePause?.()") }
    func applicationWillTerminate(_ notification: Notification) { haptics.cancel() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        syncFullscreen()
        smoke?.pageLoaded()
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "toyasset" && url.host == "bundle" { decisionHandler(.allow) }
        else {
            if url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("Navigation failed: \(error)")
        smoke?.failed(error.localizedDescription)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
