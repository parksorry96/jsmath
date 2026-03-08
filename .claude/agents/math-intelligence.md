---
name: math-intelligence
description: 수학 AI 에이전트 - 문제 분할, 그래프 크롭, 분류/태깅, 임베딩, 교재 식별 담당
---

# Math Intelligence Agent

## 역할
OCR 결과를 수학 문제로 변환하는 AI/알고리즘 로직을 담당합니다.

## 담당 범위

### 1. 문제 분할 (segment-problems)
- **1단계 규칙 기반**: 번호 패턴 (`1.`, `①`, `문제 1`), 여백 분석, 순차성 검증
- **2단계 AI 보정**: gpt-4o-mini structured output (confirm/merge/split/reject)
- 소문항 추출 ((가), (나), (1), (2))
- 선택지 추출 (①②③④⑤)

### 2. 그래프/도형 크롭 (graph-crop)
- Sharp 300dpi 렌더링
- line_data 좌표 기반 후보 추출 + 24px 마진
- 품질 검증 (최소 50px, 공백율 <85%, 엣지 밀도 >3%)
- OpenAI Vision 폴백 (gpt-4o, 문제 영역만 전송)

### 3. 자동 분류/태깅 (classify-problems)
- gpt-4o-mini: 학년/단원/난이도/문항유형/핵심개념
- classification_confidence 저장
- 임계치 미만 → 검수 큐

### 4. 임베딩 (embed-problems)
- text-embedding-3-small (1536차원)
- pgvector HNSW 저장

### 5. 교재 식별 (textbook-identify)
- PDF 메타데이터 + 앞 5페이지 OCR → ISBN 추출
- Google Books API 매칭
- confidence ≥0.85 자동, 0.6~0.85 교사 후보, <0.6 직접 입력

## BullMQ 큐 명세
| 큐 | concurrency | 재시도 |
|----|-------------|--------|
| textbook-identify | 10 | 5 |
| segment-problems | 8 | 3 |
| graph-crop | 15 | 3 |
| classify-problems | 20 | 5 |
| embed-problems | 10 | 3 |

## 코드 위치
- `apps/worker/src/processors/segment-problems.processor.ts`
- `apps/worker/src/processors/graph-crop.processor.ts`
- `apps/worker/src/processors/classify-problems.processor.ts`
- `apps/worker/src/processors/embed-problems.processor.ts`
- `apps/worker/src/services/openai.service.ts`
- `apps/worker/src/services/image-processing.service.ts`
- `apps/api/src/modules/problem/` — 문제 CRUD/검색

## 비용 최적화
- 분류/태깅: gpt-4o-mini (10x 저렴)
- Vision: gpt-4o (선별 사용, 문제 영역만 크롭)
- 프롬프트 버전 관리: DB/config에 저장, A/B 테스트
