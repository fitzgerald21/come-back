import WebKit
import UniformTypeIdentifiers

/// Serves the bundled `www` folder at app://localhost/. A real origin (rather than file://) is what lets
/// the page's ES modules, fetch() and localStorage behave as they do on the web.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "app"
    private let root = Bundle.main.bundleURL.appendingPathComponent("www", isDirectory: true)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { task.didFailWithError(URLError(.badURL)); return }
        var path = url.path.removingPercentEncoding ?? url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardized
        guard file.path.hasPrefix(root.standardized.path),
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            respond(task, url: url, status: 404, headers: [:], body: Data())
            return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        var headers = ["Content-Type": mime, "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Cache-Control": "no-cache"]
        // Media elements ask for byte ranges.
        if let range = task.request.value(forHTTPHeaderField: "Range"), range.hasPrefix("bytes="),
           let (lo, hi) = parse(range: range, size: data.count) {
            headers["Content-Range"] = "bytes \(lo)-\(hi)/\(data.count)"
            respond(task, url: url, status: 206, headers: headers, body: data.subdata(in: lo..<(hi + 1)))
        } else {
            respond(task, url: url, status: 200, headers: headers, body: data)
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func parse(range: String, size: Int) -> (Int, Int)? {
        let parts = range.dropFirst(6).split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2, size > 0 else { return nil }
        let lo = Int(parts[0]) ?? 0
        let hi = min(Int(parts[1]) ?? (size - 1), size - 1)
        return lo <= hi ? (lo, hi) : nil
    }

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, headers: [String: String], body: Data) {
        var h = headers
        h["Content-Length"] = String(body.count)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: h)!
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }
}
