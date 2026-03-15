# FilesService 분해 계획 (v2 — 전문가 리뷰 반영)

**Goal:** `apps/lms-api/src/files/files.service.ts`(1,086줄)의 과도한 책임 집중을 해소한다. 업로드/저장소/OCR 연동/이벤트 처리/문제 적재/SSE 진행률을 역할별 provider로 분리하고, OCR 이벤트 소비·처리·적재는 별도 `IngestionModule`로 독립시킨다.

**Why now:** `FilesService`가 S3 multipart 업로드, 교재 PDF 병합, `source_file`/`ocr_job` 생성, Redis Pub/Sub + Streams 수신, OCR 완료 후 `problem`/`problem_asset` 생성, SSE 진행률 스트림까지 동시에 담당한다. 또한 Pub/Sub과 Streams를 동시에 구독하여 **같은 이벤트를 두 번 처리하는 활성 버그**가 있다. 이 상태에서는 Streams 마이그레이션, 업로드 정책 변경, OCR 적재 안정화 같은 후속 작업이 모두 같은 파일에 충돌한다.

**Architecture:** 외부 API와 DB schema는 유지한다. `FilesModule`에서 파일/업로드 책임만 남기고, OCR 이벤트 소비·처리·적재는 새로운 `IngestionModule`로 분리한다. `FilesService`를 얇은 facade로 축소한다. 즉시 마이크로서비스 분리는 하지 않는다.

**Tech Stack:** NestJS, Prisma, AWS SDK v3 (S3), Redis Pub/Sub + Streams, RxJS, PDF-Lib

---

## 1. 현재 상태 요약

`apps/lms-api/src/files/files.service.ts`는 다음 7가지 책임을 모두 가진다:

1. **인프라 client 수명주기** — S3Client, Redis publisher/subscriber, Streams consumer 생성·종료
2. **업로드 정책** — key 생성, scope 검증, PDF 유효성, 파일명 정규화
3. **저장소 작업** — multipart initiate/sign/complete/abort, presigned URL, S3 object 삭제
4. **교재 전처리** — 문제집+답지 PDF 병합
5. **OCR ingestion orchestration** — sourceFile/ocrJob 생성, 중복 업로드 처리, `ocr:submit`·`analysis:request` 발행
6. **OCR 결과 이벤트 처리** — Redis Pub/Sub + Streams 동시 수신, `ocr:completed`/`ocr:failed`/`analysis:completed`/`analysis:failed` 처리
7. **OCR 결과 materialization** — OCR payload를 `problem`/`problemChoice`/`problemAsset`로 적재

### 1-1. 활성 버그: 이벤트 이중 처리

`FilesService.onModuleInit()`에서 `redisSubscriber.on('message')` (Pub/Sub)와 `redisStream.onMessage()` (Streams) 양쪽에 같은 핸들러를 등록한다. `ocr:completed` 이벤트가 오면 `handleOcrPipelineEvent`가 **두 번 호출**된다. `createProblemsFromOcr`에 멱등성 가드가 없으므로 Problem 레코드가 중복 생성될 수 있다.

---

## 2. 목표와 비목표

### 목표

1. 공개 REST/SSE API를 바꾸지 않고 내부 책임만 분리한다.
2. `FilesService`를 facade로 축소한다 (150-250줄).
3. OCR 이벤트 소비·처리·적재를 `IngestionModule`로 독립시킨다.
4. Pub/Sub → Streams 전환을 완료하고 이중 처리 버그를 해소한다.
5. 이벤트 핸들러에 dedup 가드를 추가한다.
6. CI 파이프라인을 구축하여 리팩터링 안전성을 보장한다.
7. JwtModule 중복 등록을 해소한다.

### 비목표

1. DB schema 변경 (Problem 모델 분할 등)
2. `FilesController`/`FilesSseController` 라우트 변경
3. OCR API 쪽 event contract 변경
4. AppModule 도메인 그룹핑 (별도 후속 작업)

---

## 3. 최종 목표 구조

