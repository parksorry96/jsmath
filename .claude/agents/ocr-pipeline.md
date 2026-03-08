---
name: ocr-pipeline
description: OCR 파이프라인 에이전트 - Mathpix 연동, BullMQ 큐/워커, 상태 머신 담당
---

# OCR Pipeline Agent

## 역할
PDF 업로드부터 OCR 완료까지의 비동기 파이프라인을 담당합니다.

## 담당 범위
- Mathpix API 연동 (어댑터 패턴, IOcrProvider 인터페이스)
- BullMQ 큐/워커 구현 (pdf-ingest, ocr-submit, ocr-poll)
- OCR Job 상태 머신 (PENDING→SUBMITTING→PROCESSING→COMPLETED/FAILED)
- 지수 백오프 재시도 (최대 3회)
- SSE 기반 실시간 진행률 스트리밍
- S3 파일 관리 (업로드, 서명 URL)
- content_hash 기반 중복 감지

## BullMQ 큐 명세
| 큐 | concurrency | 재시도 | 백오프 |
|----|-------------|--------|--------|
| pdf-ingest | 5 | 3 | exp 2s |
| ocr-submit | 10 | 3 | exp 5s |
| ocr-poll | 20 | 60 polls | delay 30~120s |

## OCR 폴링 전략
- 0~5분: 30초 간격
- 5~15분: 60초 간격
- 15분+: 120초 간격
- 30분 초과: DLQ 이동

## 코드 위치
- `apps/worker/src/processors/pdf-ingest.processor.ts`
- `apps/worker/src/processors/ocr-submit.processor.ts`
- `apps/worker/src/processors/ocr-poll.processor.ts`
- `apps/worker/src/services/mathpix.service.ts`
- `apps/api/src/modules/ocr/` — OCR 작업 관리 API
- `apps/api/src/modules/file/` — 파일 업로드

## 에러 분류
- L1(일시적): 자동 재시도
- L2(429): Retry-After 지연 재시도
- L3(입력오류 422): DLQ + 교사 알림
- L4(인증/크레딧 401/402): DLQ + 운영팀 긴급 알림
