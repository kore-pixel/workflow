# 플래너

할 일 · 집중 타이머 · 용돈 기입장 (Microsoft To Do 연동)

## 올리는 법 (GitHub Pages)
1. GitHub에서 새 저장소(예: `planner`)를 만들고, 이 폴더 안의 파일을 전부 올립니다.
2. Settings → Pages → Branch: `main` / `(root)` → Save
3. 잠시 뒤 `https://<내아이디>.github.io/planner/` 주소가 생겨요. 이 주소가 Azure에 등록할 리디렉션 URI입니다. (끝의 `/`까지 그대로)

## Azure 설정
1. Azure 포털 → Microsoft Entra ID → 앱 등록 → 새 등록 (지원 계정 유형: 개인 계정 포함)
2. 만든 앱 → 인증(Authentication) → 플랫폼 추가 → **단일 페이지 애플리케이션** → 위 주소 붙여넣기
3. 개요의 "애플리케이션(클라이언트) ID" 복사 → 앱의 설정 탭에 붙여넣기 (또는 config.js에 넣고 다시 올리기)

## 폰/탭에 설치
Chrome에서 사이트를 열고 메뉴 → "홈 화면에 추가"
