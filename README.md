# 테마별 점검결과 웹앱

안전보건 점검결과를 작성하고, 사진을 압축 저장하며, 결과를 한글/엑셀 파일로 내려받을 수 있는 웹앱입니다. 세부 점검테마를 선택하면 국가법령정보센터 Open API로 관련 산업안전보건 법령을 자동 조회합니다.

## 로컬 실행

```powershell
npm start
```

브라우저에서 접속합니다.

```text
http://localhost:3000
```

## Netlify 배포

이 프로젝트는 Netlify 배포 설정이 이미 들어 있습니다.

- 정적 화면: `public`
- 서버 함수: `netlify/functions/api.mjs`
- API 라우팅: `/api/*` -> `/.netlify/functions/api/*`
- 배포 데이터 저장: Netlify Blobs

### 1. GitHub에 업로드

이 폴더 전체를 GitHub 저장소에 올립니다.

필수 파일:

- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `netlify/functions/api.mjs`
- `netlify.toml`
- `package.json`

### 2. Netlify에서 프로젝트 연결

Netlify에서 다음 순서로 진행합니다.

1. `Add new project`
2. `Import an existing project`
3. GitHub 저장소 선택
4. 배포 설정 확인

Netlify가 `netlify.toml`을 읽기 때문에 보통 별도 입력이 필요 없습니다.

```text
Build command: 비워둠
Publish directory: public
Functions directory: netlify/functions
```

### 3. 환경변수 설정

국가법령정보센터 Open API 호출을 위해 Netlify 환경변수에 아래 값을 추가합니다.

```text
LAW_API_OC=cindylaw
```

Netlify 화면 기준:

```text
Site configuration -> Environment variables -> Add variable
```

환경변수를 추가한 뒤에는 `Deploys`에서 `Trigger deploy` 또는 `Retry deploy`로 다시 배포합니다.

## 배포 후 확인

배포가 끝나면 Netlify 주소가 생성됩니다.

```text
https://사이트이름.netlify.app
```

확인할 것:

- 작성 화면이 모바일에서 잘 맞는지
- 세부 점검테마 선택 시 관련 법령이 자동 표시되는지
- 사진 첨부 후 저장되는지
- 결과에서 한글파일 다운로드가 되는지
- 휴대폰 브라우저에서도 접속되는지

## 참고

로컬에서 저장한 `data/db.json` 데이터와 Netlify 배포 후 저장되는 데이터는 서로 다릅니다. Netlify 배포본은 Netlify Blobs에 데이터를 저장합니다.