두 개의 모듈로 분리한다.

### `FilesModule` — 파일/저장소/업로드

```text
apps/lms-api/src/files/
├── files.module.ts
├── files.controller.ts
├── files-sse.controller.ts
├── files.service.ts                  # facade only (~130 LOC)
├── upload-policy.service.ts          # 업로드 정책, scope, validation
├── file-storage.service.ts           # S3, multipart, presigned URL, delete
├── pdf-bundle.service.ts             # PDF 병합
├── source-file-ingestion.service.ts  # sourceFile/ocrJob 생성, ocr:submit 발행
└── pipeline-progress.service.ts      # RxJS Subject SSE progress fan-out
```

### `IngestionModule` — OCR 이벤트 소비·처리·적재

```text
apps/lms-api/src/ingestion/
├── ingestion.module.ts
├── ocr-pipeline-event-consumer.service.ts  # Redis Streams 수신, lifecycle hooks
├── ocr-pipeline-event-handler.service.ts   # 이벤트 해석, 상태 전이, dedup
├── ocr-problem-materializer.service.ts     # problem/choice/asset 적재
└── ocr-problem-normalizer.ts               # payload normalization (co-located)
```

### `CommonModule` — 공유 인프라 (신규)

```text
apps/lms-api/src/common/
├── common.module.ts                  # RedisStreamService export
├── redis-stream.service.ts           # 기존 — Streams consumer
├── access-control.ts                 # 기존 — pure helpers
└── filename.ts                       # 기존
```

### `SharedAuthModule` — JWT 공유 (신규)

```text
apps/lms-api/src/auth/
├── shared-auth.module.ts             # @Global(), JwtModule.registerAsync() 1회
├── auth.module.ts                    # JwtModule 등록 제거
└── ...기존 파일 유지
```

---

## 4. 모듈간 import/export 관계

```text
AppModule
  imports: [SharedAuthModule, CommonModule, FilesModule, IngestionModule, ...]
  providers: []  ← RedisStreamService가 CommonModule로 이동

SharedAuthModule (@Global)
  imports: [JwtModule.registerAsync(...)]
  exports: [JwtModule]

CommonModule
  providers: [RedisStreamService]
  exports: [RedisStreamService]

FilesModule
  imports: [CommonModule]
  providers: [FilesService, UploadPolicyService, FileStorageService,
              PdfBundleService, SourceFileIngestionService, PipelineProgressService]
  exports: [FilesService, PipelineProgressService]

IngestionModule
  imports: [FilesModule, CommonModule]
  providers: [OcrPipelineEventConsumerService,
              OcrPipelineEventHandlerService,
              OcrProblemMaterializerService]
  exports: []
```

---

## 5. 의존 방향 규칙

```text
FilesController / FilesSseController
        ↓
    FilesService (facade)              PipelineProgressService ←──┐
        ↓                                                         │
 ┌──────┼──────────────┐                                          │
 ↓      ↓              ↓                                          │
Upload  FileStorage  SourceFileIngestion                          │
Policy                                                            │
                                                                  │
OcrPipelineEventConsumer (lifecycle owner)                        │
        ↓                                                         │
OcrPipelineEventHandler ──────────────────────────────────────────┘
        ↓
OcrProblemMaterializer
        ↓
      Prisma
```

규칙:
1. Consumer는 DB에 직접 접근하지 않는다.
2. Materializer는 Redis subscription 상태를 알지 않는다.
3. FileStorageService는 Prisma를 사용하되 asset 조회 + S3 URL 발급으로 제한한다.
4. Facade는 business rule을 갖지 않는다 (위임만).
5. `IngestionModule` → `FilesModule` 방향 (단방향). 역방향 의존 금지.
6. SSE controller는 `PipelineProgressService`를 직접 주입한다 (facade 우회 허용).

---

## 6. 이벤트 계약 명세

### 6-1. 이벤트 목록

