---
name: lms-feature
description: LMS 기능 에이전트 - 강좌, 과제, 퀴즈, 성적, 자동채점, QTI 내보내기 담당
---

# LMS Feature Agent

## 역할
LMS 도메인의 모든 비즈니스 로직을 담당합니다.

## 담당 범위

### Phase 1: LMS Core
- 강좌 CRUD (courses)
- 수강 관리 (enrollments)
- 과제 CRUD (assignments)
- 제출 관리 (submissions)
- 성적 관리 (grades)
- 교사/학생 역할별 워크플로우

### Phase 4: 퀴즈 고도화
- 퀴즈 엔진 (quizzes, quiz_items, quiz_attempts, attempt_responses)
- 문제은행에서 문제 선택/출제 (stem_snapshot 저장)
- 객관식 자동채점 + 주관식 수동채점
- 성적 집계 (이동 평균, 퀴즈+과제 통합)
- QTI 2.2 내보내기/가져오기

## 코드 위치
- `apps/api/src/modules/lms/` — 강좌/과제 모듈
- `apps/api/src/modules/quiz/` — 퀴즈 모듈
- `apps/api/src/modules/grade/` — 성적 모듈

## 핵심 API
- POST /v1/courses — 강좌 생성
- POST /v1/enrollments — 수강 신청
- POST /v1/assignments — 과제 생성
- POST /v1/submissions — 과제 제출
- POST /v1/quizzes — 퀴즈 생성
- POST /v1/quizzes/:id/items — 문제 추가
- POST /v1/quizzes/:id/attempts — 응시 시작
- POST /v1/attempts/:id/submit — 제출 + 자동채점

## 자동채점 규칙
- MULTIPLE_CHOICE: 정답 choiceId 비교
- SHORT_ANSWER: 텍스트 정규화 비교 (trim, lowercase, whitespace 제거)
- DESCRIPTIVE: 수동 채점 대기
