# JSMath Student AI App — Design Spec

## Overview

A standalone math learning app for middle and high school students (grades 7-12). Students can photograph textbook problems for AI tutoring, browse a curated problem bank, track wrong answers, and strengthen weak areas through spaced repetition — all without requiring academy enrollment.

This app is a separate product from the existing LMS. It reuses the `student-ai` backend APIs but has its own authentication, onboarding, and UI tailored for independent learners.

## Target Users

- **Primary:** High school students preparing for CSAT (수능)
- **Secondary:** Middle school students building math foundations
- **Context:** Self-directed study — no teacher assignment dependency

## Core Value Proposition

> Photograph a math problem, get Socratic AI tutoring, and let the app track your weaknesses and schedule reviews automatically.

## App Structure

### Navigation: 4-Tab Bottom Bar

| Tab | Icon | Label | Purpose |
|-----|------|-------|---------|
| 1 | `Home` | 홈 | Dashboard hub — today's tasks, streak, quick actions |
| 2 | `Search` | 탐색 | Camera OCR + problem bank search + curriculum browsing |
| 3 | `BookOpen` | 학습 | Wrong answers, daily review, mastery tree, weakness analysis |
| 4 | `User` | 내정보 | Profile, achievements, stats, settings |

All icons use Lucide (line-style). No emoji anywhere in the UI.

### Screen Map

#### Tab 1: Home (홈)

- **Greeting + streak counter** — "7일 연속 학습 중" with streak flame icon
- **Today's review card** — SM-2 due count with "시작하기" CTA and progress bar
- **Quick action grid (2x2):**
  - Camera (문제 찍기) — opens camera for OCR
  - Search (문제 검색) — jumps to Explore tab search
  - Wrong answers (오답노트) — jumps to Study tab wrong answers
  - Weakness (내 약점) — jumps to Study tab weakness analysis
- **Recent activity feed** — last 5 problems attempted with results
- **Level progress bar** — current XP toward next level

#### Tab 2: Explore (탐색)

- **Camera button (prominent, top)** — opens full-screen camera for problem photography
- **Search bar** — keyword search across problem bank
- **Curriculum browser** — hierarchical tree (2015/2022 curriculum)
  - Subject → Unit Major → Unit Minor → Topic
  - Difficulty filter (1-5)
- **Problem card list** — scrollable cards with subject, difficulty badge, unit tag
- **Problem detail screen (push):**
  - Problem stem rendered with LaTeX (KaTeX/MathView)
  - "AI 튜터에게 질문" CTA button
  - "펜슬로 풀기" button (visible on iPad)
  - Solution toggle (hidden by default)

#### Tab 3: Study (학습)

This tab has a segmented control or section list at the top:

**Wrong Answers (오답노트):**
- List of wrong answers grouped by error type (concept_gap, pattern_gap, calculation_error, careless_mistake)
- Each card shows: problem preview, error type badge, retry count, resolved status
- Error type is auto-classified by the backend's inference logic (based on difficulty + problem type). No teacher classification needed in standalone mode.
- Actions: retry, mark resolved, open in AI tutor

**Daily Review (오늘의 복습):**
- SM-2 spaced repetition session
- Card-based review: shows problem → student self-assesses
- 5-level quality rating (모르겠음 → 완벽함)
- Progress counter (3/5 completed)
- Stats: today done, this week, total scheduled

**Mastery Tree (마스터리):**
- Hierarchical curriculum visualization
- Color-coded states: mastered (green), practicing (blue), learning (yellow), not started (gray)
- Drill-down to node detail with accuracy, attempt count

**Weakness Analysis (약점 분석):**
- AI-generated weakness summary (Korean, 3-5 sentences)
- Unit accuracy heatmap
- Root cause identification (prerequisite gaps)
- "추천 문제 생성" button → creates remediation problem set

**Grade Prediction (성적 예측):**
- Predicted CSAT grade per subject (1-9등급)
- Based on current accuracy + grade cutoff tables
- Confidence indicator based on sample size

#### Tab 4: Profile (내정보)

