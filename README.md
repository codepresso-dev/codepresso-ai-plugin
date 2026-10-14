# Codepresso

Claude Code·Codex·OMP용 팀 워크플로우 플러그인 — Notion 작업 동기화, 스프린트 워크플로우 자동화, PR 연동 git 활동 추적, **Gmail + Google Chat 받은편지함 작업 트래커**, 평일 Google Chat 북엔드, **Figma → 프론트엔드 scaffold 자동화**, **개인 LLM Wiki**, 선택적 배포 연동, 온콜 관리까지.

---

## 주요 기능

- **Notion 작업 선택기**: 세션 시작 시 Notion 작업을 고르면 상태가 자동으로 "진행 중"으로 바뀌고, PR 제목에 작업 ID가 강제됩니다.
- **PR 제목 강제**: `gh pr create` 시 선택한 작업의 unique ID(예: `TSK-9945`)가 없으면 차단합니다. Notion의 GitHub 연동이 PR을 자동으로 작업에 연결해 줍니다.
- **Git 활동 추적**: 활성 PR에서의 `git commit`을 감지해 `gh pr comment`로 커밋 코멘트를 자동 게시합니다.
- **PR 머지 → Notion 상태 전이**: `gh pr merge`를 감지해 연결된 Notion 작업(그리고 에픽의 마지막 작업이라면 에픽까지)을 완료 상태로 전환합니다.
- **스프린트 워크플로우**: 세션 시작 시 Sprint → Epic → Task 계층을 가져오고, 에픽의 모든 작업이 끝나면 에픽도 자동 완료 처리합니다.
- **🆕 받은편지함 작업 트래커**: Gmail과 Google Chat에 묻혀 잊혀지는 작업 요청을 매일 아침 자동으로 스캔합니다. AI가 후보를 골라주면 한 번의 클릭으로 마감일 있는 Notion 작업으로 변환되며, 아침 인사 메시지에는 마감 임박/지난 작업이 함께 표시됩니다.
- **🆕 Figma → 프론트엔드 scaffold (v0.2.9)**: Figma URL + node-id + PAT만 주면 디자인 시스템 토큰이 매핑된 Vue/React scaffold를 자동 생성합니다. Codepresso 검증 결과 픽셀 일치율 87~97%, 하드코딩 hex 0건, 토큰 준수율 6× 향상, 퍼블리셔 시간 75~85% 절감.
- **🆕 보안 진단 (v0.2.12)**: `/codepresso:security-audit` — OWASP Top 10:2025와 2025–2026 최신 웹 보안 사고를 근거로 코드·인프라를 스캔하고(기술 스택 무관), 선택 시 개발자 머신의 로컬 자격증명까지 점검한 뒤, 인터뷰를 거쳐 점수가 매겨진 리메디에이션 리포트를 생성합니다. 시크릿 값은 절대 출력하지 않습니다.
- **평일 Google Chat 북엔드** (월–금): 첫 세션 시작 시 진행 중 작업 + 내 오픈 PR + 리뷰 요청 PR을 아침 인사로 전송, 18시에는 오늘의 커밋/머지된 PR/진행 중 작업을 Claude Haiku로 요약해 마감 메시지로 전송합니다.
- **배포 연동** (선택): ECS, CodePipeline, GitHub Actions, 커스텀 명령어 중 원하는 방식으로 Claude Code에서 배포를 트리거할 수 있습니다.
- **온콜 관리** (선택): DynamoDB + Google Calendar 기반 온콜 스케줄 조회/교체/생성, 런북 검색까지 Claude에서 한 번에.
- **LLM Wiki + OMP 자동 작업 이력 (v0.2.27)** (선택): 개인 지식 베이스의 ingest/query/lint와 함께, OMP에서 완료·검증한 작업을 근거 기반 work-history로 자동 누적합니다. 각자 자기 vault(Obsidian + private git)를 사용합니다.
- **🆕 AIDLC 스캐폴더**: 임의의 저장소를 "AI 에이전트가 일하기 좋은 구조"(AGENTS.md·ADR·문서정책·CI·코드구조 인덱스 등 16항목)에 맞춰 진단하고, **없는 것만** 비파괴로 깔아줍니다. 진단 → 인터뷰 → 미리보기 → 생성 → 재진단. 외부 연동 없이 동작하며, 모노레포면 하위 프로젝트별로 맞춰 생성합니다.
- **OMC 호환**: oh-my-claudecode와 충돌 없이 함께 동작합니다.
- **모노레포 / 서브모듈 지원**: 모노레포 루트에서 작업할 때 서브모듈의 활성 PR을 자동 감지합니다.

---

## 무엇이 편리해지나요?

### 🔁 반복 작업이 사라집니다
- **PR ↔ Notion 연결**: 매번 Notion 작업을 PR에 손으로 붙이던 일이 제목 강제로 자동화 → 클릭 3~4번이 0번으로.
- **커밋 진행 상황 공유**: 커밋마다 PR에 코멘트 다는 일을 git 훅이 대신 → 리뷰어가 따라가기 쉬워집니다.
- **작업 완료 처리**: PR 머지 후 Notion에 가서 상태 바꾸는 일을 잊지 않아도 됩니다 (자동 전이).
- **에픽 자동 완료**: 에픽의 마지막 작업이 끝나면 에픽까지 자동으로 완료로 표시.

