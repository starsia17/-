# 작업 아카이브 포트폴리오

Express와 MongoDB를 사용하는 개인 작업 포트폴리오입니다. 작업 제목, 분류, 설명과 사진·동영상을 한 게시물로 등록할 수 있고, 등록한 미디어를 사이트에서 바로 볼 수 있습니다.

## 실행하기

1. Node.js 18 이상과 MongoDB 연결 주소를 준비합니다.
2. 프로젝트 폴더에서 의존성을 설치합니다.

   ```sh
   npm install
   ```

3. `.env.example`을 `.env`로 복사한 뒤 값을 설정합니다.

   ```sh
   cp .env.example .env
   ```

   - `MONGODB_URI`: 기존 MongoDB 연결 문자열
   - `PORTFOLIO_ADMIN_PASSWORD`: 게시물 작성 화면에 로그인할 비밀번호
   - `ADMIN_SESSION_SECRET`: 관리자 로그인 쿠키 서명용 임의 문자열. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 명령으로 생성할 수 있습니다.

4. 서버를 시작합니다.

   ```sh
   npm start
   ```

브라우저에서 `http://localhost:3000`을 열면 됩니다. 관리자 비밀번호를 입력하면 게시물 작성 폼이 열립니다. 로그인은 12시간 뒤 만료됩니다.

## 게시물과 미디어

- 제목, 분류, 설명, 첨부 파일 참조는 MongoDB `portfolioPosts` 컬렉션의 한 문서로 저장됩니다. 서버 시작 때 필요한 피드 인덱스를 확인·생성합니다.
- 사진과 동영상 원본은 GridFS `portfolioMedia.files`와 `portfolioMedia.chunks`에 저장합니다. 게시물 문서는 GridFS 파일 ID를 참조하며, 서버는 `/api/media/:id`에서 파일을 스트리밍합니다.
- 게시물당 이미지와 동영상을 합쳐 최대 10개, 파일당 최대 50MB까지 첨부할 수 있습니다.
- 허용 형식: JPEG, PNG, GIF, WebP, MP4, WebM, MOV.
- `/api/posts`는 공개 피드이며, 게시물 작성은 관리자 로그인 쿠키가 있어야 사용할 수 있습니다.
- 서버 시작 때 게시물 컬렉션과 인덱스가 준비되고, 첫 미디어 업로드 때 GridFS 버킷 컬렉션이 생성됩니다. 이 앱은 포트폴리오 게시물과 미디어만 사용합니다.
- `/api/health`에서 MongoDB 연결 상태를 확인할 수 있습니다.

## 배포 시 참고

이제 사진과 동영상도 MongoDB에 들어가므로 앱 서버의 로컬 디스크를 영속 저장소로 설정할 필요가 없습니다. GridFS를 사용해 일반 MongoDB 문서 크기 제한보다 큰 파일을 청크로 나누어 저장합니다. 업로드는 MongoDB 용량과 트래픽을 사용하므로 운영 환경의 요금제 한도도 확인하세요. `MONGODB_URI`, `PORTFOLIO_ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`은 호스팅 서비스의 환경 변수로 등록하고 비밀 값을 저장소에 올리지 마세요.

