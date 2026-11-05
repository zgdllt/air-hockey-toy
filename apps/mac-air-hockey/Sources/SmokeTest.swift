import Cocoa
import WebKit

// Opt-in native regression: run the packaged executable with --smoke-test <dir>.
final class SmokeTest {
    unowned let app: AppDelegate
    let directory: URL
    var started = false
    var checks: [String: Any] = [:]
    var opponentBaseline = 0
    var wroteDeviceCode = false
    init(app: AppDelegate, directory: String) {
        self.app = app; self.directory = URL(fileURLWithPath: directory)
        try? FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
    }
    func failed(_ message: String) { checks["failure"] = message; finish() }
    func evaluate(_ script: String, then: @escaping (Any?) -> Void) {
        app.webView.evaluateJavaScript(script) { result, error in
            if let error { self.failed(error.localizedDescription) } else { then(result) }
        }
    }
    func later(_ seconds: Double, _ action: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: action) }
    func snapshot(_ name: String, then: @escaping () -> Void) {
        app.webView.takeSnapshot(with: nil) { image, error in
            guard let data = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data),
                  let png = bitmap.representation(using: .png, properties: [:]) else { self.failed(error?.localizedDescription ?? "Snapshot failed"); return }
            try? png.write(to: self.directory.appendingPathComponent(name + ".png")); then()
        }
    }
    func pageLoaded() {
        guard !started else { return }; started = true
        later(1) {
            self.evaluate("JSON.stringify({errors:window.__airHockeyErrors, start:!!document.querySelector('[data-action=start]'), native:!!window.AirHockeyNative, pixels:document.querySelector('#rink').getContext('2d').getImageData(10,10,1,1).data[3]})") { value in
                self.checks["initial"] = value
                self.evaluate("document.querySelector('[data-action=start]').click(); document.querySelector('#fullscreen').click(); true") { _ in
                    self.later(4) {
                        self.evaluate("JSON.stringify({immersive:document.documentElement.classList.contains('immersive'), button:document.querySelector('#fullscreen').getAttribute('aria-pressed'), playing:document.querySelector('#status-text').textContent, errors:window.__airHockeyErrors, scales:(()=>{const t=document.querySelector('#rink').getContext('2d').getTransform();return [Math.hypot(t.a,t.b),Math.hypot(t.c,t.d)]})()})") { value in
                            self.checks["fullscreen"] = value
                            self.checks["nativeWindowFullscreen"] = self.app.window.styleMask.contains(.fullScreen)
                            self.snapshot("mac-fullscreen") {
                                self.evaluate("import('./haptics.mjs').then(async m => { const h=m.createHaptics(); for (const k of Object.keys(m.HAPTIC_PROFILES)) { h.play(k); await new Promise(r=>setTimeout(r,320)); } }); true") { _ in
                                    // evaluateJavaScript doesn't await promises; allow the event sequence to finish.
                                }
                                self.later(8) {
                                    self.app.window.toggleFullScreen(nil)
                                    self.later(2) {
                                        self.evaluate("JSON.stringify({immersive:document.documentElement.classList.contains('immersive'), errors:window.__airHockeyErrors})") { value in
                                            self.checks["exited"] = value
                                            self.evaluate("document.querySelector('#pause').click(); true") { _ in
                                                self.snapshot("mac-window") {
                                                    self.app.webView.load(URLRequest(url: URL(string: "toyasset://bundle/promo/index.html")!))
                                                    self.later(3) {
                                                        self.evaluate("JSON.stringify({title:document.title, promo:!!window.__promo, errors:window.__airHockeyErrors})") { value in
                                                            self.checks["promo"] = value
                                                            self.snapshot("mac-promo") {
                                                                self.app.webView.load(URLRequest(url: URL(string: "toyasset://bundle/promo/film.html")!))
                                                                self.later(3) {
                                                                    self.evaluate("document.querySelector('video').play().catch(e=>window.__airHockeyErrors.push(String(e))); true") { _ in
                                                                        self.later(2) {
                                                                            self.evaluate("JSON.stringify({ready:document.querySelector('video').readyState, time:document.querySelector('video').currentTime, duration:document.querySelector('video').duration, error:document.querySelector('video').error?.code || null, errors:window.__airHockeyErrors})") { value in
                                                                                self.checks["film"] = value
                                                                                self.snapshot("mac-film") { self.saveImage() }
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    func saveImage() {
        app.webView.load(URLRequest(url: URL(string: "toyasset://bundle/index.html")!))
        later(2) {
            self.evaluate("window.AirHockeyNative.saveImage(document.querySelector('#rink').toDataURL('image/png')); true") { _ in
                self.later(1) {
                    guard let url = self.app.lastSavedImage, let data = try? Data(contentsOf: url), !data.isEmpty else {
                        self.failed("Native save did not write its PNG to Downloads"); return
                    }
                    self.checks["savedImage"] = data.count
                    self.checks["savedToDownloads"] = url.deletingLastPathComponent() == FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
                    try? data.write(to: self.directory.appendingPathComponent("mac-saved-image.png"))
                    // Remove exactly the PNG this diagnostic just created.
                    try? FileManager.default.removeItem(at: url)
                    if CommandLine.arguments.contains("--online-smoke") { self.startOnlineCheck() }
                    else if CommandLine.arguments.contains("--competition-smoke") { self.startCompetitionCheck() }
                    else { self.finish() }
                }
            }
        }
    }
    func startOnlineCheck() {
        evaluate("""
        window.__onlineSmoke = {peerPlaying:false, error:null};
        import('./online-config.mjs').then(({ONLINE_SERVER}) => {
          document.querySelector('#online-button').click();
          document.querySelector('#create-room').click();
          let attempts=0;
          const timer=setInterval(()=>{
            const code=document.querySelector('#room-code-display').textContent;
            if(!code){if(++attempts>150){clearInterval(timer);window.__onlineSmoke.error='No room';}return;}
            clearInterval(timer);
            const peer=new WebSocket(ONLINE_SERVER);window.__onlineSmoke.peer=peer;
            peer.onopen=()=>peer.send(JSON.stringify({type:'room.join',code}));
            peer.onerror=()=>window.__onlineSmoke.error='Peer WebSocket failed';
            peer.onmessage=({data})=>{
              const message=JSON.parse(data);
              if(message.type==='room.joined'){
                peer.send(JSON.stringify({type:'player.ready',ready:true}));
                document.querySelector('[data-action=ready]')?.click();
              }
              if(message.type==='snapshot'&&message.phase==='playing')window.__onlineSmoke.peerPlaying=true;
            };
          },100);
        }).catch(error=>window.__onlineSmoke.error=String(error));
        true
        """) { _ in self.later(1) { self.pollOnline(0) } }
    }
    func pollOnline(_ attempt: Int) {
        evaluate("""
        document.querySelector('[data-action=online-resume]:not(:disabled)')?.click();
        JSON.stringify({peerPlaying:window.__onlineSmoke.peerPlaying,error:window.__onlineSmoke.error,
          status:document.querySelector('#status-text').textContent,
          room:document.querySelector('#room-code-display').textContent})
        """) { value in
            let text = value as? String ?? "{}"
            let state = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] ?? [:]
            if state["peerPlaying"] as? Bool == true && (state["status"] as? String)?.contains("比赛进行中") == true {
                self.checks["online"] = text
                self.snapshot("mac-online") {
                    self.evaluate("window.__onlineSmoke.peer.close();document.querySelector('#solo-button').click();true") { _ in
                        if CommandLine.arguments.contains("--competition-smoke") { self.startCompetitionCheck() } else { self.finish() }
                    }
                }
            } else if attempt >= 25 || state["error"] as? String != nil {
                self.checks["online"] = text
                self.evaluate("window.__onlineSmoke?.peer?.close();document.querySelector('#solo-button').click();true") { _ in self.failed("Native public WSS match did not start: \(text)") }
            } else { self.later(1) { self.pollOnline(attempt + 1) } }
        }
    }
    func startCompetitionCheck() {
        opponentBaseline = (app.hapticCounts["opponent-hit"] ?? 0) + (app.hapticCounts["opponent-heavy"] ?? 0)
        evaluate("document.querySelector('#leaderboard-button').click();document.querySelector('#account-button').click();document.querySelector('#connect-account').click();true") { _ in
            self.later(1) { self.pollCompetitionLink(0) }
        }
    }
    func pollCompetitionLink(_ attempt: Int) {
        evaluate("JSON.stringify({code:document.querySelector('#device-code').textContent,bound:document.querySelector('#account-status').textContent.includes('云档已关联'),bridge:typeof window.AirHockeyNative.openToyAuthorization==='function',errors:window.__airHockeyErrors})") { value in
            let text = value as? String ?? "{}"
            let state = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] ?? [:]
            if !self.wroteDeviceCode, let code = state["code"] as? String, code.count == 6 {
                self.wroteDeviceCode = true
                let payload = try? JSONSerialization.data(withJSONObject: ["code": code], options: [.sortedKeys])
                try? payload?.write(to: self.directory.appendingPathComponent("device-link.json"))
            }
            if state["bound"] as? Bool == true {
                self.checks["competitionLink"] = text
                self.app.window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
                self.later(1) {
                    self.evaluate("document.querySelector('#account-dialog').close();document.querySelector('#leaderboard-dialog').close();document.querySelector('#ranked-button').click();true") { _ in
                        self.pollCompetitionMatch(0)
                    }
                }
            } else if attempt >= 100 { self.failed("Native device authorization did not complete") }
            else { self.later(1) { self.pollCompetitionLink(attempt + 1) } }
        }
    }
    func pollCompetitionMatch(_ attempt: Int) {
        evaluate("document.querySelector('[data-action=online-resume]:not(:disabled)')?.click();JSON.stringify({status:document.querySelector('#status-text').textContent,ranked:document.querySelector('#ranked-button').getAttribute('aria-pressed'),profile:document.querySelector('#account-profile').textContent,visibility:document.visibilityState,errors:window.__airHockeyErrors})") { value in
            let text = value as? String ?? "{}"
            let state = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] ?? [:]
            if (state["status"] as? String)?.contains("正在按 Elo 匹配") == true {
                try? Data("{}".utf8).write(to: self.directory.appendingPathComponent("ranked-queued.json"))
            }
            let calls = (self.app.hapticCounts["opponent-hit"] ?? 0) + (self.app.hapticCounts["opponent-heavy"] ?? 0) - self.opponentBaseline
            if (state["status"] as? String)?.contains("比赛进行中") == true && calls > 0 {
                self.checks["competitionMatch"] = text
                self.checks["networkOpponentHapticCalls"] = calls
                self.snapshot("mac-ranked-haptics") {
                    self.evaluate("document.querySelector('#solo-button').click();true") { _ in self.finish() }
                }
            } else if attempt >= 75 { self.failed("Native ranked match or opponent haptic did not arrive: \(text)") }
            else { self.later(1) { self.pollCompetitionMatch(attempt + 1) } }
        }
    }
    func finish() {
        checks["nativeHapticCounts"] = app.hapticCounts
        checks["nativeActiveAtFinish"] = NSApp.isActive
        func object(_ name: String) -> [String: Any] {
            guard let text = checks[name] as? String, let data = text.data(using: .utf8) else { return [:] }
            return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        }
        let initial = object("initial"), full = object("fullscreen"), exited = object("exited"), promo = object("promo"), film = object("film")
        let competitionLink = object("competitionLink"), competitionMatch = object("competitionMatch")
        let competitionPassed = !CommandLine.arguments.contains("--competition-smoke") || (
            competitionLink["bridge"] as? Bool == true && competitionMatch["ranked"] as? String == "true"
            && (checks["networkOpponentHapticCalls"] as? Int ?? 0) > 0
            && [competitionLink, competitionMatch].allSatisfy { ($0["errors"] as? [String])?.isEmpty == true })
        let scales = full["scales"] as? [Double] ?? [0, 1]
        let passed = checks["failure"] == nil && initial["start"] as? Bool == true && initial["pixels"] as? Int == 255
            && full["immersive"] as? Bool == true && checks["nativeWindowFullscreen"] as? Bool == true
            && exited["immersive"] as? Bool == false && promo["promo"] as? Bool == true
            && scales.count == 2 && scales[0] > 0 && abs(scales[0] - scales[1]) < 0.00001
            && (film["ready"] as? Int ?? 0) >= 2 && (film["time"] as? Double ?? 0) > 0
            && (checks["savedImage"] as? Int ?? 0) > 0
            && checks["savedToDownloads"] as? Bool == true
            && competitionPassed
            && [initial, full, exited, promo, film].allSatisfy { ($0["errors"] as? [String])?.isEmpty == true }
        checks["passed"] = passed
        if let data = try? JSONSerialization.data(withJSONObject: checks, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: directory.appendingPathComponent("mac-smoke.json"))
        }
        if passed { NSApp.terminate(nil) } else { exit(1) }
    }
}