### 📥 잊혀지는 작업이 없어집니다
- **Gmail/Chat 자동 triage**: 받은편지함과 채팅의 작업 요청이 알림 너머로 사라지지 않습니다. 매일 아침 AI가 후보를 추려 보여줍니다.
- **마감일 추적**: 마감일이 지난 작업과 오늘 마감인 작업이 아침 인사에 묶여 → 우선순위 정리가 자동으로.
- **30일 dedup**: 한 번 거절한 메시지는 30일간 다시 추천되지 않아 같은 알림에 시달리지 않습니다.

### 🪟 컨텍스트 전환이 줄어듭니다
- **한 화면에서 시작**: 스프린트 진행 상황, 내 PR, 리뷰 대기 PR, 받은편지함 작업을 Google Chat 한 곳에서 → 아침에 여러 탭을 켤 필요가 없습니다.
- **자동 회고**: 평일 18시에 자동 요약을 받아 → "오늘 뭐 했지?" 회고가 무료로 생깁니다.
- **터미널에서 끝**: 작업 선택, PR 생성, 머지, 배포, 온콜 조회 모두 Claude Code 내에서 처리.

### 🎨 퍼블리셔 작업이 줄어듭니다 (v0.2.9 🆕)
- **Figma → AI scaffold**: Figma URL + 본인 PAT만 주면 디자인 시스템 토큰에 매핑된 Vue/React 컴포넌트를 자동 생성합니다.
- **추정 시간 절감 75-85%**: 0부터 1,400줄 작성 (1-2일) → AI scaffold 받아 데이터 연결/미세 조정 (1-2시간).
- **하드코딩 hex 0건 보장**: `$color-*` / `$space-*` / `$radius-*` 토큰을 자동으로 적용합니다.
- **검증된 결과**: Codepresso 평가리포트 페이지 3개로 검증, 픽셀 일치율 HIGH 86.62% / MID 96.87% / LOW 96.71%.

### 🧠 지식이 휘발되지 않습니다 (v0.2.13 🆕)
- **대화를 넘어 남습니다**: 한 번 배운 것(AWS/인프라 패턴, 언어 함정, 팀 프로세스, 조사한 개념)을 위키 페이지로 캡처 → 다음 세션·다른 repo에서 그대로 재사용.
- **쌓일수록 똑똑해집니다 (compounding)**: ingest할 때마다 페이지가 서로 연결되어 위키가 점점 풍부해집니다.
- **인용 포함 답변**: query 시 어떤 페이지에서 나온 답인지 출처를 함께 보여줘 → 신뢰할 수 있는 개인 지식 베이스.
- **개인 vault, 도구만 공유**: 각자 자기 Obsidian + git vault를 가지므로 내용은 공유되지 않으며, private remote를 붙이면 여러 컴퓨터에서 동기화됩니다.

### 👥 팀과의 가시성이 좋아집니다
- **비동기 추적**: 모든 활동이 PR 코멘트와 Notion 상태로 흐릅니다. 팀원이 회의 없이 진행 상황을 따라갈 수 있습니다.
- **공유 채널**: Google Chat 스페이스에서 아침/저녁 자동 메시지로 → 작업 현황 공유에 추가 작업이 들지 않습니다.
- **자동 라벨링**: PR에 자동으로 `ai-assisted` 라벨이 붙어 → AI 협업 비율 파악에 도움.

---

## LLM Wiki + OMP 자동 작업 이력 (v0.2.27)

Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
패턴 기반 개인 위키. 각 사용자가 자기 vault를 가지며 내용은 공유하지 않고 도구만 공유합니다.

```text
/codepresso:llm-wiki init
/codepresso:llm-wiki ingest <url|메모>
/codepresso:llm-wiki query <질문>
/codepresso:llm-wiki lint
/codepresso:llm-wiki auto-capture on [work-history-path]
```

OMP에서는 플러그인을 user scope로 한 번 연결합니다.

```bash
omp plugin link /path/to/codepresso-ai-plugin --scope user
```

`auto-capture on`은 OMP main session 종료 시 최신 작업을 평가합니다. 완료된 구현·수정·배포,
검증된 실험·조사·감사·리뷰, 전달된 설계만 source + work-history + `log.md`에 기록합니다.
잡담·계획만 있는 turn·근거 없는 결과·자격증명·동료 평가는 제외합니다. 상태 표시줄 항목은 만들지
않습니다.

`wiki.autoSync: true`이면 기록 전에 upstream을 fetch하고 필요한 경우에만 fast-forward한 뒤,
관련 파일만 commit·push합니다. diverged branch는 자동 merge하지 않고 중단합니다. Claude Code
hook의 기존 `wiki.autoFetch` 알림 동작은 그대로 유지됩니다.

---

## 🆕 AIDLC 스캐폴더 (`aidlc-init` / `aidlc-doctor`)