| Event | Direction | Pub/Sub Channel | Stream | Idempotency Key | 비고 |
|-------|-----------|----------------|--------|-----------------|------|
| `ocr:submit` | NestJS→FastAPI | `ocr:submit` | `stream:ocr:submit` | `jobId` | FastAPI에서 duplicate guard 있음 |
| `ocr:completed` | FastAPI→NestJS | `ocr:completed` | `stream:ocr:completed` | `ocrJobId` | **CRITICAL: NestJS에 dedup 필요** |
| `ocr:failed` | FastAPI→NestJS | `ocr:failed` | `stream:ocr:failed` | `ocrJobId` | 멱등 (같은 status 쓰기) |
| `analysis:request` | NestJS→FastAPI | `analysis:request` | `stream:analysis:request` | `ocrJobId` | FastAPI finalize에 NX guard 있음 |
| `analysis:completed` | FastAPI→NestJS | `analysis:completed` | `stream:analysis:completed` | `ocrJobId` | 조건부 write 필요 |
| `analysis:failed` | FastAPI→NestJS | `analysis:failed` | `stream:analysis:failed` | `ocrJobId` | 멱등 |
| `pipeline:progress` | FastAPI→NestJS | `pipeline:progress` | *(없음)* | N/A | Pub/Sub only (영구). Fire-and-forget SSE용 |

### 6-2. `ocr:completed` Payload 구조

```typescript
interface OcrCompletedPayload {
  ocrJobId: string;
  problemCount: number;
  problems: Array<{
    problemNumber: string | null;
    displayNumber: string | null;
    problemType: 'multiple_choice' | 'short_answer' | 'written_solution' | 'essay';
    startPage: number;
    endPage: number;
    stemLatex: string;
    stemText: string;
    pageImageS3Key: string | null;
    problemImageS3Key: string | null;
    gradeLevel?: string;
    subject?: string;
    unitMajor?: string;
    unitMinor?: string;
    unitSub?: string;
    difficulty?: number;
    classificationConfidence?: number;
    bookSource?: Record<string, unknown>;
    examSource?: Record<string, unknown>;
    answerMatchStatus?: string;
    solutionLatex?: string;
    solutionText?: string;
    answerText?: string;
    choices?: Array<{
      position: number;
      label: string;
      contentLatex: string;
      contentText: string;
    }>;
  }>;
}
```

> **Note:** `packages/shared-types/src/index.ts`의 `OcrCompletedPayload`에 `problems` 배열이 누락되어 있다. 이 분해 과정에서 수정한다.

---

## 7. Problem 테이블 컬럼 소유권 맵

| 소유자 | 컬럼 (대표) | 쓰기 시점 |
|--------|------------|-----------|
| **NestJS Materializer** (20개) | id, ocrJobId, sourceFileId, startPage, endPage, problemNumber, displayNumber, stemLatex, stemText, problemType, gradeLevel, difficulty, bookSource, answerMatchStatus, solutionLatex, solutionText, answerText, reviewStatus(=pending_review), analysisStatus(=pending) | `ocr:completed` 수신 시 |
| **FastAPI Analysis** (23개) | classification2015, classification2022, curriculumNodeId, difficultyRefined, isCommon, subject*, unitMajor*, unitMinor*, unitSub*, classificationConfidence*, solutionTags, solutionStrategy, requiredConcepts, solutionSteps, estimatedTimeSec, commonMistakes, solutionConfidence, reviewConfidence, positionType, pointValue, questionFormat, embedding, analysisStatus(→completed), analyzedAt | AI 분석 파이프라인 중 |
| **NestJS Review UI** (5개) | reviewStatus(→approved/rejected), reviewedBy, flagReason, retiredAt, retiredBy | 교사 리뷰 시 |

`*` = OCR에서 초기값 설정 후 FastAPI가 GPT 결과로 덮어씀 (의도적)

### 충돌 방지 규칙

- `analysis:completed` 핸들러에서 `analysisStatus` 업데이트 시 조건부 write:
  ```sql
  WHERE id IN (...) AND analysis_status != 'completed'
  ```
