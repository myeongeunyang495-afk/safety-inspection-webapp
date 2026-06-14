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

## Supabase 개인별 저장 설정

개인별로 자료를 나누려면 Supabase 프로젝트를 만들고 아래 순서대로 설정합니다.

### 1. Supabase 프로젝트 만들기

1. https://supabase.com 접속
2. `New project`
3. 프로젝트 이름 입력
4. Database password 설정
5. Region은 가까운 곳 선택
6. 프로젝트 생성

### 2. API 값 확인

Supabase 프로젝트에서:

```text
Project Settings -> API
```

아래 두 값을 복사합니다.

```text
Project URL
anon public key
```

### 3. SQL 실행

Supabase에서:

```text
SQL Editor -> New query
```

아래 SQL을 실행합니다.

```sql
create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.inspections enable row level security;

create policy "Users can read own inspections"
on public.inspections
for select
using (auth.uid() = user_id);

create policy "Users can insert own inspections"
on public.inspections
for insert
with check (auth.uid() = user_id);

create policy "Users can update own inspections"
on public.inspections
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own inspections"
on public.inspections
for delete
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('inspection-photos', 'inspection-photos', false)
on conflict (id) do nothing;

create policy "Users can upload own photos"
on storage.objects
for insert
with check (
  bucket_id = 'inspection-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can read own photos"
on storage.objects
for select
using (
  bucket_id = 'inspection-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can delete own photos"
on storage.objects
for delete
using (
  bucket_id = 'inspection-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);
```

### 4. 로그인 방식 켜기

Supabase에서:

```text
Authentication -> Providers -> Email
```

Email provider를 켭니다.

처음 테스트를 쉽게 하려면 이메일 확인을 잠시 끌 수 있습니다.

```text
Authentication -> Sign In / Providers -> Email -> Confirm email
```

운영할 때는 이메일 확인을 켜는 것이 좋습니다.

### 5. Netlify 환경변수 추가

Netlify에서:

```text
Site configuration -> Environment variables -> Add variable
```

아래 값을 추가합니다.

```text
SUPABASE_URL=Supabase Project URL
SUPABASE_ANON_KEY=Supabase anon public key
LAW_API_OC=cindylaw
```

환경변수를 저장한 뒤 다시 배포합니다.

```text
Deploys -> Trigger deploy -> Deploy site
```

### 6. 앱에서 사용

배포된 앱에서:

1. 상단 `개인별 자료 저장` 영역에서 이메일/비밀번호 입력
2. `가입`
3. 필요하면 이메일 인증
4. `로그인`
5. 점검결과 작성

로그인한 사용자는 본인이 저장한 점검결과와 사진만 볼 수 있습니다.

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

## Google Drive 저장 설정

결과 파일을 개인 Google Drive에 저장하려면 Google Cloud에서 OAuth Client ID를 만들어야 합니다.

1. Google Cloud Console에서 프로젝트 생성
2. `APIs & Services` -> `Library`
3. `Google Drive API` 사용 설정
4. `APIs & Services` -> `OAuth consent screen` 설정
5. `APIs & Services` -> `Credentials`
6. `Create credentials` -> `OAuth client ID`
7. Application type은 `Web application` 선택
8. Authorized JavaScript origins에 Netlify 주소 추가

예:

```text
https://사이트이름.netlify.app
```

생성된 Client ID를 웹앱의 `결과` 화면에 있는 `Google OAuth Client ID` 칸에 저장하면, 각 점검결과에서 한글/엑셀 파일을 Google Drive에 저장할 수 있습니다.

## 참고

로컬에서 저장한 `data/db.json` 데이터와 Netlify 배포 후 저장되는 데이터는 서로 다릅니다. Netlify 배포본은 Netlify Blobs에 데이터를 저장합니다.

## 현재 개인별 저장 방식

앱은 사용자에게 이메일/비밀번호 로그인을 요구하지 않고, Supabase Anonymous sign-ins로 자동 개인 저장공간을 만듭니다.

Supabase에서 아래 설정을 켜야 합니다.

```text
Authentication -> Sign In / Providers -> Anonymous sign-ins
```

이 방식은 사용자가 따로 로그인하지 않아도 점검결과와 사진이 사용자별 `auth.uid()` 기준으로 분리 저장됩니다.

주의할 점:

- 같은 휴대폰/브라우저에서는 본인 자료가 계속 이어집니다.
- 브라우저 데이터를 삭제하거나 다른 기기로 접속하면 새 사용자로 인식될 수 있습니다.
- 기존 SQL의 `auth.uid() = user_id` RLS 정책과 Storage 폴더 정책은 그대로 사용합니다.