임의의 저장소를 팀의 **"AI-native 저장소" 16항목 템플릿**에 맞춰 진단·구성하는 도구. 플러그인을 codepresso 전용을 넘어 **어느 프로젝트에나** 적용할 수 있게 합니다.

```
/codepresso:aidlc-init <경로>     # 진단 → 인터뷰 → 미리보기 → 생성(없는 것만) → 재진단
/codepresso:aidlc-doctor <경로>   # 진단만 (점수 + 빠진 항목, 파일 변경 없음)
```

- **비파괴**: 이미 있는 파일은 절대 덮어쓰지 않고 없는 것만 만듭니다. 여러 번 돌려도 안전(멱등).
- **AGENTS.md 권위**: 실제 내용은 `AGENTS.md` 한 곳에, `CLAUDE.md`·기타 툴 파일(`.cursor/rules` 등)은 포인터 → Claude·Cursor·Codex 등 어떤 도구든 한 소스를 공유.
- **로컬 우선**: 핵심 동작에 Notion/Figma 등 외부 연동이 필요 없습니다(연동은 선택).
- **모노레포 자동 적응**: 하위 프로젝트 구조를 감지해 각 하위에 맞는 `CLAUDE.md`까지 생성.
- **시크릿 점검 내장**: 평문 토큰을 발견하면 경고하고 새로 만드는 파일에 옮기지 않습니다.

16항목 템플릿·준수도 평가 기준은 [`docs/superpowers/specs/2026-05-31-aidlc-ai-native-plugin-design.md`](docs/superpowers/specs/2026-05-31-aidlc-ai-native-plugin-design.md) 참고.

---

## 설치

### Codex

Codex에서는 플러그인 source를 개인 marketplace에 등록한 뒤 설치합니다.

```bash
mkdir -p ~/plugins ~/.agents/plugins
git clone https://github.com/code-presso/codepresso-ai-plugin.git ~/plugins/codepresso
cd ~/plugins/codepresso
npm install
```

`~/.agents/plugins/marketplace.json`에 아래 entry를 추가합니다. 이미 `plugins` 배열이
있다면 entry만 추가하세요.

```json
{
  "name": "personal",
  "interface": {
    "displayName": "Personal"
  },
  "plugins": [
    {
      "name": "codepresso",
      "source": {
        "source": "local",
        "path": "./plugins/codepresso"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

그 다음 설치합니다.

```bash
codex plugin add codepresso@personal
```

자동 업데이트를 켜려면 [docs/plugin-auto-update.md](docs/plugin-auto-update.md)의 Codex 섹션처럼
로컬 clone을 주기적으로 `git pull --ff-only` 한 뒤 `codex plugin add codepresso@personal`로
재설치하도록 cron을 설정하세요.

설치 후 새 Codex thread를 열면 skills와 MCP 설정이 로드됩니다. 주요 명령어:

```text
/codepresso:setup
/codepresso:status
/codepresso:notion-sync
/codepresso:sprint-dashboard
/codepresso:sprint-retro
/codepresso:llm-wiki
/codepresso:cloud-dev
/codepresso:deploy
```

### 옵션 A: 플러그인 디렉터리에 심볼릭 링크

```bash
ln -s /path/to/codepresso-plugin ~/.claude/plugins/codepresso
```

### 옵션 B: Claude plugin add

```bash
claude plugin add ./codepresso-plugin
```

### Claude marketplace 자동 업데이트

Claude Code에서는 GitHub marketplace에 `autoUpdate: true`를 설정할 수 있습니다.
예시는 [docs/claude-settings.auto-update.example.json](docs/claude-settings.auto-update.example.json)와
[docs/plugin-auto-update.md](docs/plugin-auto-update.md)를 참고하세요.

### 의존성 설치

```bash
cd codepresso-plugin && npm install
```

---

## 설정

대화식 설정 마법사를 실행하세요:

```
codepresso:setup
```

또는 `~/.codepresso/config.json`을 직접 만들 수 있습니다:

```json
{
  "github": { "token": null },
  "notion": {
    "apiKey": "ntn_...",
    "defaultDatabaseId": "abc123",
    "databases": {
      "sprint": "...",
      "epic": "...",
      "task": "..."
    },
    "sprintWorkflow": {
      "enabled": true,
      "autoTransition": true,
      "epicAutoComplete": true,
      "prTitleFormat": "task"
    }
  },
  "inbox": {
    "enabled": false
  },
  "googleChat": {
    "enabled": false,
    "spaceId": null
  },
  "deploy": {
    "enabled": false,
    "method": null
  }
}
```

### 프로젝트별 설정

프로젝트 루트에 `.codepresso.json`을 두어 전역 설정을 덮어쓸 수 있습니다:

```json
{
  "deploy": {
    "enabled": true,
    "method": "ecs",
    "awsRegion": "ap-northeast-2",
    "ecsCluster": "my-cluster",
    "ecsService": "my-service"
  },
  "notion": { "defaultDatabaseId": "project-specific-db-id" }
}
```

---

## 일상 워크플로우

Codepresso와 함께하는 하루는 이렇게 흐릅니다.

### 1. Claude Code 시작

```
$ claude
```

자동으로:
- 브랜치와 PR을 감지
- 본인이 담당자인 Notion 작업을 가져옴
- 평일 첫 세션이면 아침 인사를 Google Chat으로 전송 (설정된 경우)
- 🆕 `inbox.enabled: true`라면 받은편지함 스캔 안내문을 주입 → Claude가 Gmail + Chat을 훑어 작업 후보를 제시

### 2. 작업 선택

활성 Notion 작업이 대화식 picker로 표시됩니다:

```
어떤 작업을 하시겠어요?

  [TSK-9945] plugin과 notion 연동 되도록 title 형식 지정  (진행 중)
  [TSK-8700] Oracle DB 성능 테스트                        (할 일)
  [TSK-8650] C, Java, Python 프로토타이핑                  (진행 중)
  Other