- Materializer는 분석 전용 컬럼(classification2015 등)을 절대 쓰지 않는다.
- FastAPI는 OCR 추출 전용 컬럼(stemLatex, stemText 등)을 덮어쓰지 않는다.

---

## 8. 단계별 구현 계획

### Phase -1. CI 파이프라인 구축

**목적:** 리팩터링 안전망을 확보한다.

**작업:**
- `.github/workflows/ci.yml` 생성 (lint, test, build)
- `turbo.json`에 `test` task 추가 (`"dependsOn": ["^build"]`)

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @jsmath/db-schema db:generate
      - run: pnpm lint
      - run: pnpm test

  build:
    runs-on: ubuntu-latest
    needs: lint-and-test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @jsmath/db-schema db:generate
      - run: pnpm build
```

**완료 기준:** PR에서 CI가 자동 실행됨, main merge 전 필수 통과

---

### Phase 0. SharedAuthModule + Baseline 확보

**목적:** JwtModule 중복 제거 + 리팩터링 전 동작을 고정한다.

**작업 A — SharedAuthModule (Phase 0.5):**
- `apps/lms-api/src/auth/shared-auth.module.ts` 생성 (`@Global()`, `JwtModule.registerAsync()`)
- `AuthModule`, `ClassMonitorModule`, `IntegrationsModule`에서 `JwtModule.registerAsync()` 제거
- `AppModule`에 `SharedAuthModule` 추가

```typescript
// apps/lms-api/src/auth/shared-auth.module.ts
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
  exports: [JwtModule],
})
export class SharedAuthModule {}
```

**작업 B — Characterization Tests:**

S3, Redis를 모듈 레벨 mock으로 처리하고 다음 7개 시나리오를 커버한다:

| # | 시나리오 | 핵심 assertion |
|---|---------|---------------|
| 1 | multipart initiate/complete 성공 | key format, partCount 계산, S3 HeadObject 검증 |
| 2 | textbook register 흐름 | sourceFile.create 호출, ocrJob 생성, `ocr:submit` publish에 answerS3Key 포함 |
| 3 | duplicate upload 처리 | sourceFile.create 미호출, 기존 레코드 반환 |
| 4 | `ocr:completed` → problem 생성 | problem.create 호출 횟수, problemAsset 생성, autoAnalyze 시 `analysis:request` publish |
| 5 | `analysis:completed` → status 갱신 | problem.updateMany 호출, analysisStatus='completed' |
| 6 | asset URL 권한 확인 | teacher scope where절, admin은 무조건 허용, 없는 asset → NotFoundException |
| 7 | source file 삭제 cascade | 삭제 순서: asset→choice→problem→ocrJob→sourceFile, S3 delete 호출 |

**추가 테스트 — 이중 처리 버그 문서화:**

```typescript
it('proves dual Pub/Sub+Streams delivery calls handler twice', () => {
  const handleSpy = jest.spyOn(service as any, 'handleOcrPipelineEvent');
  // Pub/Sub path
  pubsubHandler('ocr:completed', payload);
  // Streams path
  streamHandler('ocr:completed', payload);
  expect(handleSpy).toHaveBeenCalledTimes(2); // documents the bug
});
```

**산출물:**
- `apps/lms-api/src/auth/shared-auth.module.ts`
- `apps/lms-api/src/files/files.service.spec.ts`

**완료 기준:** CI 통과, 기존 구현 기준에서 모든 테스트 통과

---

### Phase 1. 순수 정책/헬퍼 추출

**목적:** 부작용 없는 로직부터 안전하게 분리한다.

**작업:**
- `UploadPolicyService` 생성 — `isPdfUpload`, `buildMultipartUploadKey`, `assertScopedUploadKey`, `buildTextbookBundleFilename`, scope-where 헬퍼
- `PdfBundleService` 생성 — `mergePdfBuffers`
- scope-where 메서드는 `common/access-control.ts`의 기존 함수를 재사용 (중복 제거)

**변경 파일:**
- Create: `upload-policy.service.ts`, `pdf-bundle.service.ts`
- Modify: `files.service.ts`, `files.module.ts`

**완료 기준:** `FilesService`에서 순수 private helper가 거의 사라짐, 기존 테스트 통과

---

### Phase 2. 저장소 계층 추출

**목적:** S3/multipart 책임을 독립시킨다.

**작업:**
- `FileStorageService` 생성
- S3 client 생성, multipart 메서드, presigned URL, delete batch 이동
- Prisma 의존 허용 (asset 권한 조회 + S3 URL 발급이 합쳐진 `getAssetUrl`)

**변경 파일:**
- Create: `file-storage.service.ts`
- Modify: `files.service.ts`, `files.module.ts`

**완료 기준:** `FilesService`에서 `@aws-sdk/client-s3` import 제거

---

### Phase 3. Ingestion Orchestration 추출

**목적:** 업로드 완료 후 DB 생성 및 OCR submit 흐름을 분리한다.

**작업:**
- `SourceFileIngestionService` 생성
- exam/textbook 등록, 중복 업로드 처리, `ocr:submit` / `analysis:request` 발행 이동
- Redis publisher는 이 서비스가 직접 생성 (기존 패턴과 동일)

**변경 파일:**
- Create: `source-file-ingestion.service.ts`
- Modify: `files.service.ts`, `files.module.ts`

**주의:** Phase 5와 **절대 동시 배포하지 않는다.** 실패 시 이 커밋만 revert하면 Phase 1-2는 보존됨.

**완료 기준:** sourceFile/ocrJob 생성 로직이 단일 provider에 모임

---

### Phase 4. Progress Stream 분리

**목적:** SSE와 event handler 결합을 끊는다.

**작업:**
- `PipelineProgressService` 생성 — RxJS Subject 이동
- `FilesSseController`가 `PipelineProgressService`를 직접 주입
- `FilesModule`에서 `PipelineProgressService`를 export

```typescript
// files-sse.controller.ts (after)
constructor(
  private readonly filesService: FilesService,       // auth check
  private readonly progress: PipelineProgressService, // SSE observable
) {}
```

**변경 파일:**
- Create: `pipeline-progress.service.ts`
- Modify: `files.service.ts`, `files-sse.controller.ts`, `files.module.ts`

**완료 기준:** `FilesService`가 RxJS Subject를 직접 가지지 않음

---

### Phase 5. CommonModule 생성 + Event Consumer/Handler 분리

**목적:** lifecycle hook과 event 처리를 `FilesService`에서 제거하고, Pub/Sub → Streams 전환을 완료한다.

**작업 A — CommonModule:**
- `apps/lms-api/src/common/common.module.ts` 생성
- `RedisStreamService`를 `AppModule.providers`에서 `CommonModule`로 이동
- `AppModule`에 `CommonModule` import 추가

**작업 B — Consumer/Handler 생성 (아직 FilesModule 내):**
- `OcrPipelineEventConsumerService` — `onModuleInit`/`onModuleDestroy` 이동, Streams + Pub/Sub 구독
- `OcrPipelineEventHandlerService` — `handleOcrPipelineEvent` 이동, dedup 가드 추가

**작업 C — Dedup 가드:**

```typescript
// OcrPipelineEventHandlerService
private recentlyHandled = new Map<string, number>();