- **Profile card:** name, level, XP, current streak
- **Achievement grid:** badges for milestones (first problem, 7-day streak, 100 problems, etc.)
- **Stats dashboard:**
  - Weekly/monthly problems solved
  - Accuracy trend chart
  - Total study time
- **Settings:**
  - Dark mode toggle
  - Curriculum year (2015/2022)
  - Grade level (중1 ~ 고3)
  - Notification preferences (daily review reminders)
  - Account management

### Modal/Push Screens

#### AI Tutor Chat

Accessed from: problem detail, wrong answer retry, camera result

- **Header:** problem title/number, session info
- **Chat interface:**
  - AI messages: left-aligned, warm surface color bubble, avatar icon
  - Student messages: right-aligned, accent color bubble
  - Image attachment support (camera/gallery)
  - Streaming response (SSE)
- **Input bar:** text field + camera button + send button
- **Socratic method:** AI never gives direct answers, guides with questions
- **Session limits:** max 30 messages, max 5 images (enforced by backend `TutorVisionService`)
- **iPad:** chat can appear as side panel alongside problem/canvas

#### Camera & OCR Flow

1. Full-screen camera with viewfinder overlay
2. Capture → OCR processing (loading state)
3. OCR result confirmation — student can edit recognized text/LaTeX
4. "AI 튜터에게 질문" button → opens tutor chat with this problem

#### iPad Pencil Canvas

Accessed from: problem detail screen on iPad

- **Split view:** left panel (problem stem) | right panel (Skia canvas)
- **Canvas tools:**
  - Pen color selection (black, red, green)
  - Pen thickness
  - Eraser
  - Undo/redo
  - Clear all
- **Submit button** → uploads canvas image to S3 via `CanvasUploadService`
- **AI analysis** → `TutorVisionService` analyzes handwritten solution
- **Feedback** → error classification + guided correction via tutor chat

## Key Flows

### Flow A: Camera → AI Tutor

```
Camera capture → OCR recognition → Confirm/edit problem text → AI Tutor chat session → Wrong answer recorded (if incorrect)
```

### Flow B: Problem Bank → Practice

```
Browse curriculum → Select unit → View problem list → Attempt problem → Check answer → AI Tutor (if wrong) → Wrong answer + mastery update
```

### Flow C: iPad Pencil Solve

```
Select problem → Split view (problem | canvas) → Write solution with Pencil → Submit → AI vision analysis → Error feedback → Tutor chat for correction
```

### Flow D: Review Loop

```
Wrong answer recorded → SM-2 scheduling → "오늘의 복습" notification → Review session → Self-assess (0-5) → Reschedule → [loop]
```

## Visual Design

### Theme System

Two themes, toggled in settings. Light is default.

**Light Mode (Warm Beige):**
- Background: `#fefcf9`
- Card: `#ffffff`
- Surface: `#f8f0e5` / `#faf5ed`
- Accent: `#d4a574`
- Text primary: `#2d2d2d`
- Text secondary: `#6b5a45`
- Text muted: `#a08060`
- Border: `#f0e6d8`
- Destructive: `#c87070`
- Success: `#5da37e`

**Dark Mode (Clean Minimal):**
- Background: `#1a1a2e`
- Card: `#16213e`
- Surface: `#0f3460`
- Accent: `#e94560`
- Text primary: `#e0e0e0`
- Text secondary: `#aaaaaa`
- Text muted: `#666666`
- Border: `#2a2a4a`
- Destructive: `#e94560`
- Success: `#43e97b`

### Typography

- Font: System default (San Francisco on iOS)
- Korean optimization: Pretendard if bundled, else system
- Math rendering: `react-native-math-view` (KaTeX-based) for LaTeX

### Iconography

- Library: `lucide-react-native` (already installed)
- Style: 24px, stroke-width 2, matching text color
- No emoji anywhere

### Component Patterns

- **Cards:** white/card background, subtle border, 12-16px border radius, light shadow
- **Buttons:** accent color for primary CTA, surface color for secondary
- **Badges:** small rounded pills for difficulty, error type, status
- **Progress bars:** rounded, accent color fill on surface track
- **Bottom sheet:** for filters, options (react-native-bottom-sheet if needed)

