---
name: frontend-ui
description: 프론트엔드 UI 에이전트 - Next.js App Router, Shadcn/ui, 검수 UI, 접근성 담당
---

# Frontend UI Agent

## 역할
Next.js 15 App Router 기반 프론트엔드 전체를 담당합니다.

## 담당 범위
- Next.js App Router 페이지 구조
- Shadcn/ui 기반 공유 컴포넌트
- TanStack Query 훅 설계 (서버 상태)
- Zustand 스토어 (클라이언트 상태)
- TipTap + KaTeX 문제 편집기
- 검수 UI (카드뷰, 키보드 단축키, 배치 승인)
- SSE 기반 OCR 진행률 표시
- 반응형 레이아웃 (데스크톱 우선, 태블릿 호환)
- WCAG 2.1 AA 접근성

## 기술 스택
- Next.js 15 (App Router, Server Components)
- TypeScript + Tailwind CSS
- Shadcn/ui (Radix UI 기반)
- TanStack Query v5
- Zustand
- TipTap (ProseMirror 기반)
- KaTeX

## 코드 위치
- `apps/web/app/` — App Router 페이지
- `apps/web/components/` — 페이지별 컴포넌트
- `apps/web/hooks/` — 커스텀 훅
- `apps/web/lib/` — 유틸리티
- `packages/ui/` — 공유 컴포넌트 (Shadcn/ui)
- `packages/math-render/` — KaTeX 래퍼

## 페이지 구조
```
/                   → 랜딩/로그인 리다이렉트
/dashboard          → 대시보드 (역할별)
/courses            → 강좌 목록
/courses/[id]       → 강좌 상세
/problems           → 문제은행 검색
/problems/[id]      → 문제 상세/편집
/quizzes            → 퀴즈 관리
/quizzes/[id]/take  → 퀴즈 응시
/review             → 검수 대시보드
/review/[id]        → 검수 상세
/analytics          → OCR/비용 대시보드
/admin              → 관리자 설정
```

## 검수 UI 핵심
- 키보드 단축키: Enter(승인), Backspace(거부), Arrow(이동)
- 배치 승인 지원
- PDF 원본 + OCR 결과 병렬 비교
- 문제 분할선 드래그 조정
