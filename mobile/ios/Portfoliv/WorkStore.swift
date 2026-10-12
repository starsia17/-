import Foundation
import CryptoKit
import Security
import WebKit
import SwiftUI
final class WorkStore {
 private let service = "com.portfoliv.work-state-v2"
 private let url: URL
 init() {
  let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
  try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
  url = folder.appendingPathComponent("work-state.enc")
 }
 private func key() throws -> SymmetricKey {
  let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
  var item: CFTypeRef?
  if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data { return SymmetricKey(data:data) }
  let key = SymmetricKey(size:.bits256), data = key.withUnsafeBytes { Data($0) }
  let insert: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecValueData as String:data,kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
  guard SecItemAdd(insert as CFDictionary,nil) == errSecSuccess else { throw NSError(domain:service,code:1) }
  return key
 }
 func read() -> String { do { let box = try AES.GCM.SealedBox(combined:Data(contentsOf:url)); let plain = try AES.GCM.open(box,using:key(),authenticating:Data(service.utf8));return String(data:plain,encoding:.utf8) ?? "null" } catch { return "null" } }
 func write(_ value: String) throws { guard value.utf8.count<8_000_000 else { return };let encrypted=try AES.GCM.seal(Data(value.utf8),using:key(),authenticating:Data(service.utf8));try encrypted.combined?.write(to:url,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication]);var link=url;var resources=URLResourceValues();resources.isExcludedFromBackup=true;try? link.setResourceValues(resources) }
}
@MainActor final class BrowserModel: ObservableObject {
 let web: WKWebView
 let store:WorkStore
 private var timer: Timer?
 private var last = ""
 private let writer=DispatchQueue(label:"com.portfoliv.work-writer")
 init() {
  let workStore=WorkStore();store=workStore
  let config=WKWebViewConfiguration();config.websiteDataStore = .default()
  func resource(_ name:String,_ ext:String)->String { guard let url=Bundle.main.url(forResource:name,withExtension:ext,subdirectory:"AppAssets") ?? Bundle.main.url(forResource:name,withExtension:ext),let data=try? String(contentsOf:url,encoding:.utf8) else { return "" };return data }
  func quoted(_ value:String)->String { let data=try! JSONSerialization.data(withJSONObject:[value]);let text=String(data:data,encoding:.utf8)!;return String(text.dropFirst().dropLast()) }
  let boot="window.__pfBoot="+workStore.read()+";window.__pfStyle="+quoted(resource("app","css"))+";"+resource("bootstrap","js")
  config.userContentController.addUserScript(WKUserScript(source:boot,injectionTime:.atDocumentStart,forMainFrameOnly:true))
  config.userContentController.addUserScript(WKUserScript(source:resource("ios-hooks","js"),injectionTime:.atDocumentEnd,forMainFrameOnly:true))
  web=WKWebView(frame:.zero,configuration:config)
 }
 func checkpoint(){guard web.url?.host=="portfoliv.onrender.com",web.url?.scheme=="https" else { return };web.evaluateJavaScript("window.portfolivApp?(window.portfolivApp.flush(),JSON.stringify({work:JSON.parse(window.portfolivApp.take()),action:window.portfolivApp.popAction()})):null"){ [weak self] result,error in guard let self=self,let raw=result as? String,let data=raw.data(using:.utf8),let payload=try? JSONSerialization.jsonObject(with:data) as? [String:Any] else { return };let value:String;if let object=payload["work"] as? [String:Any],let encoded=try? JSONSerialization.data(withJSONObject:object),let text=String(data:encoded,encoding:.utf8){value=text}else{value="null"};let action=payload["action"] as? String ?? "";if value==self.last && action.isEmpty(){return};self.last=value;let storage=self.store;self.writer.async { try? storage.write(value);DispatchQueue.main.async { if action=="reload"{self.web.reload()}else if action=="browser",let url=self.web.url{UIApplication.shared.open(url)} } } } }
 func resume(){timer?.invalidate();timer=Timer.scheduledTimer(withTimeInterval:1,repeats:true){[weak self] _ in self?.checkpoint()};web.evaluateJavaScript("window.portfolioAuth&&window.portfolioAuth.refresh()")}
 func pause(){checkpoint();timer?.invalidate();timer=nil}
 deinit { timer?.invalidate() }
}
