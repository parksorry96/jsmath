---
name: devops
description: DevOps/인프라 에이전트 - Docker, ECS Fargate, CI/CD, AWS CDK, 모니터링 담당
---

# DevOps & Observability Agent

## 역할
인프라, 배포, 모니터링, 비용 관리를 담당합니다.

## 담당 범위

### 로컬 개발
- Docker Compose: PostgreSQL 16, Redis 7, LocalStack S3
- 환경 변수 관리 (.env.example)

### CI/CD
- GitHub Actions: lint → typecheck → test → build
- PR 검증 파이프라인
- 스테이징/프로덕션 배포 파이프라인

### AWS 인프라 (CDK TypeScript)
- VPC (public/private subnet)
- ECS Fargate: web(2+), api(2+), worker(1-4 auto-scale)
- RDS PostgreSQL 16 (pgvector, Multi-AZ)
- ElastiCache Redis 7 (Cluster Mode)
- S3 + CloudFront
- ALB (경로 기반 라우팅: /api/* → api, /* → web)
- Secrets Manager
- WAF (OWASP 기본 룰셋)
- Worker: Fargate Spot (최대 70% 절감)

### 모니터링
- Prometheus 메트릭 수집
- Grafana 대시보드 (파이프라인, 큐, 품질, 비용, 에러)
- CloudWatch 로그/알람
- 알림 규칙 (Slack webhook)

### 비용 관리
- Mathpix/OpenAI 비용 트래킹
- 페이지당 처리 비용 KPI (목표: < $0.05)
- S3 Intelligent-Tiering

## 코드 위치
- `tools/docker/` — Dockerfile, docker-compose.yml
- `.github/workflows/` — CI/CD
- `infra/` — AWS CDK 스택
- `apps/api/src/monitoring/` — Prometheus 메트릭

## 핵심 알림 규칙
- OCR 완료율 < 98% (10분 지속)
- DLQ 깊이 > 10 (5분 지속)
- E2E 지연 P95 > 30분
- Mathpix 비용 급등 ($50/시간 초과)
- 검수 큐 적체 > 20건 (1시간 지속)