```

작업을 선택하면:
- Notion 작업 상태가 "진행 중"으로 자동 변경
- 선택 정보가 저장되어 PR 제목 강제에 활용

### 3. 평소처럼 작업

코드를 짜고, 커밋하세요. 각 `git commit`은 활성 PR에 작은 코멘트로 자동 게시되어 리뷰어가 진행 상황을 따라갈 수 있습니다.

### 4. PR 생성

PR을 만들 때 Codepresso는 Notion 작업 ID를 **강제**합니다:

```
# 이건 차단됩니다:
gh pr create --title "Add PR title format"

# Codepresso가 안내:
gh pr create --title "TSK-9945 Add PR title format"
```

`TSK-9945` 접두사 덕분에 Notion의 GitHub 연동이 PR을 작업에 **자동 연결**합니다 — 수동 작업 없이.

### 5. 머지

`gh pr merge`를 하면 연결된 Notion 작업이 완료로 전이됩니다. 에픽의 마지막 작업이 막 끝났다면 에픽도 완료로 표시됩니다.

---

## 🆕 받은편지함 작업 트래커 (Inbox Task Tracker)

Gmail과 Google Chat에서 누군가 부탁한 작업이 알림 너머로 사라져 잊혀진 적이 있다면, 이 기능이 해결책입니다.

### 동작 방식

매일 아침 (월–금 첫 세션) 또는 `/codepresso:scan-inbox` 수동 실행 시 다음 절차가 돌아갑니다:

1. **Gmail + Chat 가져오기**: 최근 24시간 내 미확인 이메일(공식 `mcp__claude_ai_Gmail` 커넥터) + 설정한 Chat 스페이스의 새 메시지(`gws` CLI)를 수집합니다.
2. **이전 triage 기억**: 이미 처리한 메시지 ID는 `codepresso-inbox-seen.json`에 30일간 저장되어 다시 추천되지 않습니다.
3. **AI 분류**: Claude가 각 메시지를 보고 "이건 할 일이다 / 아니다"를 판단합니다. 노이즈는 자동으로 걸러집니다.
4. **승인 picker**: `AskUserQuestion` 다중 선택으로 한 번에 4개씩 후보를 보여줍니다. 골라낸 것만 작업이 됩니다.
5. **마감일 지정**: 채택한 후보마다 마감일을 선택합니다 (오늘 EOD / 내일 / 이번주 금요일 / 다음주 월요일 / 사용자 지정).
6. **Notion 작업 생성**: 공식 `mcp__claude_ai_Notion` 커넥터로 작업 페이지를 만듭니다. 제목, 담당자, 상태("할 일"), 마감일, 원본 링크가 자동으로 채워집니다.

매일 아침 인사에는 마감 알림이 자동 포함됩니다:

```
🔥 마감 지남 (2):
  • [TSK-12345] Q3 예산 보내기 — 3일 지남
  • [TSK-12340] 벤더 RFP 회신 — 1일 지남

⏰ 오늘 마감 (1):
  • [TSK-12346] 온보딩 문서 리뷰
