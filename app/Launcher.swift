import Cocoa
import WebKit

// Native shell for Vibecode: starts the bundled server, then shows its UI in a window.
// Layout inside Vibecode.app/Contents/Resources:
//   server/vibecode-server   the compiled Bun server
//   web/                     the UI it serves
//   claude/claude            the Claude Code binary the Agent SDK drives

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private var server: Process?
    private var loaded = false
    private var quitting = false
    private let bg = NSColor(red: 0.043, green: 0.051, blue: 0.063, alpha: 1)

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        buildMenu()
        buildWindow()
        startServer()
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: server

    // In a universal app the Bun server and Claude Code ship once per CPU type ("-arm64" / "-x64"); pick the one for
    // the slice that is running. Single-architecture builds keep the plain names.
    private func binary(_ path: String) -> URL {
        #if arch(arm64)
        let suffix = "-arm64"
        #else
        let suffix = "-x64"
        #endif
        let res = Bundle.main.resourceURL!
        let tagged = res.appendingPathComponent(path + suffix)
        return FileManager.default.fileExists(atPath: tagged.path) ? tagged : res.appendingPathComponent(path)
    }

    private func startServer() {
        let res = Bundle.main.resourceURL!
        let p = Process()
        p.executableURL = binary("server/vibecode-server")
        var env = ProcessInfo.processInfo.environment
        env["VIBECODE_APP"] = "1"
        env["NO_OPEN"] = "1"
        env["PORT"] = "47474" // fixed so the web view's origin (and its saved settings) stay the same between launches
        env["VIBECODE_HOME"] = dataDir().path // its own folder: a fresh install starts empty
        env["VIBECODE_WEB"] = res.appendingPathComponent("web").path
        env["VIBECODE_CLAUDE_BIN"] = binary("claude/claude").path
        if env["SHELL"] == nil { env["SHELL"] = "/bin/zsh" }
        p.environment = env
        p.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser

        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle(forWritingAtPath: logPath()) ?? FileHandle.nullDevice
        var buffer = ""
        out.fileHandleForReading.readabilityHandler = { [weak self] h in
            let data = h.availableData
            guard !data.isEmpty, let s = String(data: data, encoding: .utf8) else { return }
            self?.log(s)
            buffer += s
            // The server prints its address (with a one-time token) once it is listening.
            if let r = buffer.range(of: #"http://127\.0\.0\.1:\d+/\?token=[\w-]+"#, options: .regularExpression) {
                let url = URL(string: String(buffer[r]))!
                buffer = ""
                out.fileHandleForReading.readabilityHandler = nil
                DispatchQueue.main.async { self?.show(url) }
            }
        }
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self, !self.quitting else { return }
                let a = NSAlert()
                a.messageText = "Vibecode's server stopped"
                a.informativeText = "Exit code \(proc.terminationStatus). Details are in ~/Library/Application Support/Vibecode/server.log."
                a.runModal()
                NSApp.terminate(nil)
            }
        }
        do { try p.run(); server = p } catch {
            let a = NSAlert(); a.messageText = "Couldn't start the server"; a.informativeText = "\(error)"; a.runModal()
            NSApp.terminate(nil)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self, !self.loaded else { return }
            let a = NSAlert(); a.messageText = "Vibecode is taking too long to start"
            a.informativeText = "Check ~/Library/Application Support/Vibecode/server.log."; a.runModal()
        }
    }

    private func log(_ text: String) {
        if let h = FileHandle(forWritingAtPath: logPath(keep: true)) { h.seekToEndOfFile(); h.write(Data(text.utf8)); try? h.close() }
    }

    // ~/Library/Application Support/Vibecode: logins, chats and the open-folder list live here.
    private func dataDir() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("Vibecode")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func logPath(keep: Bool = false) -> String {
        let dir = dataDir()
        let path = dir.appendingPathComponent("server.log").path
        if !keep || !FileManager.default.fileExists(atPath: path) { FileManager.default.createFile(atPath: path, contents: nil) }
        return path
    }

    private func show(_ url: URL) {
        loaded = true
        web.load(URLRequest(url: url))
        window.makeKeyAndOrderFront(nil)
    }

    // MARK: window

    private func buildWindow() {
        let cfg = WKWebViewConfiguration()
        web = WKWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = self
        web.navigationDelegate = self
        web.underPageBackgroundColor = bg
        web.allowsMagnification = false

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1500, height: 920),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Vibecode"
        window.backgroundColor = bg
        window.contentView = web
        window.minSize = NSSize(width: 900, height: 560)
        window.setFrameAutosaveName("VibecodeMain")
        if !window.setFrameUsingName("VibecodeMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
    }

    // MARK: menu (Cmd+C / Cmd+V etc. only work in a web view when the Edit menu exists)

    private func buildMenu() {
        let main = NSMenu()
        func add(_ menu: NSMenu, _ title: String, _ sel: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) {
            let item = menu.addItem(withTitle: title, action: sel, keyEquivalent: key)
            item.keyEquivalentModifierMask = mods
            item.target = target
        }
        func submenu(_ title: String, _ build: (NSMenu) -> Void) {
            let m = NSMenu(title: title)
            build(m)
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            item.submenu = m
            main.addItem(item)
        }

        submenu("Vibecode") { m in
            add(m, "About Vibecode", #selector(NSApplication.orderFrontStandardAboutPanel(_:)))
            m.addItem(.separator())
            add(m, "Hide Vibecode", #selector(NSApplication.hide(_:)), "h")
            add(m, "Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option])
            m.addItem(.separator())
            add(m, "Quit Vibecode", #selector(NSApplication.terminate(_:)), "q")
        }
        submenu("Edit") { m in
            add(m, "Undo", Selector(("undo:")), "z")
            add(m, "Redo", Selector(("redo:")), "z", [.command, .shift])
            m.addItem(.separator())
            add(m, "Cut", #selector(NSText.cut(_:)), "x")
            add(m, "Copy", #selector(NSText.copy(_:)), "c")
            add(m, "Paste", #selector(NSText.paste(_:)), "v")
            add(m, "Select All", #selector(NSText.selectAll(_:)), "a")
        }
        submenu("View") { m in
            add(m, "Reload", #selector(reload), "r", target: self)
            m.addItem(.separator())
            add(m, "Zoom In", #selector(zoomIn), "+", target: self)
            add(m, "Zoom Out", #selector(zoomOut), "-", target: self)
            add(m, "Actual Size", #selector(zoomReset), "0", target: self)
            m.addItem(.separator())
            add(m, "Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])
        }
        submenu("Window") { m in
            add(m, "Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")
            add(m, "Close", #selector(NSWindow.performClose(_:)), "w")
            NSApp.windowsMenu = m
        }
        NSApp.mainMenu = main
    }

    @objc private func reload() { web.reload() }
    @objc private func zoomIn() { web.pageZoom = min(web.pageZoom + 0.1, 2.0) }
    @objc private func zoomOut() { web.pageZoom = max(web.pageZoom - 0.1, 0.6) }
    @objc private func zoomReset() { web.pageZoom = 1.0 }

    // MARK: web view delegates

    // alert()/confirm() are used by the UI for a few error messages.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.runModal(); completionHandler()
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }
    // <input type="file"> (image attachments)
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.begin { completionHandler($0 == .OK ? panel.urls : nil) }
    }
    // Links that want a new window (target=_blank) open in the default browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, url.host != "127.0.0.1", url.scheme?.hasPrefix("http") == true {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    // MARK: lifecycle

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        // SIGTERM lets the server stop Remote Control and any terminals it started.
        if let s = server, s.isRunning {
            s.terminate()
            let deadline = Date().addingTimeInterval(7)
            while s.isRunning && Date() < deadline { usleep(50_000) }
            if s.isRunning { kill(s.processIdentifier, SIGKILL) }
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
