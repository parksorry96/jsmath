# LMS + Mobile App Design

Date: 2026-03-08

## Overview

Extend JSMath platform with full LMS features (calendar, assignments, grading, analytics) and a separate React Native (Expo) mobile app for students, parents, and teachers.

## Requirements

| Item | Decision |
|------|----------|
| Roles | admin, teacher, student, **parent** |
| Calendar | Recurring (RRULE) + individual lessons |
| Communication | In-app notifications only (no chat) |
| Assignments | Problem bank online + text-based tasks |
| Reports | Advanced — unit accuracy, trends, AI recommendations |
| Scale | 1:1 tutoring + small group classes |
| Mobile | React Native (Expo) — separate codebase |
| Submission Analysis | Photo → Vision LLM (latest model) direct analysis |
| Naming | Course → **Class** throughout |

## Platform Split

| Platform | Tech | Users | Features |
|----------|------|-------|----------|
| Web | Next.js | Teacher | Problem bank, OCR, review, LMS |
| App | Expo | Student, Parent, Teacher | LMS (calendar, assignments, grades, notifications) |
| Backend | NestJS (shared) | All | Single API |

## Data Model (Prisma Schema Extensions)

### Role Update
```
Role: admin | teacher | student | parent
```

### Rename
- Course → Class (model, endpoints, frontend)

### New Models

```
ParentStudent        — parent-child relationship (1:N)
├── parentId, studentId

Lesson               — class schedule (calendar core)
├── classId, title, startAt, endAt
├── recurrenceRule    — RFC 5545 RRULE
├── recurrenceParentId — recurring lesson parent ref
├── status           — scheduled | completed | cancelled
├── location, memo

Assignment (extend existing)
├── + type           — problem_set | text_task
├── + problems[]     — AssignmentProblem relation

AssignmentProblem    — problems included in assignment
├── assignmentId, problemId, orderIndex

Submission           — student assignment submission
├── assignmentId, studentId
├── type             — online | photo
├── submittedAt, score, status

SubmissionAnswer     — per-problem answer (online type)
├── submissionId, problemId
├── studentAnswer, isCorrect, score

SubmissionPhoto      — solution photo submission
├── submissionId, s3Key
├── analysisStatus   — pending | analyzing | completed | failed
├── aiFeedback       — JSON (Vision LLM analysis result)

Notification         — in-app notification
├── userId, type, title, body
├── referenceType, referenceId
├── readAt

StudentAnalytics     — student analysis snapshot (periodic aggregation)
├── studentId, classId, period
├── accuracyByUnit   — JSON
├── weakTopics, trend — JSON
```

## Backend Module Structure (NestJS)

```
apps/lms-api/src/
├── auth/              # existing — add parent role
├── classes/           # renamed from courses/
├── enrollments/       # existing — reference classId
├── assignments/       # extended — type field, problem linking
├── lessons/           # 🆕 lesson schedule CRUD + recurrence
├── submissions/       # 🆕 assignment submission + grading
├── submission-photos/ # 🆕 photo upload → Vision LLM analysis
├── parent-links/      # 🆕 parent-student connection
├── notifications/     # 🆕 in-app + push (Expo Push)
├── analytics/         # 🆕 student performance analysis
└── ...existing modules
```

### New API Endpoints

```
# Lessons (Calendar)
GET/POST   /v1/lessons              — list/create lessons
PATCH/DEL  /v1/lessons/:id          — update/delete lesson
GET        /v1/lessons/calendar     — calendar view (date range query)

# Submissions
POST       /v1/submissions          — submit assignment (online/photo)
GET        /v1/submissions/:id      — submission detail + AI feedback
POST       /v1/submissions/:id/photo — upload solution photo → Vision analysis

# Parent Links
POST       /v1/parent-links         — link child (invite code)
GET        /v1/parent-links/children — children list + status

# Notifications
GET        /v1/notifications        — notification list
PATCH      /v1/notifications/:id    — mark as read

# Analytics
GET        /v1/analytics/student/:id — student performance report
GET        /v1/analytics/course/:id  — class-level analysis
```

## Mobile App Structure (Expo)