## Authentication & Onboarding

### Auth Flow (Standalone — No LMS Required)

1. **Welcome screen** — app value proposition
2. **Social login** — Kakao / Apple / Google (via Expo AuthSession)
3. **Onboarding:**
   - Grade selection (중1 ~ 고3)
   - Curriculum year confirmation (2015 / 2022)
4. **Home dashboard**

Backend: New auth endpoints separate from LMS JWT flow. Student accounts are independent — optional LMS linking can be added later.

### Data Isolation

- Student data is stored under the student's own account
- No class/academy association required
- Problem bank access is read-only from the existing OCR-processed corpus
- Wrong answers, mastery, reviews are all per-student

## Gamification (Moderate)

- **Streak counter:** consecutive study days, displayed on home
- **Level system:** XP earned per problem attempted/reviewed, simple level progression
- **Mastery badges:** earned when curriculum nodes reach "mastered" state
- **Milestone achievements:** first problem, 7-day streak, 50 problems, etc.
- **No leaderboard** — intentionally excluded; this is self-improvement focused, not competitive (backend has `/gamification/leaderboard` but we do not use it)

## iPad Adaptations

- **Split view:** problem display + canvas side by side
- **Apple Pencil:** Skia canvas with pressure sensitivity
- **Larger grid:** 3-column quick actions instead of 2
- **AI Tutor:** side panel layout instead of full-screen push

## Technical Architecture

### Frontend

- **Framework:** Expo 55 + React Native 0.83
- **Routing:** Expo Router (file-based, same as current mobile app)
- **Styling:** NativeWind (Tailwind CSS for RN)
- **Canvas:** @shopify/react-native-skia (already installed)
- **Math:** react-native-math-view (to be added)
- **State:** TanStack React Query v5 (already installed)
- **Auth:** expo-secure-store for tokens (already installed)
- **Camera:** expo-image-picker (already installed in apps/mobile) + expo-camera (to be added)
- **Icons:** lucide-react-native (already installed)

### Backend (Reuse Existing)

All `student-ai` API endpoints are already built:

- `POST /student-ai/tutor/sessions` — create tutor session
- `POST /student-ai/tutor/sessions/:id/message` — streaming chat (SSE)
- `GET /student-ai/tutor/sessions/:id` — get session details
- `POST /student-ai/tutor/sessions/:id/end` — end session
- `GET /student-ai/wrong-answers` — list wrong answers (paginated, filterable)
- `GET /student-ai/wrong-answers/stats` — error type statistics
- `PATCH /student-ai/wrong-answers/:id/resolve` — mark resolved
- `POST /student-ai/wrong-answers/:id/retry` — record retry attempt
- `GET /student-ai/reviews/daily` — SM-2 due reviews
- `GET /student-ai/reviews/stats` — review statistics
- `POST /student-ai/reviews/:id/grade` — grade review (quality 0-5)
- `GET /student-ai/mastery` — mastery dashboard summary
- `GET /student-ai/mastery/tree` — curriculum mastery tree
- `GET /student-ai/mastery/:nodeId` — single node mastery
- `GET /student-ai/weakness` — weakness profile with AI summary
- `POST /student-ai/recommendations/generate` — smart recommendations
- `POST /student-ai/canvas/upload` — handwritten solution upload
- `GET /grade-prediction/me` — student's grade predictions per subject
- `GET /gamification/profile` — XP, level, streak
- `GET /gamification/achievements` — earned badges/milestones

### New Backend Work Needed

#### 1. Standalone Auth (`POST /auth/social`)

Social login for standalone students (no academy required).

- **Request:** `{ provider: "kakao" | "apple" | "google", token: string }`
- **Response:** `{ accessToken: string, user: { id, name, role: "student" }, isNewUser: boolean }`
- **Implementation:** Add `provider` and `providerAccountId` columns to existing `User` table. Create user with `role: "student"` if not exists. Issue same JWT format as existing auth (so all student-ai endpoints work without changes). No linked-accounts table needed — one provider per account for now.
- **LMS linking:** Out of scope for v1. Can be added later by associating a standalone user with a class via invite code.