```

### 활성화

`codepresso:setup`을 실행하면 받은편지함 설정 단계가 나타납니다. Gmail OAuth 인증 → Notion 작업 DB에 `마감일` 속성 자동 생성 → Notion 알림 토글 안내 → Chat 스페이스 선택 → `inbox.enabled: true` 적용까지 자동 처리됩니다.

수동 설정은 `~/.codepresso/config.json`에 다음을 추가:

```json
{
  "inbox": {
    "enabled": true,
    "sources": {
      "gmail": { "enabled": true, "lookbackHours": 24 },
      "chat":  { "enabled": true, "spaceIds": ["AAAAxxx"] }
    },
    "notion": {
      "taskDatabaseId": "<task DB ID>",
      "dueDateProperty": "마감일"
    }
  }
}
```

**필수 조건**:
- Gmail: Claude.ai의 공식 Gmail 커넥터 OAuth 인증 (`mcp__claude_ai_Gmail__authenticate`)
- Chat: `chat.messages.create` 스코프로 인증된 `gws` CLI
- Notion: 작업 DB에 `date` 타입 속성 (`마감일`). 설정 마법사가 없으면 자동 생성합니다.

### 왜 이게 편한가?

- **놓치는 작업이 없어집니다**: 받은편지함과 Chat을 매일 아침 자동으로 훑어 작업 후보를 제시.
- **AI가 노이즈를 걸러줍니다**: 알림성 메일, 자동 답장, 광고는 분류 단계에서 제외 → 진짜 행동 아이템만 보입니다.
- **승인 없이 작업이 안 생깁니다**: 모든 후보는 사용자 승인 필수. Notion이 자동으로 쓰레기로 차지 않습니다.
- **마감일이 명시적**: 작업마다 마감일을 강제로 정해 우선순위가 흐려지지 않습니다.
- **아침 알림으로 마감 추적**: Notion 네이티브 리마인더 + 아침 Google Chat 인사 양쪽에서 보입니다.

---

## 🆕 Figma → 프론트엔드 scaffold (v0.2.9)

Figma 디자인을 받은 퍼블리셔/프론트엔드 개발자가 처음부터 마크업을 짜는 시간을 75-85% 절감해주는 자동화 파이프라인. 단일 designer agent 호출로 Vue/React 컴포넌트 트리 + 디자인 시스템 토큰 적용까지 한 번에.

### 동작 방식

```
사용자: Figma URL + 본인 PAT 제공
   ↓
Claude: REST API로 node tree 추출 (정확한 width/padding/font/color)
   ↓
figma-to-spec.mjs: hex → $color-* / padding → $space-* / font → $fs-*/$fw-* 자동 매핑
   ↓
designer-high (Opus) + 분할 design_system 컨텍스트 + Figma render PNG
   ↓
Vue/React 컴포넌트 ~9개 (1,400줄) — application/pages/playground/ 자동 통합
   ↓
(선택) Puppeteer로 Human vs AI 픽셀 비교 → 검증 리포트
```

### 활성화

별도 설정 필요 없음. Figma URL + PAT만 있으면 즉시 사용 가능합니다.

1. Figma → Settings → Security → Personal Access Tokens → Generate
2. 스코프: `File content (Read-only)`, `Variables (Read-only)`
3. Claude Code에서 "이 figma 노드로 Vue scaffold 만들어줘 [URL] PAT: figd_..." 식으로 요청

### Codepresso 검증 결과 (N=3 페이지, local Nuxt dev 동일 환경)

| 난이도 | 페이지 | 픽셀 일치율 |
|--------|--------|------:|
| 상 (HIGH) | Assessment Detail (관리자 뷰) | **86.62%** |
| 중 (MID) | Assessment List (다크 테마) | **96.87%** |
| 하 (LOW) | PDF Export | **96.71%** |

- 하드코딩 hex 색상: 3개 페이지 모두 **0개**
- 디자인 토큰 준수율: **73.8%** (legacy 평균 12.21% 대비 6× 향상)
- Mixin 활용: 페이지당 47회

### 왜 이게 편한가?

- **0부터 작성 시간 절감**: 8-13시간 → 1-2시간 (~75-85% 절감)
- **토큰 적용 자동화**: `_variables.scss`의 `$color-*` / `$space-*` / `$radius-*` / `$fs-*` 토큰이 100% 매핑되어 적용됩니다.
- **레이아웃 정확성**: Figma의 정확한 width/height/padding/gap을 그대로 사용 (PNG 추정 X).
- **컴포넌트 reuse 힌트**: Figma component 인스턴스는 `<!-- TODO: reuse <LazyXXX /> -->` 주석으로 표시 → 기존 카탈로그 활용 유도.
- **다른 repo도 5분이면 적응**: `figma-to-spec.mjs`의 `COLOR_MAP`만 그 프로젝트 토큰으로 교체하면 됩니다 (`references/token-map-example.md` 가이드 제공).

### 자세한 가이드

플러그인 내부:
- `skills/scaffolding-from-figma/SKILL.md` — 사용 절차 + 트리거 조건
- `skills/scaffolding-from-figma/references/anti-hallucination.md` — design_system.md를 14파일로 분할해야 환각이 줄어드는 이유 (실험 데이터 포함)
- `skills/scaffolding-from-figma/references/token-map-example.md` — 다른 프로젝트에 적응시키는 방법

실험 결과 + 사이드바이사이드 비교 스크린샷:  
https://github.com/code-presso/global-main-frontend/tree/experiment/design-system-figma-html

---

## 🔒 보안 진단 (security-audit)

`/codepresso:security-audit` — **기술 스택과 무관하게** 웹 서비스의 보안 상태를 점검합니다. 체크리스트는 **OWASP Top 10:2025** 와 **2025–2026 실제 웹 보안 사고**(2025년 9월 npm "Qix"/Shai-Hulud 공급망 공격, 클라우드 오구성 유출, OAuth·자격증명 남용, LLM 프롬프트 인젝션/SSRF)를 근거로 구성됩니다.

흐름은 **스캔 → 인터뷰 → 리포트**:

1. **레포 스캔** (`scan`) — 코드·인프라 설정에서 *증거*를 수집. 네트워크·툴체인 불필요(파일 내용만 읽음): 하드코딩 시크릿, 미고정 의존성/락파일 누락, SQLi·XSS·커맨드 인젝션 싱크, CORS·디버그·TLS 오구성, 안전하지 않은 역직렬화, mutable 태그로 고정된 GitHub Action 등.
2. **개발자 머신 스캔** (`scan-local`, 선택·동의 후) — 로컬 자격증명 위생 점검: 장기 AWS 키, 암호 없는 SSH 키, 평문 npm/docker/git 토큰, 셸 히스토리/환경변수의 시크릿. **시크릿 값은 절대 출력하지 않음** (존재·위험 유형·변수 *이름*만).
3. **인터뷰** — 스캔 증거로 좁힌 질문을 `AskUserQuestion`으로 진행. 정적 스캔이 못 보는 접근제어 로직·MFA/OAuth 범위·IAM 최소권한·로깅/알림 같은 운영 통제를 사람이 확인.
4. **리포트** (`report`) — 0–100 점수 + 등급, 스코어카드, *왜 중요한지*(실제 사고)와 조치 체크리스트가 담긴 우선순위 리메디에이션을 마크다운으로 생성.

플러그인 내부:
- `skills/security-audit/SKILL.md` — 사용 절차 + 트리거 조건
- `scripts/security-audit-cli.mjs` — 결정론적 하네스 (`scan` / `scan-local` / `checklist` / `report`)
- `scripts/lib/security-checklist.mjs` — 12항목 체크리스트 데이터 (OWASP 2025 + 사고 근거 + 가중치)
- `tests/lib/security-audit.test.mjs` — 단위 테스트 (시크릿 미유출 검증 포함)

> 스캐너는 *후보*를 찾을 뿐 단정하지 않습니다 — 앱을 실행하지 않고 툴체인도 필요 없으므로 Node만 있는 환경에서 Python·Go 레포도 진단할 수 있고, 발견 항목은 인터뷰에서 확정합니다.

---

## 자세한 동작 (개발자용)

### 세션 시작

Claude Code를 시작할 때 Codepresso는:
1. `git rev-parse --show-toplevel`로 git 루트 해석
2. 현재 브랜치 감지
3. `gh pr list`로 연결된 PR 찾기
4. PR이 없으면 (예: 모노레포 루트에서 `main` 위) 서브모듈을 스캔해 활성 브랜치 + 오픈 PR을 찾음
5. Notion 작업 (unique ID 포함) 및 스프린트 컨텍스트 가져오기
6. `.codepresso/state/codepresso-session.json`에 모든 정보 캐싱

### Git 추적

Claude Code가 `git commit`을 실행하고 PR이 있으면 Codepresso가 다음을 자동 게시:

```markdown
### 🤖 Git Activity