```
apps/mobile/
├── app/                        # Expo Router
│   ├── (auth)/
│   │   ├── login.tsx
│   │   └── register.tsx
│   ├── (student)/              # Student tabs
│   │   ├── _layout.tsx         # Bottom Tab Navigator
│   │   ├── home.tsx            # Today's lessons + todo summary
│   │   ├── calendar.tsx        # Lesson calendar
│   │   ├── assignments.tsx     # Assignment list
│   │   ├── assignment/[id].tsx # Assignment detail + solve
│   │   └── report.tsx          # My grades/analysis
│   ├── (parent)/               # Parent tabs
│   │   ├── _layout.tsx
│   │   ├── home.tsx            # Children status summary
│   │   ├── calendar.tsx        # Lesson schedule
│   │   ├── children/[id].tsx   # Per-child grade report
│   │   └── notifications.tsx   # Notifications
│   └── (teacher)/              # Teacher tabs
│       ├── _layout.tsx
│       ├── home.tsx            # Today's lessons + dashboard
│       ├── calendar.tsx        # Lesson management
│       ├── classes.tsx         # Class list
│       ├── class/[id].tsx      # Class detail (students, assignments, grades)
│       ├── assignment/new.tsx  # Create assignment
│       └── grading.tsx         # Grading management
├── components/
│   ├── calendar/
│   ├── assignment/
│   ├── report/
│   └── common/
├── lib/
│   ├── api.ts
│   └── auth.ts                 # Token management (SecureStore)
└── package.json
```

### Key Libraries
- expo-router — file-based navigation
- expo-camera — solution photo capture
- expo-image-picker — gallery selection
- expo-notifications — push notifications
- expo-secure-store — JWT token storage
- react-native-calendars — calendar UI
- victory-native — grade charts
- nativewind — Tailwind CSS for RN

## Solution Photo Analysis Pipeline

```
📸 Student capture (Expo Camera)
  → S3 upload (presigned URL)
  → NestJS: create SubmissionPhoto record
  → Redis event → FastAPI Celery worker
  → Vision LLM call (latest model)
    - Input: solution photo + problem stem (LaTeX) + correct answer
    - Output: structured JSON response
  → Redis event → NestJS: save result + notification
  → Push notification: "Analysis complete!"
```

### Vision LLM Response Structure
```json
{
  "isCorrect": false,
  "score": 7,
  "maxScore": 10,
  "steps": [
    { "step": 1, "content": "x² + 3x = 0", "correct": true },
    { "step": 2, "content": "x(x+3) = 0", "correct": true },
    { "step": 3, "content": "x = 0, x = 3", "correct": false,
      "feedback": "x+3=0 → x=-3 is correct" }
  ],
  "errorType": "sign_error",
  "conceptHint": "Watch the sign when solving each factor = 0",
  "overallFeedback": "Factoring was correct but sign error in final roots"
}
```

## Web Frontend Changes (Next.js)

```
apps/web/src/app/(authenticated)/
├── courses/ → classes/         # rename
├── dashboard/                  # update to Class-based
├── calendar/                   # 🆕 teacher lesson calendar (web)
├── grading/                    # 🆕 grading management (web)
└── ...existing (upload, review, problems unchanged)
```

## Architecture Diagram

```
┌─────────────┐  ┌──────────────┐  ┌──────────────────┐
│  Next.js    │  │ Expo Mobile  │  │ FastAPI + Celery  │
│  (teacher   │  │ (student/    │  │ (OCR + Vision    │
│   web)      │  │  parent/     │  │  analysis worker) │
│             │  │  teacher app)│  │                   │
└──────┬──────┘  └──────┬───────┘  └────────┬─────────┘
       │                │                    │
       └────────┬───────┘                    │
                ▼                            │
       ┌────────────────┐    Redis     ┌─────┘
       │   NestJS API   │◄────────────►│
       │  (single API)  │  Pub/Sub     │
       └───────┬────────┘              │
               ▼                       │
       ┌────────────────┐              │
       │  PostgreSQL    │              │
       │  + pgvector    │◄─────────────┘
       └────────────────┘
```
