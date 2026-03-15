# JSMath 성능 + 기능 개선 로드맵

> 작성일: 2026-03-08
> 상태: 계획 (미착수)

---

## 목차

1. [현재 상태 평가](#1-현재-상태-평가)
2. [Phase 1: 즉시 개선 (1-2주)](#2-phase-1-즉시-개선-1-2주)
3. [Phase 2: 검색 고도화 (3-4주)](#3-phase-2-검색-고도화-3-4주)
4. [Phase 3: 안정화 (1-2개월)](#4-phase-3-안정화-1-2개월)
5. [Phase 4: 확장 (2-3개월)](#5-phase-4-확장-2-3개월)
6. [기술 스택 비교 매트릭스](#6-기술-스택-비교-매트릭스)
7. [유사 문제 검색 강화](#7-유사-문제-검색-강화-pgvector)
8. [Elasticsearch 통합 계획](#8-elasticsearch-통합-계획)
9. [불필요한 것 (하지 않아도 됨)](#9-불필요한-것)

---

## 1. 현재 상태 평가

### 검색 구현 현황

| 기능 | 상태 | 구현 방식 |
|------|------|-----------|
| 텍스트 검색 | ✅ 활성 | `ILIKE` on `stemText` (느림, 인덱스 미사용) |
| 벡터 유사도 검색 | ✅ 구현됨 | pgvector + HNSW (text-embedding-3-small, 1536차원) |
| 전문검색 (tsvector) | 🔄 스키마만 | `stem_tsv` TSVECTOR + GIN 인덱스 정의됨, 미사용 |
| Elasticsearch | ❌ 없음 | 미통합 |
| 필터링 | ✅ 활성 | 학년, 과목, 단원, 난이도, 유형, 검수상태 |
| 수학 검색 | ❌ 제한적 | LaTeX 직접 검색 불가, 임베딩 시맨틱만 |
| 페이지네이션 | ✅ 활성 | Offset 기반 (cursor 미사용) |

### 유사 문제 검색 현황

| 항목 | 현재 값 |
|------|---------|
| 임베딩 모델 | `text-embedding-3-small` (1536차원) |
| 인덱스 | HNSW (`m=16`, `ef_construction=64`, `vector_cosine_ops`) |
| 검색 방식 | 순수 벡터 코사인 유사도 (`<=>`) |
| Top-K | 10, 최소 임계값 0.5 |
| 결과 저장 | `problem_similarities` 테이블 (upsert) |
| 검색 API | **없음** — 내부 파이프라인 전용, 프론트엔드 미노출 |
| 리랭킹 | 없음 |

### 식별된 병목 포인트

**검색 성능:**
- `ILIKE` 검색은 full table scan — 문제 수 10만 이상 시 심각한 지연
- 한국어 형태소 분석 없음 ("이차방정식" ≠ "이차 방정식")
- LaTeX 수식 검색 불가 (`\frac{1}{2}` 검색 불가능)
- 수학 기호/표기법 변형 처리 없음

**인프라:**
- HTTP 압축 미적용 (NestJS, Next.js 모두)
- 응답 캐싱 헤더 미설정 (ETag, Cache-Control 없음)
- Redis가 Pub/Sub만 사용, 데이터 캐싱 미활용
- Offset 기반 페이지네이션 → 대규모 데이터에서 성능 저하
- Prisma connection pool 기본값 (명시적 설정 없음)

**파이프라인:**
- Redis Pub/Sub 메시지 유실 가능 (FastAPI 다운 시)
- 이벤트 멱등성 키 없음 → 중복 처리 가능
- 분석 파이프라인 부분 실패 시 롤백 메커니즘 없음

---

## 2. Phase 1: 즉시 개선 (1-2주)

### 2.1 HTTP 압축 추가
```typescript
// apps/lms-api/src/main.ts
import compression from 'compression';
app.use(compression());
```
- 예상 효과: API 응답 크기 60-80% 감소

### 2.2 Redis 캐싱 레이어
```typescript
@Module({
  imports: [
    CacheModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        store: redisStore,
        host: config.get('REDIS_HOST'),
        ttl: 300, // 5분
      }),
    }),
  ],
})
```

캐싱 대상:
- 문제 목록 (필터 조합별, TTL: 5분)
- 대시보드 통계 (getStats, TTL: 1분)
- 태그 사전 (tag_dictionary, TTL: 1시간)
- 교과서 목록 (textbooks, TTL: 1시간)

### 2.3 응답 캐싱 헤더
```typescript
@Get('problems')
@Header('Cache-Control', 'private, max-age=60')
async findAll() { ... }

@Get('tags')
@Header('Cache-Control', 'public, max-age=3600')
async findAllTags() { ... }
```

### 2.4 React Query staleTime 최적화
```typescript
const { data } = useQuery({
  queryKey: ['problems', filters],
  staleTime: 5 * 60 * 1000, // 5분 (현재 1분)
});
const { data: tags } = useQuery({
  queryKey: ['tags'],
  staleTime: 30 * 60 * 1000, // 30분
});
```

### 2.5 tsvector 활성화 (기존 GIN 인덱스 활용)
```sql
UPDATE problems SET stem_tsv = to_tsvector('simple', COALESCE(stem_text, ''));

CREATE FUNCTION update_stem_tsv() RETURNS trigger AS $$
BEGIN
  NEW.stem_tsv := to_tsvector('simple', COALESCE(NEW.stem_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stem_tsv_update BEFORE INSERT OR UPDATE ON problems
  FOR EACH ROW EXECUTE FUNCTION update_stem_tsv();
```

### 2.6 ef_search 즉시 튜닝 (코드 1줄)
```python
# find_similar.py에서 쿼리 실행 전
await session.execute(text("SET LOCAL hnsw.ef_search = 100"))
```
- 현재: 기본값 40 → 100으로 변경
- 효과: recall +5-10%

---

## 3. Phase 2: 검색 고도화 (3-4주)

### 3.1 하이브리드 검색 (tsvector + pgvector + RRF)

순수 벡터 검색 ~62% 정밀도 → 하이브리드 + RRF로 ~84%까지 향상 가능.

```python
HYBRID_SEARCH_QUERY = text("""
WITH fulltext AS (
    SELECT id,
        ROW_NUMBER() OVER (
            ORDER BY ts_rank(stem_tsv, plainto_tsquery('simple', :query_text)) DESC
        ) AS rank
    FROM ocr.problems
    WHERE stem_tsv @@ plainto_tsquery('simple', :query_text)
      AND embedding IS NOT NULL
      {metadata_filter}
    LIMIT :candidate_limit
),
semantic AS (
    SELECT id,
        ROW_NUMBER() OVER (
            ORDER BY embedding <=> CAST(:query_embedding AS vector)
        ) AS rank
    FROM ocr.problems
    WHERE embedding IS NOT NULL
      {metadata_filter}
    ORDER BY embedding <=> CAST(:query_embedding AS vector)
    LIMIT :candidate_limit
)
SELECT COALESCE(f.id, s.id) AS id,
    COALESCE(:w_fulltext / (60.0 + f.rank), 0.0) +
    COALESCE(:w_semantic / (60.0 + s.rank), 0.0) AS rrf_score
FROM fulltext f
FULL OUTER JOIN semantic s ON f.id = s.id
ORDER BY rrf_score DESC
LIMIT :top_k
""")
```

- 가중치 추천: 키워드 0.4 / 시맨틱 0.6 (수학 도메인)

### 3.2 메타데이터 필터 + pgvector 0.8 Iterative Scan

```python
FILTERED_SIMILARITY_QUERY = text("""
    SELECT id, 1 - (embedding <=> CAST(:query_embedding AS vector)) AS score
    FROM ocr.problems
    WHERE id != :problem_id
      AND embedding IS NOT NULL
      AND (:subject IS NULL OR subject = :subject)
      AND (:grade_level IS NULL OR grade_level = :grade_level)
      AND (:unit_major IS NULL OR unit_major = :unit_major)
    ORDER BY embedding <=> CAST(:query_embedding AS vector)
    LIMIT :top_k
""")

# pgvector 0.8 iterative scan 활성화
ENABLE_ITERATIVE_SCAN = text("""
    SET LOCAL hnsw.iterative_scan = relaxed_order;
    SET LOCAL hnsw.max_scan_tuples = 20000;
""")
```

pgvector 0.8 업그레이드:
```yaml
postgres:
  image: pgvector/pgvector:0.8.0-pg16
```

### 3.3 검색 엔진 도입 (규모에 따라 선택)

- **10만 문제 미만:** Meilisearch (간단, 빠른 도입, 한국어 CJK 기본 지원)
- **10만 문제 이상:** Elasticsearch (Nori 한국어 형태소, aggregations, 수학 동의어)

Application-level 동기화 (Phase 1):
```typescript
async createProblem(data: CreateProblemDto) {
  const problem = await this.prisma.problem.create({ data });
  await this.searchService.indexProblem(problem);
  return problem;
}
```

### 3.4 유사 문제 검색 API 노출

현재 내부 파이프라인 전용 → 교사/학생에게 API 제공.

### 3.5 Faceted Search UI + 검색어 자동완성

Elasticsearch aggregations 기반:
```json
{
  "query": { "match": { "stemText": "이차방정식" } },
  "aggs": {
    "by_subject": { "terms": { "field": "subject" } },
    "by_difficulty": { "terms": { "field": "difficulty" } },
    "by_grade": { "terms": { "field": "gradeLevel" } }
  }
}
```

---

## 4. Phase 3: 안정화 (1-2개월)

### 4.1 Cross-Encoder 리랭킹

2단계 검색: Bi-encoder 50개 후보 검색 → Cross-encoder 리랭킹 → Top-10 정밀도 +30-48% 향상.

모델: `BAAI/bge-reranker-v2-m3` (다국어, 오픈소스)

```python
from sentence_transformers import CrossEncoder

_reranker: CrossEncoder | None = None

def get_reranker() -> CrossEncoder:
    global _reranker
    if _reranker is None:
        _reranker = CrossEncoder("BAAI/bge-reranker-v2-m3", max_length=512, device="cpu")
    return _reranker

async def rerank_problems(query_text: str, candidates: list[dict], top_k: int = 10):
    reranker = get_reranker()
    pairs = [(query_text, c["stem_text"]) for c in candidates]
    scores = reranker.predict(pairs)
    for candidate, score in zip(candidates, scores):
        candidate["rerank_score"] = float(score)
    candidates.sort(key=lambda x: x["rerank_score"], reverse=True)
    return candidates[:top_k]
```

리소스: CPU에서 50 후보 리랭킹 ~100-200ms.

### 4.2 Cursor 기반 페이지네이션

```typescript
async findAll(query: ProblemSearchDto) {
  const { cursor, limit = 20 } = query;
  const problems = await this.prisma.problem.findMany({
    take: limit + 1,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { createdAt: 'desc' },
  });
  const hasMore = problems.length > limit;
  const items = hasMore ? problems.slice(0, -1) : problems;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
```

### 4.3 Redis Streams 전환 (Pub/Sub 대체)

메시지 유실 방지 + 멱등성 보장:
```typescript
await redis.xadd('ocr:events', '*', {
  type: 'submit',
  jobId: job.id,
  idempotencyKey: `ocr:submit:${job.id}`,
  payload: JSON.stringify(data),
});

// Consumer Group
await redis.xreadgroup('GROUP', 'ocr-workers', 'worker-1',
  'COUNT', 10, 'BLOCK', 5000, 'STREAMS', 'ocr:events', '>');
```

### 4.4 Materialized View for Stats

```sql
CREATE MATERIALIZED VIEW problem_stats AS
SELECT
  grade_level, subject, unit_major, difficulty, review_status,
  COUNT(*) as problem_count,
  AVG(difficulty_refined) as avg_difficulty,
  AVG(classification_confidence) as avg_confidence
FROM problems
GROUP BY grade_level, subject, unit_major, difficulty, review_status;

CREATE INDEX ON problem_stats (grade_level, subject);

-- pg_cron으로 5분마다 갱신
SELECT cron.schedule('refresh-stats', '*/5 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY problem_stats');
```

### 4.5 Prisma Connection Pool 최적화

```
DATABASE_URL="...?connection_limit=20&pool_timeout=10"
```

---

## 5. Phase 4: 확장 (2-3개월)

### 5.1 text-embedding-3-large 업그레이드

```python
EMBEDDING_MODEL = "text-embedding-3-large"  # 1536 → 3072 dims
```
- 임베딩 품질 +15-20%
- 주의: 전체 재임베딩 필요, 마이그레이션 계획 필수

### 5.2 Debezium CDC (ES 동기화 자동화)

Application-level dual-write → CDC 자동 동기화:
```yaml
debezium:
  image: debezium/connect:2.5
  environment:
    BOOTSTRAP_SERVERS: kafka:9092
    CONFIG_STORAGE_TOPIC: connect-configs
  depends_on: [kafka, postgres]
```

### 5.3 PgBouncer 도입

```yaml
pgbouncer:
  image: edoburu/pgbouncer:1.22
  environment:
    DB_HOST: postgres
    DB_PORT: 5432
    POOL_MODE: transaction
    MAX_CLIENT_CONN: 200
    DEFAULT_POOL_SIZE: 20
```

### 5.4 Read Replica

```
Write API → Primary PG
Read API (Search) → Read Replica PG (Streaming Replication)
```

### 5.5 "같은 개념, 다른 난이도" 검색

```python
async def find_same_concept_different_difficulty(
    problem_id: str, target_difficulty: float, tolerance: float = 0.5
):
    query = text("""
        SELECT p2.id,
            1 - (p1.embedding <=> p2.embedding) AS similarity,
            p2.difficulty_refined, p2.required_concepts
        FROM ocr.problems p1
        JOIN ocr.problems p2
            ON p2.id != p1.id
            AND p2.embedding IS NOT NULL
            AND p2.subject = p1.subject
            AND p2.difficulty_refined BETWEEN :target_low AND :target_high
            AND p2.required_concepts && p1.required_concepts
        WHERE p1.id = :problem_id
        ORDER BY p1.embedding <=> p2.embedding
        LIMIT 10
    """)
```

### 5.6 자동 문제 클러스터링 (HDBSCAN)

```python
from sklearn.cluster import HDBSCAN
import numpy as np

async def cluster_problems_by_concept():
    embeddings = await fetch_all_embeddings()
    clusterer = HDBSCAN(min_cluster_size=5, metric='cosine')
    labels = clusterer.fit_predict(embeddings)
    await update_cluster_labels(labels)
```

---

## 6. 기술 스택 비교 매트릭스

### 검색 엔진

| 항목 | Elasticsearch | Meilisearch | PostgreSQL FTS |
|------|--------------|-------------|----------------|
| 한국어 지원 | ✅ Nori (우수) | ⚠️ CJK (보통) | ⚠️ simple (제한) |
| 수학 검색 | ✅ Custom analyzer | ⚠️ 제한적 | ❌ 어려움 |
| 퍼지 매칭 | ✅ 강력 | ✅ 강력 | ⚠️ pg_trgm |
| Faceted Search | ✅ Aggregations | ✅ 내장 | ❌ 별도 쿼리 |
| 벡터 검색 | ✅ dense_vector | ❌ 미지원 | ✅ pgvector |
| 확장성 | ✅ 클러스터링 | ⚠️ 단일 노드 | ⚠️ 제한적 |
| 운영 복잡도 | 높음 (JVM) | 낮음 (단일 바이너리) | 없음 |
| 메모리 요구 | 높음 (4GB+) | 중간 (1GB+) | 없음 |
| **추천** | **10만+ 문제** | **MVP / 단기** | **즉시 (tsvector)** |

### 이벤트 스트리밍

| 항목 | Redis Pub/Sub (현재) | Redis Streams | Apache Kafka |
|------|---------------------|---------------|--------------|
| 메시지 보장 | ❌ at-most-once | ✅ at-least-once | ✅ exactly-once |
| 지속성 | ❌ 메모리만 | ✅ 디스크 | ✅ 디스크 |
| Consumer Group | ❌ | ✅ | ✅ |
| 재처리 | ❌ | ✅ | ✅ |
| 운영 복잡도 | 없음 | 낮음 | 높음 |
| **추천** | - | **✅ 즉시 전환** | ⚠️ 규모 확대 시 |

### 벡터 DB

| 항목 | pgvector (현재) | Qdrant | Weaviate |
|------|----------------|--------|----------|
| 검색 속도 (1M) | ~50ms | ~10ms | ~15ms |
| 필터 + 벡터 | ⚠️ 제한적 | ✅ 강력 | ✅ 강력 |
| 운영 복잡도 | 없음 | 중간 | 중간 |
| 트랜잭션 | ✅ | ❌ | ❌ |
| **추천** | **✅ 현재 충분** | ⚠️ 100만+ 시 | ⚠️ 100만+ 시 |

---

## 7. 유사 문제 검색 강화 (pgvector)

### 예상 효과 요약

| 개선 | 검색 품질 향상 | 구현 비용 | 우선순위 |
|------|---------------|-----------|----------|
| ef_search 튜닝 | +5-10% recall | 코드 1줄 | **즉시** |
| 하이브리드 검색 (RRF) | +35% 정밀도 | 3-5일 | **1위** |
| 메타데이터 필터 + iterative scan | 관련성 10x | 2-3일 | **2위** |
| Cross-encoder 리랭킹 | +30-48% Top-10 | 3-5일 | **3위** |
| text-embedding-3-large | +15-20% 품질 | 2일 + 재임베딩 | 4위 |
| 검색 API 노출 | 사용자 가치 직접 제공 | 1-2일 | 병행 |

---

## 8. Elasticsearch 통합 계획

### 아키텍처

```
Next.js → NestJS (Search Gateway) → PostgreSQL (Source of Truth)
                                   → Elasticsearch (Read Layer)
                                         ↑
                                   Debezium (CDC Sync)
```

핵심 원칙: PostgreSQL = Source of Truth, Elasticsearch = Read-optimized Search Layer.

### 인덱스 설계 핵심

- `korean_math` analyzer: nori_tokenizer + 수학 동의어 필터
- `latex_analyzer`: keyword tokenizer + LaTeX 정규화 필터
- `dense_vector` 1536차원: ES 내 벡터 검색 (pgvector 보완)
- 수학 동의어 사전: 미분=도함수, 적분=부정적분, 이차방정식=2차방정식

### 동기화 전략

| Phase | 전략 | 비고 |
|-------|------|------|
| Phase 2 | Application-level dual-write | 빠른 도입 |
| Phase 4 | Debezium CDC | 자동화, 안정적 |

---

## 9. 불필요한 것

현재 규모에서 도입 불필요:

- **Qdrant/Weaviate**: pgvector가 현재 규모에서 충분. HNSW 인덱스 이미 구성됨.
- **Apache Kafka**: Redis Streams가 현재 이벤트 볼륨에 충분. 마이크로서비스 10개+ 시 재검토.
- **ClickHouse**: Materialized views로 분석 쿼리 충분. 실시간 대시보드 고도화 시 검토.
- **GraphQL**: REST + React Query 조합이 현재 요구사항에 적합.