**Commit:** `a1b2c3d` — Add token refresh middleware
**Time:** 2026-02-09T14:36:02Z
```

### 평일 Google Chat 북엔드 (월–금, 선택)

평일마다 설정된 Google Chat 스페이스로 `gws` CLI를 통해 본인 계정으로 두 개의 메시지를 전송합니다.

**아침 인사** — 평일 첫 Claude 세션에 자동 전송:
- 진행 중인 Notion 작업
- 내가 작성한 오픈 PR
- 리뷰 요청 받은 PR
- 🆕 마감 지난 / 오늘 마감 작업 (inbox 트래커 활성화 시)
- Claude Haiku가 생성한 응원 한 줄

**저녁 마감 요약** — 월–금 18:00 (세션 크론 `3 18 * * 1-5 /codepresso:daily-summary`):
- 오늘의 커밋 (`git log --author=<you> --since=midnight`)
- 오늘 머지된 PR (`gh search prs --author @me --merged-at <today>`)
- 오늘 닫힌(미머지) PR
- 아직 진행 중인 Notion 작업
- `claude -p --model haiku`로 생성한 2–4문장 한국어 요약 (`claude` CLI가 없으면 결정론적 템플릿으로 폴백)

활성화하려면 `codepresso:setup`을 실행하거나 `~/.codepresso/config.json`에 다음을 추가:

```json
{
  "googleChat": {
    "enabled": true,
    "dailyGreeting": true,
    "spaceId": "AAAAxxxxxxx"
  }
}
```

수동 실행: `codepresso:daily-chat` (아침) · `codepresso:daily-summary` (저녁) — 요일 상관없이 언제든 실행 가능합니다. 실제 전송 없이 저녁 메시지를 미리 보려면:

```bash
CODEPRESSO_DRY_RUN=1 node scripts/daily-chat-summary.mjs
```

**필수 조건**: `chat.messages.create` 스코프로 인증된 `gws` CLI. Haiku 품질의 저녁 요약을 원한다면 PATH 상의 `claude` CLI (선택 — 없으면 폴백).

### 배포 연동 (선택)

각 팀이 자체 배포 전략을 설정합니다. 배포는 **기본 비활성화**되어 있습니다.

활성화하려면 프로젝트의 `.codepresso.json`에 추가:

```json
{
  "deploy": {
    "enabled": true,
    "method": "ecs",
    "awsRegion": "ap-northeast-2",
    "ecsCluster": "my-cluster",
    "ecsService": "my-app"
  }
}
```

지원 방식:

| 방식 | 설명 | 설정 키 |
|------|------|---------|
| `ecs` | ECS 직접 배포 | `awsRegion`, `ecsCluster`, `ecsService` |
| `codepipeline` | AWS CodePipeline 트리거 | `awsRegion`, `pipelineName` |
| `workflow` | GitHub Actions 워크플로우 트리거 | `workflowFile` |
| `custom` | 커스텀 배포 명령어 실행 | `customCommand` |

이후 Claude Code에서 "staging에 배포해" 라고 말하면 됩니다.

**워크플로우 템플릿**은 `templates/workflows/`에 제공됩니다 — 프로젝트의 `.github/workflows/`로 복사하고 시크릿을 설정하세요.

---

## 스킬 목록

| 스킬 | 트리거 | 설명 |
|-------|---------|-------------|
| `codepresso:setup` | "codepresso 설정해줘", "setup codepresso" | 대화식 설정 마법사 |
| `codepresso:status` | "codepresso 상태" | 플러그인 상태 + 진단 |
| `codepresso:notion-sync` | "notion 동기화" | Notion DB 작업 조회/업데이트 |
| `codepresso:sprint-dashboard` | "스프린트 대시보드" | 스프린트 진행 개요 |
| `codepresso:sprint-retro` | "스프린트 회고" | 스프린트 회고 보고서 |
| `codepresso:generate-epic` | "에픽 생성" | 에픽 PRD 문서 생성 |
| `codepresso:daily-chat` | "아침 인사" | 아침 Google Chat 인사 수동 전송 |
| `codepresso:daily-summary` | "저녁 요약" | 저녁 Google Chat 마감 요약 (월–금 18시 크론 자동 실행도 됨) |
| 🆕 `codepresso:scan-inbox` | "받은편지함 훑어줘", "/codepresso:scan-inbox" | Gmail + Chat 스캔 → AI 분류 → 승인 picker → Notion 작업 생성 |
| `codepresso:deploy` | "배포" | 배포 트리거 (설정 필요) |
| `codepresso:oncall` | "이번주 온콜 누구?" | DynamoDB + Google Calendar에서 현재 온콜 조회 |
| `codepresso:oncall-generate` | "다음달 온콜 만들어줘" | Allocator Lambda 호출, 캘린더 동기화 |
| `codepresso:oncall-swap` | "온콜 바꿔줘" | 특정 주의 온콜 할당 교체 |
| `codepresso:oncall-sync-calendar` | "온콜 캘린더 동기화" | Google Calendar와 DynamoDB 재동기화 |
| `codepresso:oncall-seed-metadata` | "엔지니어 메타데이터 시드" | 배포 게이트 검증용 매핑 시드 |
| `codepresso:oncall-runbook` | "온콜 런북", "sev1 어떻게 처리?" | `docs/oncall-runbook.md` 섹션 조회 |
| 🆕 `codepresso:scaffolding-from-figma` | "이 figma 노드로 Vue scaffold 만들어줘", Figma URL + PAT 제공 | Figma PAT → REST API → 토큰 매핑 spec.md → designer-high agent → ~90% scaffold (퍼블리셔 1-2시간 마무리) |
| 🆕 `codepresso:llm-wiki` | "/codepresso:llm-wiki ...", "이거 내 위키에 넣어줘", "내 위키에 X 있어?", "위키 lint" | 개인 LLM Wiki(Obsidian + git) init/ingest/query/lint — 대화를 넘어 쌓이는 지식 베이스 |
| 🆕 `codepresso:security-audit` | "보안 점검해줘", "security audit", "취약점 진단", "/codepresso:security-audit" | OWASP Top 10:2025 + 최신 사고 기반 스캔(코드·인프라) → 개발자 머신 자격증명 점검(선택) → 인터뷰 → 점수 리포트. 기술 스택 무관 |

---

## Notion 연동

### 작업 선택기 + PR 자동 연결

세션 시작 시 Codepresso가 Notion DB에서 작업을 가져와 대화식 picker로 표시합니다. 작업을 선택하면:

1. Notion에서 작업 상태가 "진행 중"으로 변경
2. 작업의 unique ID (예: `TSK-9945`)가 로컬에 저장
3. PR 생성 시 훅이 ID를 제목에 강제: `TSK-9945 설명`
4. Notion의 GitHub 연동이 PR을 작업에 자동 연결

**요구사항**: Notion DB에 `unique_id` 속성(Notion 내장 기능)과 `status` 속성이 있어야 합니다.

### MCP 도구

Codepresso는 Notion용 MCP 서버를 포함합니다:

| 도구 | 설명 |
|------|-------------|
| `notion_query_db` | 필터/정렬로 DB 조회 |
| `notion_create_page` | DB에 페이지 생성 |
| `notion_update_page` | 페이지 속성 업데이트 |
| `notion_search` | 제목으로 페이지 검색 |
| `notion_get_users` | 워크스페이스 멤버 목록 |

활성화하려면 `codepresso:setup` 중에 Notion Internal Integration Token을 입력하세요.

---

## OMC 공존성

Codepresso는 oh-my-claudecode와 충돌 없이 함께 동작하도록 설계되었습니다:

| 관심사 | 설계 |
|---------|--------|
| 상태 파일 | 모두 `.codepresso/state/`에 `codepresso-*` 접두사로 저장 |
| 설정 | OMC: `~/.claude/.omc-config.json`, Codepresso: `~/.codepresso/config.json` |
| 훅 | SessionStart, PreToolUse, PostToolUse만 사용 — UserPromptSubmit 미사용 |

---

## 사전 요구사항

- Node.js >= 20
- `gh` CLI 설치 및 인증 (`gh auth login`)
- Notion API 키 (선택 — Notion 기능용)
- AWS CLI 설정 (선택 — 배포 기능용)
- `chat.messages.create` 스코프로 인증된 `gws` CLI (선택 — 평일 Google Chat 북엔드 + 받은편지함 스캔용)
- PATH 상의 `claude` CLI (선택 — Haiku 기반 저녁 요약용)
- Claude.ai Gmail 커넥터 OAuth 인증 (선택 — 받은편지함 스캔의 Gmail 측용)

---

## 디렉터리 구조

```
codepresso-plugin/
├── .claude-plugin/plugin.json     # 플러그인 매니페스트
├── hooks/hooks.json               # 3개 훅 선언 (SessionStart, PreToolUse, PostToolUse)
├── scripts/
│   ├── lib/
│   │   ├── stdin.mjs              # 타임아웃 보호 stdin 리더
│   │   ├── config.mjs             # 설정 로더 (전역 + 프로젝트별)
│   │   ├── git-utils.mjs          # 브랜치/PR 감지
│   │   ├── git-root.mjs           # 훅용 세션 gitRoot 리더
│   │   ├── logger.mjs             # 디버그 로거
│   │   ├── notion-tasks.mjs       # Notion 작업 + unique ID 추출
│   │   ├── sprint-context.mjs     # Sprint > Epic > Task 계층 fetcher
│   │   ├── status-transitions.mjs # 작업/에픽 상태 전이
│   │   ├── gws.mjs                # Google Chat / gws CLI 헬퍼 (sendChatMessage + fetchChatUnread)
│   │   ├── redactor.mjs           # 비밀 정보 마스킹 (받은편지함 스캔용)
│   │   └── inbox-state.mjs        # 받은편지함: seen-ID dedup, 후보 JSONL, 스키마 캐시, 게이팅 + 포매터
│   ├── session-start.mjs          # SessionStart: 브랜치/PR 감지 + Notion 작업 fetch + 아침 인사 spawn + 🆕 받은편지함 스캔 안내 주입
│   ├── pre-tool-notion-inject.mjs # PreToolUse: 작업 picker + PR 제목 강제
│   ├── post-tool-git-watcher.mjs  # PostToolUse:Bash: git commit 코멘트 + 머지 전이
│   ├── handle-merge-transition.mjs # 분리: PR 머지 → 작업 완료 → 에픽 cascade
│   ├── daily-chat-greeting.mjs    # 아침 Google Chat 인사 (분리) — 🆕 마감 지난/오늘 마감 섹션 포함
│   ├── daily-chat-summary.mjs     # 저녁 Google Chat 요약 (수동 또는 크론)
│   ├── inbox-cli.mjs              # 🆕 scan-inbox 스킬이 호출하는 CLI 디스패처
│   ├── security-audit-cli.mjs     # 🆕 보안 진단 하네스 (scan / scan-local / checklist / report)
│   └── lib/security-checklist.mjs # 🆕 OWASP 2025 + 최신 사고 기반 체크리스트 데이터 (12항목)
├── skills/
│   ├── setup/SKILL.md             # 설정 마법사 (받은편지함 스캔 활성화 단계 포함)
│   ├── status/SKILL.md            # 플러그인 진단
│   ├── notion-sync/SKILL.md       # Notion 작업 동기화
│   ├── sprint-dashboard/SKILL.md  # 스프린트 진행 개요
│   ├── sprint-retro/SKILL.md      # 스프린트 회고
│   ├── generate-epic/SKILL.md     # 에픽 PRD 생성
│   ├── daily-chat/SKILL.md        # 아침 Google Chat 인사 (수동)
│   ├── daily-summary/SKILL.md     # 저녁 Google Chat 요약 (수동 또는 월–금 18시 크론)
│   ├── scan-inbox/SKILL.md        # 🆕 받은편지함 스캔 절차
│   ├── security-audit/SKILL.md    # 🆕 OWASP 2025 보안 진단 절차 (scan → 인터뷰 → 리포트)
│   ├── deploy/SKILL.md            # 배포 트리거 (선택)
│   └── oncall*/SKILL.md           # 온콜 관리 스킬들
├── tests/lib/                     # 단위 테스트 (node:test + node:assert)
├── mcp/notion-server.mjs          # Notion MCP 서버
├── templates/workflows/           # GitHub Actions 배포 템플릿
├── .mcp.json                      # MCP 서버 선언
└── package.json
```

---

## 라이선스

MIT