async handle(channel: string, message: string) {
  const payload = JSON.parse(message);
  const key = `${channel}:${payload.ocrJobId ?? ''}`;
  const now = Date.now();
  if (this.recentlyHandled.has(key) && now - this.recentlyHandled.get(key)! < 30_000) return;
  this.recentlyHandled.set(key, now);
  // stale entry cleanup
  for (const [k, ts] of this.recentlyHandled) {
    if (now - ts > 30_000) this.recentlyHandled.delete(k);
  }
  // ... dispatch to handler methods
}
```

**작업 D — Pub/Sub → Streams 전환:**

1. Dedup 가드 추가 후 관찰 (dedup 히트 로그 확인)
2. durable 이벤트(ocr:completed, ocr:failed, analysis:completed, analysis:failed)의 Pub/Sub 구독 제거
3. `pipeline:progress`만 Pub/Sub에 유지 (fire-and-forget SSE용, 영구)
4. `analysis:completed` 핸들러에 조건부 write 추가:
   ```typescript
   await this.prisma.problem.updateMany({
     where: { id: { in: ids }, analysisStatus: { not: 'completed' } },
     data: { analysisStatus: 'completed', analyzedAt: new Date() },
   });
   ```

**변경 파일:**
- Create: `common/common.module.ts`, `ocr-pipeline-event-consumer.service.ts`, `ocr-pipeline-event-handler.service.ts`
- Modify: `files.service.ts`, `files.module.ts`, `app.module.ts`

**완료 기준:**
- `FilesService`가 `OnModuleInit`, `OnModuleDestroy`를 구현하지 않음
- durable 이벤트는 Streams만 사용, Pub/Sub 구독 제거됨
- dedup 가드 동작 확인

---

### Phase 6. IngestionModule 생성 + Materializer 분리

**목적:** OCR payload → problem row 적재를 독립 모듈로 이동한다.

**작업 A — OcrProblemMaterializerService 생성:**
- `createProblemsFromOcr` 이동
- `ocr-problem-normalizer.ts` 함께 이동 (co-located)
- 조악한 멱등성 가드 추가 (스키마 변경 없이):

```typescript
async materialize(ocrJobId: string, sourceFileId: string, problems: RawPayload[]) {
  const existing = await this.prisma.problem.count({ where: { ocrJobId } });
  if (existing > 0) {
    this.logger.warn(`Problems already exist for job ${ocrJobId}, skipping`);
    return [];
  }
  // ... 기존 루프 로직 (per-problem try/catch 유지)
}
```

**작업 B — IngestionModule 생성:**
- `apps/lms-api/src/ingestion/` 디렉토리 생성
- `OcrProblemMaterializerService` + `ocr-problem-normalizer.ts` 이동
- `ingestion.module.ts` 생성 (`imports: [CommonModule]`)

**변경 파일:**
- Create: `ingestion/ingestion.module.ts`, `ingestion/ocr-problem-materializer.service.ts`, `ingestion/ocr-problem-normalizer.ts`
- Modify: `files.module.ts`, `app.module.ts`

**완료 기준:** `FilesService`에서 `problem.create`, `problemChoice.create`, `problemAsset.create` 직접 호출 제거

---

### Phase 7. Consumer/Handler → IngestionModule 이동

**목적:** OCR 이벤트 소비·처리 전체를 IngestionModule로 이동한다.

**작업:**
- `OcrPipelineEventConsumerService`, `OcrPipelineEventHandlerService`를 `ingestion/`으로 이동
- `FilesModule`에서 이 두 provider 제거
- `IngestionModule`에 `FilesModule` import 추가 (PipelineProgressService 사용 위해)

**변경 파일:**
- Move: consumer + handler → `ingestion/`
- Modify: `files.module.ts`, `ingestion/ingestion.module.ts`, `app.module.ts`

**완료 기준:**
- `FilesModule`은 파일/업로드 관련 provider만 보유
- `IngestionModule`은 consumer, handler, materializer 보유
- 기존 테스트 전부 통과

---

### Phase 8. Facade 정리

**목적:** `FilesService`를 얇은 위임 계층으로 최종 정리한다.

**작업:**
- 남은 orchestration 정리
- private helper 제거
- 사용하지 않는 import 제거

**Facade 최종 형태 (~130 LOC):**

```typescript
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadPolicy: UploadPolicyService,
    private readonly storage: FileStorageService,
    private readonly pdfBundle: PdfBundleService,
    private readonly ingestion: SourceFileIngestionService,
    private readonly progress: PipelineProgressService,
  ) {}

  // Upload/multipart — delegate to storage
  createMultipartUpload(...) { return this.storage.createMultipartUpload(...); }
  getMultipartUploadUrls(...) { return this.storage.getMultipartUploadUrls(...); }
  completeMultipartUpload(...) { return this.storage.completeMultipartUpload(...); }
  abortMultipartUpload(...) { return this.storage.abortMultipartUpload(...); }

  // PDF upload/register — delegate to ingestion
  uploadPdf(...) { return this.ingestion.uploadPdf(...); }
  uploadTextbookPdf(...) { return this.ingestion.uploadTextbookPdf(...); }
  registerUploadedPdf(...) { return this.ingestion.registerUploadedPdf(...); }
  registerUploadedTextbook(...) { return this.ingestion.registerUploadedTextbook(...); }

  // Query — simple Prisma queries stay here
  async listFiles(requesterId, requesterRole) { /* ... */ }
  getAssetUrl(...) { return this.storage.getAssetUrl(...); }
  getStatus(...) { return this.ingestion.getStatus(...); }
  deleteFile(...) { return this.ingestion.deleteFile(...); }
  assertCanAccessOcrJob(...) { return this.ingestion.assertCanAccessOcrJob(...); }

  // SSE
  getProgressStream() { return this.progress.getProgressStream(); }
}
```

**완료 기준:**
- `FilesService` 150-250줄
- lifecycle hook 없음
- S3/Redis/event 관련 코드 없음

---

## 9. 테스트 계획

### 단위 테스트 (per-phase)

| Phase | 테스트 대상 | 핵심 검증 |
|-------|-----------|-----------|
| 0 | `FilesService` (characterization) | 7개 시나리오 + 이중 처리 버그 문서화 |
| 1 | `UploadPolicyService`, `PdfBundleService` | key scope validation, PDF 매직바이트, 파일명 정규화 |
| 2 | `FileStorageService` | multipart lifecycle, presigned URL, S3 delete batch |
| 3 | `SourceFileIngestionService` | register flow, duplicate detection, Redis publish |
| 4 | `PipelineProgressService` | observable subscription, event emit |
| 5 | `OcrPipelineEventHandler` | dedup 가드, 상태 전이, 조건부 write |
| 6 | `OcrProblemMaterializer` | payload normalization, 멱등성 가드, per-problem error handling |

### 회귀 테스트 (절대 불변)

1. 기존 REST route path
2. response payload shape
3. autoAnalyze 기본값
4. teacher/admin 접근 제한
5. source file 삭제 시 cascade 순서

### Per-Phase CI 게이트

| Phase | 자동 검증 |
|-------|---------|
| 모든 phase | `pnpm test` + `pnpm build` 통과 |
| Phase 2 완료 | `files.service.ts`에서 `@aws-sdk` import 없음 (grep) |
| Phase 5 완료 | `files.service.ts`에서 `OnModuleInit` 없음 (grep) |
| Phase 8 완료 | `files.service.ts` 250줄 이하 (wc -l) |

---

## 10. 리스크와 대응

### Risk 1. 이벤트 이중 처리 (CRITICAL — 활성 버그)

- **문제:** Pub/Sub + Streams 동시 수신으로 `handleOcrPipelineEvent`가 2회 호출, Problem 중복 생성 가능
- **대응:** Phase 5에서 dedup 가드 추가 + Pub/Sub 구독 제거로 근본 해소
- **타이밍:** Phase 5를 가능한 빨리 실행

### Risk 2. 문제 중복 생성

- **문제:** `ocr:completed` 재처리 시 Problem duplicate insert
- **대응:** Phase 6 materializer에 조악한 멱등성 가드 (`problem.count > 0` 체크)
- **후속:** 별도 작업으로 `@@unique([ocrJobId, problemNumber])` 제약 + upsert 전환

### Risk 3. Phase 3+5 동시 배포

- **문제:** ingestion submission과 event consumption이 동시에 변경되면 실패 원인 식별 불가
- **대응:** Phase 3과 Phase 5는 **별도 PR, 별도 배포**. 최소 1일 간격.

### Risk 4. Facade가 두꺼운 상태로 남음

- **대응:** 각 phase 종료 시 `FilesService` 줄 수 체크, Phase 8에서 250줄 이하 CI 게이트

### Risk 5. Dual-writer 컬럼 충돌

- **문제:** NestJS materializer와 FastAPI analysis가 같은 컬럼 쓰기
- **대응:** Section 7 컬럼 소유권 맵 준수, `analysis:completed` 핸들러에 조건부 write
- **후속:** Problem 모델을 ProblemContent/ProblemAnalysis/ProblemReviewState로 분할 (별도 작업)

### Risk 6. Redis 장애 시 서비스 기동 실패

- **대응:** `OcrPipelineEventConsumerService.onModuleInit()`에서 ioredis `retryStrategy` 설정 (최대 3회, 200ms 간격). 연결 실패 시 throw → NestJS 프로세스 종료 → orchestrator restart.

---

## 11. 완료 기준

다음 조건을 모두 만족하면 완료:

1. `FilesService`는 facade 역할만 한다 (150-250줄)
2. `IngestionModule`이 consumer, handler, materializer를 보유한다
3. `FilesModule`은 파일/업로드/SSE만 담당한다
4. `CommonModule`이 `RedisStreamService`를 export한다
5. `SharedAuthModule`이 JwtModule을 1회 등록한다
6. durable 이벤트는 Streams만 사용한다 (Pub/Sub 구독 제거)
7. dedup 가드가 동작한다
8. materializer에 멱등성 가드가 있다
9. 기존 API route와 payload가 그대로 유지된다
10. characterization + unit + CI 테스트가 전부 통과한다

---

## 12. 후속 작업

이 계획이 끝난 뒤 이어갈 수 있는 작업:

1. **Materializer 고급 멱등성**: `@@unique([ocrJobId, problemNumber])` 스키마 제약 + `prisma.problem.upsert()` 전환
2. **FastAPI Pub/Sub 제거**: `publish_dual()` → `publish_stream()` 전환 (NestJS 쪽 Pub/Sub 제거 후)
3. **Problem 모델 분할**: `ProblemContent` / `ProblemAnalysis` / `ProblemReviewState` 테이블 분리
4. **shared-types 동기화**: `OcrCompletedPayload`에 `problems` 배열 추가, web 앱에서 shared-types 사용 시작
5. **AppModule 도메인 그룹핑**: 디렉토리 재구성 (problem-bank/, assessment/, learning/, analytics/ 등)
6. **access-control.ts → AccessControlService**: async DB 함수를 `@Injectable()` 서비스로 전환
7. **프론트엔드 feature 모듈화**: 대형 페이지(review, upload, exam-builder) 분할
8. **OCR 워커 분할**: `segment_textbook.py`(1,285줄), `unified_analysis.py`(686줄) 분할

---

## 13. 권장 구현 순서 요약

```
Phase -1  CI 구축                       ← 모든 작업의 전제 조건
Phase 0   SharedAuthModule + 테스트     ← 안전망 확보
Phase 1   UploadPolicy + PdfBundle     ← 순수 헬퍼, 저위험
Phase 2   FileStorage                   ← S3 분리
Phase 3   SourceFileIngestion           ← OCR submit 분리 (배포 후 안정화)
Phase 4   PipelineProgress              ← SSE 분리
Phase 5   CommonModule + Consumer/Handler + Streams 전환  ← 핵심 (이중 처리 버그 해소)
Phase 6   IngestionModule + Materializer ← 모듈 독립
Phase 7   Consumer/Handler 이동          ← IngestionModule 완성
Phase 8   Facade 정리                    ← 마무리
```

이 순서를 지키면:
- behavior를 거의 바꾸지 않으면서 구조만 단계적으로 정리할 수 있다
- 각 phase는 독립 PR로 만들 수 있고, 중간에 멈춰도 이전 phase의 개선은 유지된다
- Phase 5에서 활성 버그(이중 처리)가 해소된다
- Phase 7에서 모듈 경계가 확립된다