#### 2. Student Onboarding (`POST /users/me/preferences`)

Save grade level and curriculum year after first login.

- **Request:** `{ gradeLevel: "중1" | "중2" | ... | "고3", curriculumYear: 2015 | 2022 }`
- **Response:** `{ success: true }`
- **Implementation:** Add `gradeLevel` and `curriculumYear` nullable columns to `User` table. These are used by the frontend to filter problem bank and mastery tree.

#### 3. Camera OCR (`POST /ocr/single-problem`)

Accept a single photo of one math problem, return recognized LaTeX.

- **Request:** Multipart form — `image: File` (JPEG/PNG, max 10MB)
- **Response:** `{ problemText: string (LaTeX), confidence: number, rawBlocks: Array<{ type: "text" | "math", content: string }> }`
- **Latency target:** < 5 seconds
- **Implementation:** This is a new lightweight endpoint on the FastAPI `ocr-api`, NOT the existing Celery-based PDF pipeline. It calls Mathpix API directly with a single image (Mathpix supports single-image OCR natively), parses the result, and returns structured LaTeX. No queuing, no Celery — synchronous request/response. The recognized problem is NOT stored in the problem bank; it exists only in the tutor session context.

#### 4. Problem Bank Read (`GET /problems/browse`)

Public-facing read-only endpoint for students to search approved problems.

- **Request query params:** `{ search?: string, subject?: string, unitMajor?: string, difficulty?: number, curriculumYear?: 2015 | 2022, page?: number, limit?: number }`
- **Response:** `{ items: Array<{ id, stem, subject, unitMajor, unitMinor, difficulty, problemType }>, total: number, page: number }`
- **Implementation:** New endpoint on the existing `ProblemsController` with `@Roles("student", "teacher", "admin")`. Returns only `reviewStatus: "approved"` problems. Excludes answer/solution fields from response (students should not see answers directly). Solution is only viewable after attempting the problem.

### Project Structure

New app directory: `apps/student-app/` (separate Expo project, independent from `apps/mobile/` which is the LMS mobile app). Same Expo/RN version and NativeWind setup for consistency, but no shared code — each app has its own dependencies and build config.

```
apps/student-app/
├── app/                          # Expo Router file-based routing
│   ├── _layout.tsx               # Root layout (providers)
│   ├── index.tsx                 # Auth redirect
│   ├── (auth)/                   # Login, register, onboarding
│   ├── (tabs)/                   # Main 4-tab layout
│   │   ├── _layout.tsx           # Tab navigator
│   │   ├── index.tsx             # Home dashboard
│   │   ├── explore.tsx           # Explore tab
│   │   ├── study.tsx             # Study tab
│   │   └── profile.tsx           # Profile tab
│   ├── problem/[id].tsx          # Problem detail
│   ├── tutor/[sessionId].tsx     # AI tutor chat
│   ├── camera.tsx                # Camera OCR
│   └── canvas/[problemId].tsx    # iPad pencil canvas
├── components/
│   ├── ui/                       # Shared UI primitives
│   ├── home/                     # Home tab components
│   ├── explore/                  # Explore tab components
│   ├── study/                    # Study tab components
│   ├── tutor/                    # Chat components
│   ├── canvas/                   # Skia canvas components
│   └── math/                     # LaTeX rendering
├── lib/
│   ├── api.ts                    # API client
│   ├── auth.tsx                  # Auth context
│   ├── storage.ts                # Secure storage
│   └── theme.ts                  # Theme provider (light/dark)
├── hooks/                        # Custom hooks
├── constants/                    # Colors, config
└── assets/                       # App icon, splash
```

## Success Criteria

1. Student can photograph a math problem and receive AI tutoring within 10 seconds
2. Wrong answers are automatically tracked and scheduled for review
3. Daily review notifications drive repeat engagement
4. iPad users can write solutions with Apple Pencil and receive AI feedback
5. Mastery tree gives clear visibility into curriculum progress
6. App feels warm, approachable, and focused — not like an admin tool
