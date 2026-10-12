import SwiftUI
import WebKit
@main struct PortfolivApp: App {
 var body: some Scene { WindowGroup { Browser().ignoresSafeArea(.keyboard) } }
}
struct Browser: UIViewRepresentable {
 func makeCoordinator() -> Coordinator { Coordinator() }
 func makeUIView(context: Context) -> WKWebView {
  let config = WKWebViewConfiguration()
  config.websiteDataStore = .default()
  let view = WKWebView(frame: .zero, configuration: config)
  view.navigationDelegate = context.coordinator; view.uiDelegate = context.coordinator
  view.allowsBackForwardNavigationGestures = true
  view.load(URLRequest(url: URL(string: "https://portfoliv.onrender.com/")!))
  return view
 }
 func updateUIView(_ uiView: WKWebView, context: Context) {}
 class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  var file: URL?
  func trusted(_ url: URL?) -> Bool { url?.scheme == "https" && url?.host == "portfoliv.onrender.com" && (url?.port == nil || url?.port == 443) }
  func presenter() -> UIViewController? { UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }.first { $0.isKeyWindow }?.rootViewController }
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
   if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
   if trusted(action.request.url) || action.request.url?.absoluteString == "about:blank" || action.request.url?.absoluteString.hasPrefix("blob:https://portfoliv.onrender.com/") == true {
    decisionHandler(action.shouldPerformDownload ? .download : .allow)
   } else { decisionHandler(.cancel); if let url = action.request.url, ["https", "mailto", "tel"].contains(url.scheme ?? "") { UIApplication.shared.open(url) } }
  }
  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
   let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
   try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
   let destination = folder.appendingPathComponent(URL(fileURLWithPath: suggestedFilename).lastPathComponent); file = destination; completionHandler(destination)
  }
  func downloadDidFinish(_ download: WKDownload) { if let file = file { let share = UIActivityViewController(activityItems: [file], applicationActivities: nil); share.popoverPresentationController?.sourceView = presenter()?.view; presenter()?.present(share, animated: true) }; file = nil }
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
   guard trusted(webView.url) else { return nil }
   let child = WKWebView(frame: .zero, configuration: configuration); child.navigationDelegate = self; child.uiDelegate = self
   let controller = PrintPage(web: child); presenter()?.present(UINavigationController(rootViewController: controller), animated: true); return child
  }
  func webViewDidClose(_ webView: WKWebView) { presenter()?.presentedViewController?.dismiss(animated: true) }
  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
   let alert = UIAlertController(title: "포트폴리브", message: message, preferredStyle: .alert)
   alert.addAction(UIAlertAction(title: "아니오", style: .cancel) { _ in completionHandler(false) }); alert.addAction(UIAlertAction(title: "예", style: .default) { _ in completionHandler(true) }); presenter()?.present(alert, animated: true)
  }
 }
}
class PrintPage: UIViewController {
 let web: WKWebView
 init(web: WKWebView) { self.web = web; super.init(nibName: nil, bundle: nil) }
 required init?(coder: NSCoder) { fatalError() }
 override func loadView() { view = web }
 override func viewDidLoad() { super.viewDidLoad(); title = "포트폴리브 PDF"; navigationItem.leftBarButtonItem = UIBarButtonItem(title: "닫기", style: .plain, target: self, action: #selector(close)); navigationItem.rightBarButtonItem = UIBarButtonItem(title: "인쇄 · PDF", style: .plain, target: self, action: #selector(printPDF)) }
 @objc func close() { dismiss(animated: true) }
 @objc func printPDF() { let printController = UIPrintInteractionController.shared; printController.printFormatter = web.viewPrintFormatter(); printController.present(animated: true) }
}
