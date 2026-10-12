# 포트폴리브 모바일 앱 1.0.0

Android는 운영 HTTPS 사이트를 사용하는 네이티브 WebView 앱입니다. 웹과 같은 서버·계정·자료를 이용합니다. 웹 화면 저장은 서버에 반영되며 다른 기기의 열린 화면에는 새로 불러올 때 표시됩니다. 다른 기기에 자동 푸시되는 실시간 편집 동기화는 이번 앱에 포함하지 않았습니다. 인터넷 연결이 필요합니다.

Android: APK를 내려받아 설치하세요. Android 8.0 이상, 최신 Android System WebView가 필요합니다. APK 설치 시 기기에서 해당 다운로드 앱의 ‘출처를 알 수 없는 앱 설치’를 허용해야 합니다. 파일 선택과 PDF 파일 저장 위치 선택은 Android 시스템 화면을 사용합니다. 인쇄용 창에서는 상단 ‘PDF 저장 · 인쇄’를 누르세요. 외부 링크는 외부 앱에서 엽니다. 비밀번호·MongoDB 접속 정보·관리자 키는 앱에 넣지 않았습니다. 웹사이트의 2단계 인증과 회원별 권한을 그대로 적용합니다. 웹브라우저와 앱 로그인 세션은 별개입니다.

iPhone은 APK를 설치할 수 없습니다. `ios`는 iOS 15 이상용 Swift/WKWebView 프로젝트 소스입니다. Mac에서 Xcode와 XcodeGen을 설치하고 `cd ios && xcodegen generate`로 프로젝트를 만듭니다. Xcode에서 Signing & Capabilities의 Apple 개발 팀을 선택하고 실기기에 빌드하거나 Archive → Distribute App으로 IPA/TestFlight를 생성합니다. App Store/TestFlight 배포에는 Apple Developer 등록 및 Apple 심사가 필요합니다. 이 환경은 Linux이므로 iOS 빌드·서명·실기기 검증을 수행하지 않았습니다. 앱스토어 등록을 완료한 상태가 아닙니다.

검증 범위: Android 컴파일·APK 서명·패키지 권한 검사는 수행합니다. Android/iPhone 실제 기기의 파일 선택·동영상·PDF·로그인 동작은 실기기 검증 전입니다. 서명 키는 소스에 포함하지 않고 별도로 안전하게 보관해야 동일 앱 업데이트를 설치할 수 있습니다. 기존 웹사이트 코드는 변경하지 않습니다.
