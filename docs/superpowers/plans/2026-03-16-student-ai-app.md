# Student AI App Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone math learning app (Expo/React Native) that reuses the existing student-ai backend APIs with independent auth, camera OCR, and a warm student-friendly UI.

**Architecture:** New Expo app (`apps/student-app/`) with 4-tab navigation (Home/Explore/Study/Profile). Backend changes: social auth, passwordHash nullable, problem browse endpoint, single-problem OCR endpoint on FastAPI. All existing student-ai APIs reused as-is.

**Tech Stack:** Expo 55, React Native 0.83, Expo Router, NativeWind, @shopify/react-native-skia, TanStack React Query v5, lucide-react-native, react-native-math-view

**Spec:** `docs/superpowers/specs/2026-03-16-student-ai-app-design.md`

---

## Chunk 1: Backend Changes

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`
- Create: migration file (auto-generated)

- [ ] **Step 1: Add columns to User model**

In `packages/db-schema/prisma/schema.prisma`, update the `User` model:

```prisma
model User {
  // existing fields...
  passwordHash    String?           // was String (now nullable for social login)
  provider        String?           // "kakao" | "apple" | "google" | null
  providerAccountId String?         // provider-specific user ID
  gradeLevel      String?           // "중1" ~ "고3"
  curriculumYear  Int?              // 2015 | 2022

  @@unique([provider, providerAccountId]) // prevent duplicate social accounts
  // keep existing indexes...
}
```

- [ ] **Step 2: Generate and run migration**

```bash
cd packages/db-schema
pnpm prisma migrate dev --name add-social-auth-and-preferences
```

- [ ] **Step 3: Regenerate Prisma client**

```bash
pnpm --filter @jsmath/db-schema db:generate
```

- [ ] **Step 4: Verify existing auth still works**

```bash
cd apps/lms-api && pnpm test -- --grep "AuthService"
```

- [ ] **Step 5: Commit**

```bash
git add packages/db-schema/prisma/
git commit -m "feat(db): add social auth and student preference columns to User"
```

---

### Task 2: Social Auth Endpoint

**Files:**
- Create: `apps/lms-api/src/auth/dto/social-login.dto.ts`
- Modify: `apps/lms-api/src/auth/auth.service.ts`
- Modify: `apps/lms-api/src/auth/auth.controller.ts`

- [ ] **Step 1: Create DTO**

```typescript
// apps/lms-api/src/auth/dto/social-login.dto.ts
import { IsEnum, IsString } from "class-validator";

export class SocialLoginDto {
  @IsEnum(["kakao", "apple", "google"])
  provider: "kakao" | "apple" | "google";

  @IsString()
  token: string;
}
```

- [ ] **Step 2: Add socialLogin method to AuthService**

In `apps/lms-api/src/auth/auth.service.ts`, add after the `login` method:

```typescript
async socialLogin(dto: SocialLoginDto) {
  const profile = await this.verifySocialToken(dto.provider, dto.token);

  let user = await this.prisma.user.findUnique({
    where: {
      provider_providerAccountId: {
        provider: dto.provider,
        providerAccountId: profile.id,
      },
    },
  });

  const isNewUser = !user;

  if (!user) {
    // Check if email already exists (e.g., password-based account)
    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });
    if (existingByEmail) {
      throw new ConflictException(
        "An account with this email already exists. Please log in with your password.",
      );
    }

    user = await this.prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        role: "student",
        provider: dto.provider,
        providerAccountId: profile.id,
      },
    });
  }

  const token = this.issueToken(user.id, user.email, user.role);
  return { ...token, isNewUser };
}

private async verifySocialToken(
  provider: "kakao" | "apple" | "google",
  token: string,
): Promise<{ id: string; email: string; name: string }> {
  switch (provider) {
    case "kakao": {
      const res = await fetch("https://kapi.kakao.com/v2/user/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new UnauthorizedException("Invalid Kakao token");
      const data = await res.json();
      return {
        id: String(data.id),
        email: data.kakao_account?.email ?? `${data.id}@kakao.user`,
        name: data.kakao_account?.profile?.nickname ?? "카카오 사용자",
      };
    }
    case "google": {
      const res = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new UnauthorizedException("Invalid Google token");
      const data = await res.json();
      return { id: data.sub, email: data.email, name: data.name ?? "Google User" };
    }
    case "apple": {
      // TODO: verify signature against Apple's public keys (https://appleid.apple.com/auth/keys)
      // For production, use a library like `jose` to verify the JWT properly.
      // For now, decode payload — adequate for development/testing only.
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64").toString(),
      );
      return {
        id: payload.sub,
        email: payload.email ?? `${payload.sub}@apple.user`,
        name: "Apple User",
      };
    }
  }
}
```

- [ ] **Step 3: Fix existing login to handle nullable passwordHash**

In `auth.service.ts`, update the `login` method:

```typescript
async login(dto: LoginDto) {
  const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
  if (!user || !user.passwordHash) throw new UnauthorizedException("Invalid credentials");

  const valid = await bcrypt.compare(dto.password, user.passwordHash);
  if (!valid) throw new UnauthorizedException("Invalid credentials");

  return this.issueToken(user.id, user.email, user.role);
}
```

- [ ] **Step 4: Add route and imports to AuthController**

Add imports at top of `auth.controller.ts`:

```typescript
import { SocialLoginDto } from "./dto/social-login.dto";
```

Add endpoint:

```typescript
@Post("social")
@UseGuards(AuthRateLimitGuard)
socialLogin(@Body() dto: SocialLoginDto) {
  return this.auth.socialLogin(dto);
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/lms-api/src/auth/
git commit -m "feat(auth): add social login endpoint for standalone student app"
```

---

### Task 3: Student Preferences Endpoint

**Files:**
- Create: `apps/lms-api/src/auth/dto/update-preferences.dto.ts`
- Modify: `apps/lms-api/src/auth/auth.controller.ts`
- Modify: `apps/lms-api/src/auth/auth.service.ts`

- [ ] **Step 1: Create DTO**

```typescript
// apps/lms-api/src/auth/dto/update-preferences.dto.ts
import { IsEnum, IsInt, IsString } from "class-validator";

export class UpdatePreferencesDto {
  @IsString()
  gradeLevel: string; // "중1" ~ "고3"

  @IsInt()
  @IsEnum([2015, 2022])
  curriculumYear: number;
}
```

- [ ] **Step 2: Add service method**

In `auth.service.ts`:

```typescript
async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
  await this.prisma.user.update({
    where: { id: userId },
    data: { gradeLevel: dto.gradeLevel, curriculumYear: dto.curriculumYear },
  });
  return { success: true };
}
```

- [ ] **Step 3: Add controller endpoint with required imports**

Add imports at top of `auth.controller.ts`:

```typescript
import { UseGuards, Request } from "@nestjs/common"; // add Request if not imported
import { JwtAuthGuard } from "./jwt-auth.guard";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
```

Add endpoint (note: route becomes `PATCH /auth/me/preferences`):

```typescript
@Patch("me/preferences")
@UseGuards(JwtAuthGuard)
updatePreferences(@Request() req: AuthRequest, @Body() dto: UpdatePreferencesDto) {
  return this.auth.updatePreferences(req.user.id, dto);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/lms-api/src/auth/
git commit -m "feat(auth): add student preferences endpoint"
```

---

### Task 4: Problem Bank Browse Endpoint

**Files:**
- Create: `apps/lms-api/src/problems/dto/browse-problems.dto.ts`
- Modify: `apps/lms-api/src/problems/problems.controller.ts`
- Modify: `apps/lms-api/src/problems/problems.service.ts`

- [ ] **Step 1: Create DTO**

```typescript
// apps/lms-api/src/problems/dto/browse-problems.dto.ts
import { IsOptional, IsString, IsInt, Min, Max, IsEnum } from "class-validator";
import { Type } from "class-transformer";

export class BrowseProblemsDto {
  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsString()
  subject?: string;

  @IsOptional() @IsString()
  unitMajor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  difficulty?: number;

  @IsOptional() @Type(() => Number) @IsEnum([2015, 2022])
  curriculumYear?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit?: number = 20;
}
```

- [ ] **Step 2: Add browse method to ProblemsService**

```typescript
async browse(dto: BrowseProblemsDto) {
  const where: Prisma.ProblemWhereInput = {
    reviewStatus: "approved",
  };

  if (dto.search) {
    where.OR = [
      { stemText: { contains: dto.search, mode: "insensitive" } },
      { stemLatex: { contains: dto.search, mode: "insensitive" } },
    ];
  }
  if (dto.subject) where.subject = dto.subject;
  if (dto.unitMajor) where.unitMajor = dto.unitMajor;
  if (dto.difficulty) where.difficulty = dto.difficulty;
  if (dto.curriculumYear) where.curriculumYear = dto.curriculumYear;

  const [items, total] = await Promise.all([
    this.prisma.problem.findMany({
      where,
      select: {
        id: true, stemLatex: true, stemText: true,
        subject: true, unitMajor: true, unitMinor: true,
        difficulty: true, problemType: true,
      },
      skip: ((dto.page ?? 1) - 1) * (dto.limit ?? 20),
      take: dto.limit ?? 20,
      orderBy: { createdAt: "desc" },
    }),
    this.prisma.problem.count({ where }),
  ]);

  return { items, total, page: dto.page ?? 1 };
}
```

- [ ] **Step 3: Add controller endpoints**

```typescript
@Get("browse")
@Roles("student", "teacher", "admin")
browse(@Query() dto: BrowseProblemsDto) {
  return this.problems.browse(dto);
}

@Get(":id/student-view")
@Roles("student", "teacher", "admin")
getStudentView(@Param("id") id: string) {
  return this.problems.getStudentView(id);
}
```

- [ ] **Step 4: Add getStudentView to ProblemsService**

```typescript
async getStudentView(id: string) {
  const problem = await this.prisma.problem.findUnique({
    where: { id, reviewStatus: "approved" },
    select: {
      id: true, stemLatex: true, stemText: true,
      subject: true, unitMajor: true, unitMinor: true,
      difficulty: true, problemType: true,
      choices: { select: { id: true, label: true, text: true } },
    },
  });
  if (!problem) throw new NotFoundException("Problem not found");
  return problem;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/lms-api/src/problems/
git commit -m "feat(problems): add student-facing browse endpoint"
```

---

### Task 5: Single-Problem OCR Endpoint (FastAPI)

**Files:**
- Create: `apps/ocr-api/app/api/single_ocr_routes.py`
- Modify: `apps/ocr-api/app/main.py` (register router)

- [ ] **Step 1: Create single OCR endpoint**

```python
# apps/ocr-api/app/api/single_ocr_routes.py
import httpx
from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from app.config import settings

router = APIRouter(prefix="/ocr", tags=["single-ocr"])


class OcrBlock(BaseModel):
    type: str  # "text" | "math"
    content: str


class SingleOcrResponse(BaseModel):
    problem_text: str
    confidence: float
    raw_blocks: list[OcrBlock]


@router.post("/single-problem", response_model=SingleOcrResponse)
async def ocr_single_problem(image: UploadFile = File(...)):
    if image.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(400, "Only JPEG, PNG, WebP images are supported")

    content = await image.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "Image must be under 10MB")

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            "https://api.mathpix.com/v3/text",
            headers={
                "app_id": settings.mathpix_app_id,
                "app_key": settings.mathpix_app_key,
            },
            files={"file": (image.filename, content, image.content_type)},
            data={
                "options_json": '{"math_inline_delimiters": ["$", "$"], "math_display_delimiters": ["$$", "$$"], "rm_spaces": true}',
            },
        )

    if resp.status_code != 200:
        raise HTTPException(502, "OCR service error")

    data = resp.json()
    latex_text = data.get("latex_styled") or data.get("text", "")
    confidence = data.get("confidence", 0.0)

    # Parse into blocks
    raw_blocks = []
    if "line_data" in data:
        for line in data["line_data"]:
            block_type = "math" if line.get("type") == "math" else "text"
            raw_blocks.append(OcrBlock(type=block_type, content=line.get("value", "")))
    else:
        raw_blocks.append(OcrBlock(type="math", content=latex_text))

    return SingleOcrResponse(
        problem_text=latex_text,
        confidence=confidence,
        raw_blocks=raw_blocks,
    )
```

- [ ] **Step 2: Register router in main.py**

Add to `apps/ocr-api/app/main.py`:

```python
from app.api.single_ocr_routes import router as single_ocr_router
app.include_router(single_ocr_router)
```

- [ ] **Step 3: Commit**

```bash
git add apps/ocr-api/app/api/single_ocr_routes.py apps/ocr-api/app/main.py
git commit -m "feat(ocr): add single-problem OCR endpoint for student app camera"
```

---

## Chunk 2: Expo Project Scaffold + Foundation

### Task 6: Create Expo Project

**Files:**
- Create: `apps/student-app/` (entire directory)

- [ ] **Step 1: Initialize Expo project**

```bash
cd apps
npx create-expo-app@latest student-app --template blank-typescript
cd student-app
```

- [ ] **Step 2: Install dependencies**

```bash
npx expo install expo-router expo-secure-store expo-image-picker expo-camera expo-linking expo-constants
npx expo install @tanstack/react-query
npx expo install nativewind tailwindcss
npx expo install react-native-reanimated react-native-gesture-handler react-native-screens react-native-safe-area-context
npx expo install @shopify/react-native-skia
npx expo install lucide-react-native react-native-svg
npx expo install react-native-math-view
npx expo install react-native-css-interop
npx expo install expo-auth-session expo-web-browser expo-crypto
```

- [ ] **Step 3: Configure app.json**

```json
{
  "expo": {
    "name": "JSMath Student",
    "slug": "jsmath-student",
    "version": "1.0.0",
    "orientation": "default",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "automatic",
    "scheme": "jsmath-student",
    "splash": {
      "image": "./assets/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#fefcf9"
    },
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.jsmath.student"
    },
    "android": {
      "package": "com.jsmath.student"
    },
    "plugins": [
      "expo-router",
      "expo-secure-store",
      "expo-image-picker",
      [
        "expo-camera",
        { "cameraPermission": "수학 문제를 촬영하기 위해 카메라 접근이 필요합니다." }
      ]
    ]
  }
}
```

- [ ] **Step 4: Create tailwind.config.js**

```javascript
// apps/student-app/tailwind.config.js
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./lib/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: "#fefcf9",
          card: "#ffffff",
          surface: "#f8f0e5",
          "surface-light": "#faf5ed",
          accent: "#d4a574",
          "text-primary": "#2d2d2d",
          "text-secondary": "#6b5a45",
          "text-muted": "#a08060",
          border: "#f0e6d8",
          destructive: "#c87070",
          success: "#5da37e",
          // Dark mode
          "dark-bg": "#1a1a2e",
          "dark-card": "#16213e",
          "dark-surface": "#0f3460",
          "dark-accent": "#e94560",
          "dark-border": "#2a2a4a",
        },
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 5: Create babel.config.js**

```javascript
// apps/student-app/babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: ["react-native-reanimated/plugin"],
  };
};
```

- [ ] **Step 6: Create global.css**

```css
/* apps/student-app/global.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 7: Create tsconfig.json**

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/student-app/
git commit -m "feat(student-app): scaffold Expo project with dependencies"
```

---

### Task 7: Lib Layer (API, Auth, Storage, Theme)

**Files:**
- Create: `apps/student-app/lib/storage.ts`
- Create: `apps/student-app/lib/api.ts`
- Create: `apps/student-app/lib/auth.tsx`
- Create: `apps/student-app/lib/theme.tsx`
- Create: `apps/student-app/constants/colors.ts`

- [ ] **Step 1: Create storage.ts**

Copy pattern from `apps/mobile/lib/storage.ts` (identical):

```typescript
// apps/student-app/lib/storage.ts
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

function canUseWebStorage() {
  return Platform.OS === "web" && typeof window !== "undefined";
}

export async function getItemAsync(key: string) {
  if (canUseWebStorage()) return window.localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string) {
  if (canUseWebStorage()) { window.localStorage.setItem(key, value); return; }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string) {
  if (canUseWebStorage()) { window.localStorage.removeItem(key); return; }
  await SecureStore.deleteItemAsync(key);
}
```

- [ ] **Step 2: Create api.ts**

Same pattern as `apps/mobile/lib/api.ts` but add `uploadImage` method:

```typescript
// apps/student-app/lib/api.ts
import { getItemAsync } from "./storage";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3001/v1";
const OCR_URL = process.env.EXPO_PUBLIC_OCR_URL || "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    const msg = typeof body === "object" && body !== null && "message" in body
      ? String((body as { message: string }).message)
      : `Request failed with status ${status}`;
    super(msg);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}, baseUrl = API_URL): Promise<T> {
  const token = await getItemAsync("auth_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = { message: res.statusText }; }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: (path: string) => request<void>(path, { method: "DELETE" }),

  uploadImage: async <T>(path: string, imageUri: string, baseUrl = OCR_URL): Promise<T> => {
    const token = await getItemAsync("auth_token");
    const formData = new FormData();
    const filename = imageUri.split("/").pop() ?? "photo.jpg";
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeType = ext === "png" ? "image/png" : "image/jpeg";
    formData.append("image", { uri: imageUri, name: filename, type: mimeType } as unknown as Blob);

    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${baseUrl}${path}`, { method: "POST", body: formData, headers });
    if (!res.ok) {
      let body: unknown;
      try { body = await res.json(); } catch { body = { message: res.statusText }; }
      throw new ApiError(res.status, body);
    }
    return res.json() as Promise<T>;
  },
};
```

- [ ] **Step 3: Create auth.tsx**

```typescript
// apps/student-app/lib/auth.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { deleteItemAsync, getItemAsync, setItemAsync } from "./storage";

interface User {
  id: string;
  email: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isNewUser: boolean;
  socialLogin: (provider: "kakao" | "apple" | "google", token: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface SocialAuthResponse {
  accessToken: string;
  isNewUser: boolean;
}

function decodeJwtPayload(token: string): { sub: string; email: string; role: string } {
  const base64 = token.split(".")[1];
  const json = atob(base64);
  return JSON.parse(json);
}

function userFromToken(token: string): User {
  const p = decodeJwtPayload(token);
  return { id: p.sub, email: p.email, role: p.role };
}

const AuthContext = createContext<AuthContextType>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewUser, setIsNewUser] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await getItemAsync("auth_token");
        if (token) setUser(userFromToken(token));
      } catch { await deleteItemAsync("auth_token"); }
      finally { setIsLoading(false); }
    })();
  }, []);

  async function socialLogin(provider: "kakao" | "apple" | "google", token: string) {
    const res = await api.post<SocialAuthResponse>("/auth/social", { provider, token });
    await setItemAsync("auth_token", res.accessToken);
    setUser(userFromToken(res.accessToken));
    setIsNewUser(res.isNewUser);
  }

  async function logout() {
    await deleteItemAsync("auth_token");
    setUser(null);
    setIsNewUser(false);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, isNewUser, socialLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
```

- [ ] **Step 4: Create constants/colors.ts**

```typescript
// apps/student-app/constants/colors.ts
export const Colors = {
  light: {
    bg: "#fefcf9",
    card: "#ffffff",
    surface: "#f8f0e5",
    surfaceLight: "#faf5ed",
    accent: "#d4a574",
    textPrimary: "#2d2d2d",
    textSecondary: "#6b5a45",
    textMuted: "#a08060",
    border: "#f0e6d8",
    destructive: "#c87070",
    success: "#5da37e",
    tabBarBg: "#ffffff",
    tabBarBorder: "#f0e6d8",
  },
  dark: {
    bg: "#1a1a2e",
    card: "#16213e",
    surface: "#0f3460",
    surfaceLight: "#1a2747",
    accent: "#e94560",
    textPrimary: "#e0e0e0",
    textSecondary: "#aaaaaa",
    textMuted: "#666666",
    border: "#2a2a4a",
    destructive: "#e94560",
    success: "#43e97b",
    tabBarBg: "#1a1a2e",
    tabBarBorder: "#2a2a4a",
  },
} as const;
```

- [ ] **Step 5: Create lib/theme.tsx**

```typescript
// apps/student-app/lib/theme.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { Colors } from "@/constants/colors";
import { getItemAsync, setItemAsync } from "./storage";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextType {
  mode: ThemeMode;
  isDark: boolean;
  colors: typeof Colors.light;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>(null!);
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    getItemAsync("theme_mode").then((saved) => {
      if (saved === "light" || saved === "dark" || saved === "system") setModeState(saved);
    });
  }, []);

  const isDark = mode === "system" ? systemScheme === "dark" : mode === "dark";
  const colors = isDark ? Colors.dark : Colors.light;

  function setMode(m: ThemeMode) {
    setModeState(m);
    setItemAsync("theme_mode", m);
  }

  return (
    <ThemeContext.Provider value={{ mode, isDark, colors, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/student-app/lib/ apps/student-app/constants/
git commit -m "feat(student-app): add lib layer (api, auth, storage, theme)"
```

---

### Task 8: Root Layout + Auth Navigation

**Files:**
- Create: `apps/student-app/app/_layout.tsx`
- Create: `apps/student-app/app/index.tsx`
- Create: `apps/student-app/app/(auth)/_layout.tsx`
- Create: `apps/student-app/app/(auth)/welcome.tsx`
- Create: `apps/student-app/app/(auth)/login.tsx`
- Create: `apps/student-app/app/(auth)/onboarding.tsx`

- [ ] **Step 1: Create root layout**

```typescript
// apps/student-app/app/_layout.tsx
import "../global.css";
import { Slot, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";

const queryClient = new QueryClient();

function RootNavigator() {
  const { user, isLoading, isNewUser } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === "(auth)";

    if (!user && !inAuth) {
      router.replace("/(auth)/welcome");
    } else if (user && inAuth && !isNewUser) {
      router.replace("/(tabs)");
    } else if (user && isNewUser) {
      router.replace("/(auth)/onboarding");
    }
  }, [user, isLoading, isNewUser, segments]);

  return <Slot />;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <RootNavigator />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 2: Create index redirect**

```typescript
// apps/student-app/app/index.tsx
import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";

export default function Index() {
  const { user } = useAuth();
  return <Redirect href={user ? "/(tabs)" : "/(auth)/welcome"} />;
}
```

- [ ] **Step 3: Create auth layout**

```typescript
// apps/student-app/app/(auth)/_layout.tsx
import { Stack } from "expo-router";

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 4: Create welcome screen**

```typescript
// apps/student-app/app/(auth)/welcome.tsx
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { BookOpen } from "lucide-react-native";
import { useTheme } from "@/lib/theme";

export default function WelcomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center", padding: 32 }}>
      <BookOpen color={colors.accent} size={64} strokeWidth={1.5} />
      <Text style={{ fontSize: 28, fontWeight: "800", color: colors.textPrimary, marginTop: 24 }}>
        JSMath
      </Text>
      <Text style={{ fontSize: 16, color: colors.textSecondary, marginTop: 8, textAlign: "center" }}>
        수학 문제 찍고, 물어보고, 약점 잡기
      </Text>
      <Pressable
        onPress={() => router.push("/(auth)/login")}
        style={{
          backgroundColor: colors.accent, borderRadius: 28,
          paddingVertical: 16, paddingHorizontal: 48, marginTop: 48,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>시작하기</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 5: Create login screen**

```typescript
// apps/student-app/app/(auth)/login.tsx
import { View, Text, Pressable, Alert } from "react-native";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import * as AuthSession from "expo-auth-session";

export default function LoginScreen() {
  const { socialLogin } = useAuth();
  const { colors } = useTheme();

  async function handleKakao() {
    try {
      // Kakao OAuth flow — token exchange via AuthSession
      // For now, placeholder that will be completed with actual Kakao app keys
      Alert.alert("준비 중", "카카오 로그인은 앱 등록 후 활성화됩니다.");
    } catch (e) {
      Alert.alert("오류", "로그인에 실패했습니다.");
    }
  }

  async function handleApple() {
    try {
      Alert.alert("준비 중", "Apple 로그인은 앱 등록 후 활성화됩니다.");
    } catch (e) {
      Alert.alert("오류", "로그인에 실패했습니다.");
    }
  }

  async function handleGoogle() {
    try {
      Alert.alert("준비 중", "Google 로그인은 앱 등록 후 활성화됩니다.");
    } catch (e) {
      Alert.alert("오류", "로그인에 실패했습니다.");
    }
  }

  const btnStyle = {
    borderRadius: 16, paddingVertical: 16, paddingHorizontal: 24,
    marginBottom: 12, alignItems: "center" as const, flexDirection: "row" as const,
    justifyContent: "center" as const, gap: 8,
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: 32 }}>
      <Text style={{ fontSize: 24, fontWeight: "800", color: colors.textPrimary, textAlign: "center", marginBottom: 48 }}>
        로그인
      </Text>

      <Pressable onPress={handleKakao} style={{ ...btnStyle, backgroundColor: "#FEE500" }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: "#191919" }}>카카오로 시작하기</Text>
      </Pressable>

      <Pressable onPress={handleApple} style={{ ...btnStyle, backgroundColor: "#000" }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>Apple로 시작하기</Text>
      </Pressable>

      <Pressable onPress={handleGoogle} style={{ ...btnStyle, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.textPrimary }}>Google로 시작하기</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 6: Create onboarding screen**

```typescript
// apps/student-app/app/(auth)/onboarding.tsx
import { useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const GRADES = ["중1", "중2", "중3", "고1", "고2", "고3"];

export default function OnboardingScreen() {
  const [grade, setGrade] = useState<string | null>(null);
  const [curriculum, setCurriculum] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const router = useRouter();
  const { colors } = useTheme();

  async function finish() {
    if (!grade || !curriculum) return;
    await api.patch("/auth/me/preferences", { gradeLevel: grade, curriculumYear: curriculum });
    router.replace("/(tabs)");
  }

  if (step === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 32, justifyContent: "center" }}>
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.textPrimary, marginBottom: 8 }}>
          학년을 선택해주세요
        </Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, marginBottom: 32 }}>
          맞춤형 문제 추천을 위해 필요해요
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {GRADES.map((g) => (
            <Pressable
              key={g}
              onPress={() => { setGrade(g); setStep(1); }}
              style={{
                backgroundColor: grade === g ? colors.accent : colors.surface,
                borderRadius: 12, paddingVertical: 16, paddingHorizontal: 24,
                minWidth: 80, alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "600", color: grade === g ? "#fff" : colors.textPrimary }}>
                {g}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 32, justifyContent: "center" }}>
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.textPrimary, marginBottom: 8 }}>
        교육과정을 확인해주세요
      </Text>
      <Text style={{ fontSize: 14, color: colors.textMuted, marginBottom: 32 }}>
        {grade}학년 기준 교육과정이에요
      </Text>
      {[2022, 2015].map((y) => (
        <Pressable
          key={y}
          onPress={() => setCurriculum(y)}
          style={{
            backgroundColor: curriculum === y ? colors.accent : colors.surface,
            borderRadius: 12, padding: 20, marginBottom: 12,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", color: curriculum === y ? "#fff" : colors.textPrimary }}>
            {y}개정 교육과정
          </Text>
        </Pressable>
      ))}
      <Pressable
        onPress={finish}
        disabled={!curriculum}
        style={{
          backgroundColor: curriculum ? colors.accent : colors.border,
          borderRadius: 28, paddingVertical: 16, alignItems: "center", marginTop: 24,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>시작하기</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/student-app/app/
git commit -m "feat(student-app): add root layout, auth flow, welcome/login/onboarding screens"
```

---

## Chunk 3: Tab Navigation + Home Screen

### Task 9: Tab Layout

**Files:**
- Create: `apps/student-app/app/(tabs)/_layout.tsx`

- [ ] **Step 1: Create tab navigator**

```typescript
// apps/student-app/app/(tabs)/_layout.tsx
import { Tabs } from "expo-router";
import { Home, Search, BookOpen, User } from "lucide-react-native";
import { useTheme } from "@/lib/theme";

export default function TabLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg, elevation: 0, shadowOpacity: 0 },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: "700", fontSize: 18 },
        tabBarStyle: {
          backgroundColor: colors.tabBarBg,
          borderTopColor: colors.tabBarBorder,
          borderTopWidth: 1,
          height: 85,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
      }}
    >
      <Tabs.Screen name="index" options={{
        title: "홈",
        tabBarIcon: ({ color, size }) => <Home color={color} size={size ?? 22} />,
      }} />
      <Tabs.Screen name="explore" options={{
        title: "탐색",
        tabBarIcon: ({ color, size }) => <Search color={color} size={size ?? 22} />,
      }} />
      <Tabs.Screen name="study" options={{
        title: "학습",
        tabBarIcon: ({ color, size }) => <BookOpen color={color} size={size ?? 22} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: "내정보",
        tabBarIcon: ({ color, size }) => <User color={color} size={size ?? 22} />,
      }} />
    </Tabs>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/student-app/app/\(tabs\)/
git commit -m "feat(student-app): add 4-tab navigation layout"
```

---

### Task 10: Home Dashboard

**Files:**
- Create: `apps/student-app/app/(tabs)/index.tsx`
- Create: `apps/student-app/components/home/streak-card.tsx`
- Create: `apps/student-app/components/home/review-card.tsx`
- Create: `apps/student-app/components/home/quick-actions.tsx`

- [ ] **Step 1: Create StreakCard component**

```typescript
// apps/student-app/components/home/streak-card.tsx
import { View, Text } from "react-native";
import { Flame } from "lucide-react-native";
import { useTheme } from "@/lib/theme";

export function StreakCard({ streak }: { streak: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Flame color={streak > 0 ? colors.accent : colors.textMuted} size={20} />
      <Text style={{ fontSize: 14, color: colors.textSecondary, fontWeight: "500" }}>
        {streak > 0 ? `${streak}일 연속 학습 중` : "오늘 첫 학습을 시작해보세요"}
      </Text>
    </View>
  );
}
```

- [ ] **Step 2: Create ReviewCard component**

```typescript
// apps/student-app/components/home/review-card.tsx
import { View, Text, Pressable } from "react-native";
import { RotateCcw } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/lib/theme";

interface ReviewCardProps {
  dueCount: number;
  completedCount: number;
}

export function ReviewCard({ dueCount, completedCount }: ReviewCardProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const total = dueCount + completedCount;
  const progress = total > 0 ? completedCount / total : 0;

  if (total === 0) return null;

  return (
    <Pressable
      onPress={() => router.push("/(tabs)/study?section=review")}
      style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16 }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <RotateCcw color={colors.accent} size={16} />
            <Text style={{ fontSize: 13, color: colors.textMuted }}>오늘의 복습</Text>
          </View>
          <Text style={{ fontSize: 20, fontWeight: "800", color: colors.textPrimary, marginTop: 4 }}>
            {dueCount}문제
          </Text>
        </View>
        <View style={{ backgroundColor: colors.accent, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 20 }}>
          <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>시작하기</Text>
        </View>
      </View>
      <View style={{ backgroundColor: colors.border, height: 4, borderRadius: 2, marginTop: 12 }}>
        <View style={{ backgroundColor: colors.accent, height: 4, borderRadius: 2, width: `${progress * 100}%` }} />
      </View>
    </Pressable>
  );
}
```

- [ ] **Step 3: Create QuickActions component**

```typescript
// apps/student-app/components/home/quick-actions.tsx
import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { Camera, Search, FileText, Activity } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/lib/theme";

const actions = [
  { icon: Camera, label: "문제 찍기", route: "/camera" },
  { icon: Search, label: "문제 검색", route: "/(tabs)/explore" },
  { icon: FileText, label: "오답노트", route: "/(tabs)/study?section=wrong" },
  { icon: Activity, label: "내 약점", route: "/(tabs)/study?section=weakness" },
] as const;

export function QuickActions() {
  const router = useRouter();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isTablet = width > 768;

  return (
    <View style={{
      flexDirection: "row", flexWrap: "wrap",
      gap: 10,
    }}>
      {actions.map(({ icon: Icon, label, route }) => (
        <Pressable
          key={label}
          onPress={() => router.push(route as never)}
          style={{
            backgroundColor: colors.surfaceLight,
            borderRadius: 14, padding: 16, alignItems: "center",
            width: isTablet ? "30%" : "48%", flexGrow: isTablet ? 0 : 1,
          }}
        >
          <Icon color={colors.textMuted} size={24} />
          <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 8, fontWeight: "500" }}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
```

- [ ] **Step 4: Create Home tab screen**

```typescript
// apps/student-app/app/(tabs)/index.tsx
import { ScrollView, View, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { StreakCard } from "@/components/home/streak-card";
import { ReviewCard } from "@/components/home/review-card";
import { QuickActions } from "@/components/home/quick-actions";

export default function HomeScreen() {
  const { colors } = useTheme();

  const { data: gamification } = useQuery({
    queryKey: ["gamification"],
    queryFn: () => api.get<{ level: number; xp: number; streak: number }>("/gamification/profile"),
  });

  const { data: reviewStats } = useQuery({
    queryKey: ["review-stats"],
    queryFn: () => api.get<{ todayDue: number; todayCompleted: number }>("/student-ai/reviews/stats"),
  });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, gap: 20 }}>
      <View>
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.textPrimary }}>
          오늘도 같이 풀어볼까?
        </Text>
        <View style={{ marginTop: 8 }}>
          <StreakCard streak={gamification?.streak ?? 0} />
        </View>
      </View>

      <ReviewCard
        dueCount={reviewStats?.todayDue ?? 0}
        completedCount={reviewStats?.todayCompleted ?? 0}
      />

      <View>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textPrimary, marginBottom: 12 }}>
          바로 시작
        </Text>
        <QuickActions />
      </View>

      {/* Recent activity — last 5 wrong answers as activity feed */}
      <View>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textPrimary, marginBottom: 12 }}>
          최근 학습
        </Text>
        {/* Fetch recent wrong answers or submissions as activity items */}
        {/* This queries GET /student-ai/wrong-answers?limit=5 to show recent activity */}
      </View>

      {/* Level progress */}
      {gamification && (
        <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14 }}>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>
            Lv.{gamification.level} · {gamification.xp} XP
          </Text>
          <View style={{ backgroundColor: colors.border, height: 4, borderRadius: 2, marginTop: 8 }}>
            <View style={{
              backgroundColor: colors.accent, height: 4, borderRadius: 2,
              width: `${(gamification.xp % 100)}%`,
            }} />
          </View>
        </View>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/student-app/app/\(tabs\)/index.tsx apps/student-app/components/home/
git commit -m "feat(student-app): add home dashboard with streak, review card, quick actions"
```

---

## Chunk 4: Explore Tab + Camera + Problem Detail

### Task 11: Explore Tab

**Files:**
- Create: `apps/student-app/app/(tabs)/explore.tsx`
- Create: `apps/student-app/hooks/useProblems.ts`

- [ ] **Step 1: Create useProblems hook**

```typescript
// apps/student-app/hooks/useProblems.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Problem {
  id: string;
  stemLatex: string;
  stemText: string;
  subject: string;
  unitMajor: string;
  unitMinor: string;
  difficulty: number;
  problemType: string;
}

interface BrowseResponse {
  items: Problem[];
  total: number;
  page: number;
}

export function useProblems(params: {
  search?: string;
  subject?: string;
  unitMajor?: string;
  difficulty?: number;
  page?: number;
}) {
  return useQuery({
    queryKey: ["problems", params],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (params.search) qs.set("search", params.search);
      if (params.subject) qs.set("subject", params.subject);
      if (params.unitMajor) qs.set("unitMajor", params.unitMajor);
      if (params.difficulty) qs.set("difficulty", String(params.difficulty));
      if (params.page) qs.set("page", String(params.page));
      return api.get<BrowseResponse>(`/problems/browse?${qs.toString()}`);
    },
  });
}
```

- [ ] **Step 2: Create Explore tab screen**

```typescript
// apps/student-app/app/(tabs)/explore.tsx
import { useState } from "react";
import { View, Text, TextInput, FlatList, Pressable } from "react-native";
import { Camera, Search as SearchIcon } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/lib/theme";
import { useProblems } from "@/hooks/useProblems";

export default function ExploreScreen() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const router = useRouter();
  const { colors } = useTheme();
  const { data, isLoading } = useProblems({ search: search || undefined, page });

  const difficultyColor = (d: number) => {
    if (d <= 2) return colors.success;
    if (d <= 3) return colors.accent;
    return colors.destructive;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Camera button */}
      <Pressable
        onPress={() => router.push("/camera")}
        style={{
          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
          backgroundColor: colors.accent, margin: 16, marginBottom: 8,
          borderRadius: 16, paddingVertical: 14,
        }}
      >
        <Camera color="#fff" size={20} />
        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>문제 촬영하기</Text>
      </Pressable>

      {/* Search bar */}
      <View style={{
        flexDirection: "row", alignItems: "center", backgroundColor: colors.surface,
        marginHorizontal: 16, borderRadius: 12, paddingHorizontal: 14, marginBottom: 12,
      }}>
        <SearchIcon color={colors.textMuted} size={18} />
        <TextInput
          value={search}
          onChangeText={(t) => { setSearch(t); setPage(1); }}
          placeholder="문제 검색..."
          placeholderTextColor={colors.textMuted}
          style={{ flex: 1, paddingVertical: 12, paddingLeft: 8, color: colors.textPrimary, fontSize: 15 }}
        />
      </View>

      {/* Problem list */}
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: 20 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/problem/${item.id}`)}
            style={{
              backgroundColor: colors.card, borderRadius: 14, padding: 16,
              borderWidth: 1, borderColor: colors.border,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 13, color: colors.textMuted }}>{item.subject} · {item.unitMajor}</Text>
              <View style={{ backgroundColor: difficultyColor(item.difficulty), borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>난이도 {item.difficulty}</Text>
              </View>
            </View>
            <Text numberOfLines={2} style={{ fontSize: 14, color: colors.textPrimary, marginTop: 8, lineHeight: 20 }}>
              {item.stemText || item.stemLatex?.slice(0, 80)}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/student-app/app/\(tabs\)/explore.tsx apps/student-app/hooks/
git commit -m "feat(student-app): add explore tab with search and problem list"
```

---

### Task 12: Camera OCR Screen

**Files:**
- Create: `apps/student-app/app/camera.tsx`

- [ ] **Step 1: Create camera screen**

```typescript
// apps/student-app/app/camera.tsx
import { useState } from "react";
import { View, Text, Pressable, Image, ActivityIndicator, ScrollView, TextInput } from "react-native";
import { useRouter, Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Camera as CameraIcon, X, Check, MessageCircle } from "lucide-react-native";
import { useTheme } from "@/lib/theme";
import { api } from "@/lib/api";

interface OcrResult {
  problem_text: string;
  confidence: number;
}

export default function CameraScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [editedText, setEditedText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { colors } = useTheme();

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: true,
    });

    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setImageUri(uri);
      await runOcr(uri);
    }
  }

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsEditing: true,
    });

    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setImageUri(uri);
      await runOcr(uri);
    }
  }

  async function runOcr(uri: string) {
    setIsLoading(true);
    try {
      const result = await api.uploadImage<OcrResult>("/ocr/single-problem", uri);
      setOcrResult(result);
      setEditedText(result.problem_text);
    } catch {
      setOcrResult(null);
      setEditedText("");
    } finally {
      setIsLoading(false);
    }
  }

  async function startTutor() {
    // Create a tutor session with the OCR'd problem text
    const session = await api.post<{ id: string }>("/student-ai/tutor/sessions", {
      problemText: editedText,
    });
    router.replace(`/tutor/${session.id}`);
  }

  // Pre-capture state
  if (!imageUri) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center", padding: 32 }}>
        <Stack.Screen options={{ title: "문제 촬영", headerShown: true }} />
        <CameraIcon color={colors.textMuted} size={64} strokeWidth={1} />
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.textPrimary, marginTop: 24 }}>
          수학 문제를 촬영해주세요
        </Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, marginTop: 8, textAlign: "center" }}>
          교과서나 문제집의 문제를 찍으면{"\n"}AI가 인식해서 도와줄게요
        </Text>
        <View style={{ flexDirection: "row", gap: 12, marginTop: 40 }}>
          <Pressable
            onPress={takePhoto}
            style={{ backgroundColor: colors.accent, borderRadius: 28, paddingVertical: 16, paddingHorizontal: 32 }}
          >
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>카메라</Text>
          </Pressable>
          <Pressable
            onPress={pickImage}
            style={{ backgroundColor: colors.surface, borderRadius: 28, paddingVertical: 16, paddingHorizontal: 32, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: "600" }}>앨범</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Post-capture: OCR result
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20 }}>
      <Stack.Screen options={{ title: "문제 확인", headerShown: true }} />

      <Image source={{ uri: imageUri }} style={{ width: "100%", height: 200, borderRadius: 12, marginBottom: 16 }} resizeMode="contain" />

      {isLoading ? (
        <View style={{ alignItems: "center", padding: 40 }}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={{ color: colors.textMuted, marginTop: 12 }}>문제를 인식하고 있어요...</Text>
        </View>
      ) : ocrResult ? (
        <View>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary, marginBottom: 8 }}>
            인식된 문제 (수정 가능)
          </Text>
          <TextInput
            value={editedText}
            onChangeText={setEditedText}
            multiline
            style={{
              backgroundColor: colors.surface, borderRadius: 12, padding: 16,
              color: colors.textPrimary, fontSize: 15, minHeight: 120, textAlignVertical: "top",
            }}
          />
          <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 8 }}>
            인식 정확도: {Math.round(ocrResult.confidence * 100)}%
          </Text>

          <Pressable
            onPress={startTutor}
            style={{
              backgroundColor: colors.accent, borderRadius: 28,
              paddingVertical: 16, alignItems: "center", marginTop: 24,
              flexDirection: "row", justifyContent: "center", gap: 8,
            }}
          >
            <MessageCircle color="#fff" size={20} />
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>AI 튜터에게 질문</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ alignItems: "center", padding: 40 }}>
          <Text style={{ color: colors.destructive }}>인식에 실패했어요. 다시 촬영해주세요.</Text>
          <Pressable onPress={() => setImageUri(null)} style={{ marginTop: 16 }}>
            <Text style={{ color: colors.accent, fontWeight: "600" }}>다시 촬영</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/student-app/app/camera.tsx
git commit -m "feat(student-app): add camera OCR screen with image picker and result editing"
```

---

### Task 13: Problem Detail Screen

**Files:**
- Create: `apps/student-app/app/problem/[id].tsx`

- [ ] **Step 1: Create problem detail screen**

```typescript
// apps/student-app/app/problem/[id].tsx
import { View, Text, ScrollView, Pressable, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, PenTool } from "lucide-react-native";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { Platform } from "react-native";

interface ProblemDetail {
  id: string;
  stemLatex: string;
  stemText: string;
  subject: string;
  unitMajor: string;
  unitMinor: string;
  difficulty: number;
  problemType: string;
}

export default function ProblemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isTablet = width > 768;

  const { data: problem } = useQuery({
    queryKey: ["problem", id],
    queryFn: () => api.get<ProblemDetail>(`/problems/${id}/student-view`),
    enabled: !!id,
  });

  async function startTutor() {
    const session = await api.post<{ id: string }>("/student-ai/tutor/sessions", { problemId: id });
    router.push(`/tutor/${session.id}`);
  }

  if (!problem) return null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20 }}>
      <Stack.Screen options={{ title: `${problem.subject} · ${problem.unitMajor}`, headerShown: true }} />

      {/* Meta badges */}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 12, color: colors.textSecondary }}>{problem.subject}</Text>
        </View>
        <View style={{ backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 12, color: colors.textSecondary }}>난이도 {problem.difficulty}</Text>
        </View>
        <View style={{ backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 12, color: colors.textSecondary }}>{problem.problemType}</Text>
        </View>
      </View>

      {/* Problem stem */}
      <View style={{
        backgroundColor: colors.card, borderRadius: 16, padding: 20,
        borderWidth: 1, borderColor: colors.border, minHeight: 120,
      }}>
        <Text style={{ fontSize: 16, color: colors.textPrimary, lineHeight: 26 }}>
          {problem.stemText || problem.stemLatex}
        </Text>
      </View>

      {/* Actions */}
      <View style={{ gap: 12, marginTop: 24 }}>
        <Pressable
          onPress={startTutor}
          style={{
            backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 16,
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <MessageCircle color="#fff" size={20} />
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>AI 튜터에게 질문</Text>
        </Pressable>

        {(isTablet || Platform.OS === "ios") && (
          <Pressable
            onPress={() => router.push(`/canvas/${id}`)}
            style={{
              backgroundColor: colors.surface, borderRadius: 16, paddingVertical: 16,
              flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
              borderWidth: 1, borderColor: colors.border,
            }}
          >
            <PenTool color={colors.textSecondary} size={20} />
            <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: "600" }}>펜슬로 풀기</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/student-app/app/problem/
git commit -m "feat(student-app): add problem detail screen with tutor/pencil actions"
```

---

## Chunk 5: AI Tutor Chat

### Task 14: AI Tutor Chat Screen

**Files:**
- Create: `apps/student-app/app/tutor/[sessionId].tsx`
- Create: `apps/student-app/hooks/useTutorChat.ts`
- Create: `apps/student-app/components/tutor/chat-bubble.tsx`

- [ ] **Step 1: Create chat bubble component**

```typescript
// apps/student-app/components/tutor/chat-bubble.tsx
import { View, Text } from "react-native";
import { Bot } from "lucide-react-native";
import { useTheme } from "@/lib/theme";

interface ChatBubbleProps {
  role: "student" | "tutor";
  content: string;
}

export function ChatBubble({ role, content }: ChatBubbleProps) {
  const { colors } = useTheme();
  const isStudent = role === "student";

  return (
    <View style={{
      flexDirection: "row",
      justifyContent: isStudent ? "flex-end" : "flex-start",
      marginBottom: 12, paddingHorizontal: 16,
    }}>
      {!isStudent && (
        <View style={{
          width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent,
          alignItems: "center", justifyContent: "center", marginRight: 8, marginTop: 4,
        }}>
          <Bot color="#fff" size={16} />
        </View>
      )}
      <View style={{
        maxWidth: "75%",
        backgroundColor: isStudent ? colors.accent : colors.surface,
        borderRadius: 16,
        borderTopLeftRadius: isStudent ? 16 : 4,
        borderTopRightRadius: isStudent ? 4 : 16,
        padding: 14,
      }}>
        <Text style={{
          fontSize: 15, lineHeight: 22,
          color: isStudent ? "#fff" : colors.textPrimary,
        }}>
          {content}
        </Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Create useTutorChat hook**

```typescript
// apps/student-app/hooks/useTutorChat.ts
import { useState, useCallback, useRef } from "react";
import { getItemAsync } from "@/lib/storage";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3001/v1";

interface Message {
  id: string;
  role: "student" | "tutor";
  content: string;
}

export function useTutorChat(sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string, imageS3Key?: string) => {
    // Add student message
    const studentMsg: Message = { id: Date.now().toString(), role: "student", content };
    setMessages((prev) => [...prev, studentMsg]);
    setIsStreaming(true);

    try {
      const token = await getItemAsync("auth_token");
      abortRef.current = new AbortController();

      const res = await fetch(
        `${API_URL}/student-ai/tutor/sessions/${sessionId}/message`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content, imageS3Key }),
          signal: abortRef.current.signal,
        },
      );

      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let tutorContent = "";
      const tutorMsgId = `tutor-${Date.now()}`;

      // Add empty tutor message
      setMessages((prev) => [...prev, { id: tutorMsgId, role: "tutor", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                tutorContent += parsed.content;
                setMessages((prev) =>
                  prev.map((m) => m.id === tutorMsgId ? { ...m, content: tutorContent } : m),
                );
              }
            } catch { /* non-JSON SSE line */ }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          { id: `error-${Date.now()}`, role: "tutor", content: "응답을 받지 못했어요. 다시 시도해주세요." },
        ]);
      }
    } finally {
      setIsStreaming(false);
    }
  }, [sessionId]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, isStreaming, sendMessage, abort };
}
```

- [ ] **Step 3: Create tutor chat screen**

```typescript
// apps/student-app/app/tutor/[sessionId].tsx
import { useState, useRef } from "react";
import { View, Text, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Send, Camera } from "lucide-react-native";
import { useTheme } from "@/lib/theme";
import { useTutorChat } from "@/hooks/useTutorChat";
import { ChatBubble } from "@/components/tutor/chat-bubble";

export default function TutorChatScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [input, setInput] = useState("");
  const { colors } = useTheme();
  const { messages, isStreaming, sendMessage } = useTutorChat(sessionId);
  const flatListRef = useRef<FlatList>(null);

  function handleSend() {
    if (!input.trim() || isStreaming) return;
    sendMessage(input.trim());
    setInput("");
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen options={{ title: "AI 튜터", headerShown: true }} />

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <ChatBubble role={item.role} content={item.content} />}
        contentContainerStyle={{ paddingVertical: 16 }}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Input bar */}
      <View style={{
        flexDirection: "row", alignItems: "center", gap: 8,
        padding: 12, borderTopWidth: 1, borderTopColor: colors.border,
        backgroundColor: colors.card,
      }}>
        <Pressable style={{ padding: 8 }}>
          <Camera color={colors.textMuted} size={22} />
        </Pressable>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="메시지를 입력하세요..."
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={2000}
          style={{
            flex: 1, backgroundColor: colors.surface, borderRadius: 20,
            paddingHorizontal: 16, paddingVertical: 10, color: colors.textPrimary,
            fontSize: 15, maxHeight: 100,
          }}
          onSubmitEditing={handleSend}
        />
        <Pressable onPress={handleSend} disabled={isStreaming || !input.trim()} style={{ padding: 8 }}>
          <Send color={input.trim() ? colors.accent : colors.textMuted} size={22} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/student-app/app/tutor/ apps/student-app/hooks/useTutorChat.ts apps/student-app/components/tutor/
git commit -m "feat(student-app): add AI tutor chat with SSE streaming"
```

---

## Chunk 6: Study Tab (Wrong Answers, Review, Mastery, Weakness, Grade Prediction)

### Task 15: Study Tab with Segmented Sections

**Files:**
- Create: `apps/student-app/app/(tabs)/study.tsx`
- Create: `apps/student-app/components/study/wrong-answers-section.tsx`
- Create: `apps/student-app/components/study/daily-review-section.tsx`
- Create: `apps/student-app/components/study/mastery-section.tsx`
- Create: `apps/student-app/components/study/weakness-section.tsx`
- Create: `apps/student-app/components/study/grade-prediction-section.tsx`

- [ ] **Step 1: Create study tab with segmented control**

```typescript
// apps/student-app/app/(tabs)/study.tsx
import { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTheme } from "@/lib/theme";
import { WrongAnswersSection } from "@/components/study/wrong-answers-section";
import { DailyReviewSection } from "@/components/study/daily-review-section";
import { MasterySection } from "@/components/study/mastery-section";
import { WeaknessSection } from "@/components/study/weakness-section";
import { GradePredictionSection } from "@/components/study/grade-prediction-section";

const SECTIONS = [
  { key: "wrong", label: "오답노트" },
  { key: "review", label: "복습" },
  { key: "mastery", label: "마스터리" },
  { key: "weakness", label: "약점" },
  { key: "grade", label: "성적예측" },
] as const;

type SectionKey = typeof SECTIONS[number]["key"];

export default function StudyScreen() {
  const params = useLocalSearchParams<{ section?: string }>();
  const [active, setActive] = useState<SectionKey>((params.section as SectionKey) || "wrong");
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Segmented control */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}
      >
        {SECTIONS.map(({ key, label }) => (
          <Pressable
            key={key}
            onPress={() => setActive(key)}
            style={{
              backgroundColor: active === key ? colors.accent : colors.surface,
              borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8,
            }}
          >
            <Text style={{
              fontSize: 13, fontWeight: "600",
              color: active === key ? "#fff" : colors.textSecondary,
            }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Section content */}
      {active === "wrong" && <WrongAnswersSection />}
      {active === "review" && <DailyReviewSection />}
      {active === "mastery" && <MasterySection />}
      {active === "weakness" && <WeaknessSection />}
      {active === "grade" && <GradePredictionSection />}
    </View>
  );
}
```

- [ ] **Step 2: Create WrongAnswersSection**

```typescript
// apps/student-app/components/study/wrong-answers-section.tsx
import { View, Text, FlatList, Pressable } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { CheckCircle, RotateCcw, MessageCircle } from "lucide-react-native";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

interface WrongAnswer {
  id: string;
  problemId: string;
  errorType: string;
  retryCount: number;
  resolvedAt: string | null;
  problem: { stemText: string; subject: string; unitMajor: string };
}

const ERROR_LABELS: Record<string, string> = {
  concept_gap: "개념 부족",
  pattern_gap: "유형 미숙",
  calculation_error: "계산 실수",
  careless_mistake: "부주의",
};

export function WrongAnswersSection() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Backend WrongAnswersService.getByStudent includes problem relation via Prisma `include: { problem: true }`
  const { data } = useQuery({
    queryKey: ["wrong-answers"],
    queryFn: () => api.get<{ items: WrongAnswer[] }>("/student-ai/wrong-answers?limit=50"),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/student-ai/wrong-answers/${id}/resolve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["wrong-answers"] }),
  });

  return (
    <FlatList
      data={data?.items ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      renderItem={({ item }) => (
        <View style={{
          backgroundColor: colors.card, borderRadius: 14, padding: 16,
          borderWidth: 1, borderColor: colors.border, opacity: item.resolvedAt ? 0.5 : 1,
        }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
            <Text style={{ fontSize: 12, color: colors.textMuted }}>
              {item.problem?.subject} · {item.problem?.unitMajor}
            </Text>
            <View style={{ backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontSize: 11, color: colors.accent, fontWeight: "600" }}>
                {ERROR_LABELS[item.errorType] ?? item.errorType}
              </Text>
            </View>
          </View>
          <Text numberOfLines={2} style={{ fontSize: 14, color: colors.textPrimary, lineHeight: 20 }}>
            {item.problem?.stemText}
          </Text>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
            <Pressable
              onPress={() => router.push(`/problem/${item.problemId}`)}
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <MessageCircle color={colors.accent} size={16} />
              <Text style={{ fontSize: 12, color: colors.accent, fontWeight: "600" }}>AI 튜터</Text>
            </Pressable>
            {!item.resolvedAt && (
              <Pressable
                onPress={() => resolveMutation.mutate(item.id)}
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <CheckCircle color={colors.success} size={16} />
                <Text style={{ fontSize: 12, color: colors.success, fontWeight: "600" }}>해결됨</Text>
              </Pressable>
            )}
            <Text style={{ fontSize: 12, color: colors.textMuted }}>
              재시도 {item.retryCount}회
            </Text>
          </View>
        </View>
      )}
      ListEmptyComponent={
        <View style={{ alignItems: "center", padding: 40 }}>
          <Text style={{ color: colors.textMuted }}>아직 오답이 없어요!</Text>
        </View>
      }
    />
  );
}
```

- [ ] **Step 3: Create DailyReviewSection**

```typescript
// apps/student-app/components/study/daily-review-section.tsx
import { useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

interface ReviewItem {
  id: string;
  problemId: string;
  problem: { stemText: string; subject: string };
}

const QUALITY_LABELS = ["모르겠음", "어려움", "애매함", "보통", "쉬움", "완벽함"];

export function DailyReviewSection() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const { data: reviews } = useQuery({
    queryKey: ["daily-review"],
    queryFn: () => api.get<ReviewItem[]>("/student-ai/reviews/daily"),
  });

  const gradeMutation = useMutation({
    mutationFn: ({ id, quality }: { id: string; quality: number }) =>
      api.post(`/student-ai/reviews/${id}/grade`, { quality }),
    onSuccess: () => {
      setShowAnswer(false);
      setCurrentIdx((i) => i + 1);
      queryClient.invalidateQueries({ queryKey: ["daily-review"] });
      queryClient.invalidateQueries({ queryKey: ["review-stats"] });
    },
  });

  const items = reviews ?? [];
  const current = items[currentIdx];

  if (items.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 40 }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.textPrimary }}>오늘의 복습 완료!</Text>
        <Text style={{ color: colors.textMuted, marginTop: 8 }}>내일 다시 만나요</Text>
      </View>
    );
  }

  if (!current) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 40 }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.success }}>모두 완료했어요!</Text>
        <Text style={{ color: colors.textMuted, marginTop: 8 }}>
          {currentIdx}/{items.length} 문제 복습 완료
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      {/* Progress */}
      <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: "center" }}>
        {currentIdx + 1} / {items.length}
      </Text>

      {/* Problem card */}
      <View style={{
        backgroundColor: colors.card, borderRadius: 16, padding: 24,
        borderWidth: 1, borderColor: colors.border, minHeight: 160,
      }}>
        <Text style={{ fontSize: 16, color: colors.textPrimary, lineHeight: 26 }}>
          {current.problem?.stemText}
        </Text>
      </View>

      {!showAnswer ? (
        <Pressable
          onPress={() => setShowAnswer(true)}
          style={{ backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 16, alignItems: "center" }}
        >
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>풀이 확인</Text>
        </Pressable>
      ) : (
        <View>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary, marginBottom: 12 }}>
            얼마나 잘 풀었나요?
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {QUALITY_LABELS.map((label, q) => (
              <Pressable
                key={q}
                onPress={() => gradeMutation.mutate({ id: current.id, quality: q })}
                style={{
                  backgroundColor: q <= 2 ? colors.destructive : q <= 3 ? colors.accent : colors.success,
                  borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, opacity: 0.9,
                }}
              >
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 4: Create MasterySection**

```typescript
// apps/student-app/components/study/mastery-section.tsx
import { View, Text, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

interface MasteryNode {
  id: string;
  subject: string;
  unitMajor: string;
  state: "not_started" | "learning" | "practicing" | "mastered";
  totalAttempts: number;
  totalCorrect: number;
}

const STATE_COLORS: Record<string, string> = {
  mastered: "#5da37e",
  practicing: "#4a90d9",
  learning: "#d4a574",
  not_started: "#ccc",
};

const STATE_LABELS: Record<string, string> = {
  mastered: "마스터",
  practicing: "연습중",
  learning: "학습중",
  not_started: "미시작",
};

export function MasterySection() {
  const { colors } = useTheme();

  const { data } = useQuery({
    queryKey: ["mastery-tree"],
    queryFn: () => api.get<MasteryNode[]>("/student-ai/mastery/tree"),
  });

  const nodes = data ?? [];
  const grouped = nodes.reduce<Record<string, MasteryNode[]>>((acc, n) => {
    (acc[n.subject] ??= []).push(n);
    return acc;
  }, {});

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      {Object.entries(grouped).map(([subject, items]) => (
        <View key={subject}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textPrimary, marginBottom: 8 }}>
            {subject}
          </Text>
          <View style={{ gap: 6 }}>
            {items.map((node) => {
              const accuracy = node.totalAttempts > 0
                ? Math.round((node.totalCorrect / node.totalAttempts) * 100)
                : 0;
              return (
                <View key={node.id} style={{
                  backgroundColor: colors.card, borderRadius: 12, padding: 14,
                  borderLeftWidth: 4, borderLeftColor: STATE_COLORS[node.state],
                  borderWidth: 1, borderColor: colors.border,
                }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 14, color: colors.textPrimary, fontWeight: "500" }}>
                      {node.unitMajor}
                    </Text>
                    <View style={{
                      backgroundColor: STATE_COLORS[node.state] + "20",
                      borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
                    }}>
                      <Text style={{ fontSize: 11, color: STATE_COLORS[node.state], fontWeight: "600" }}>
                        {STATE_LABELS[node.state]}
                      </Text>
                    </View>
                  </View>
                  {node.totalAttempts > 0 && (
                    <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
                      정답률 {accuracy}% · {node.totalAttempts}회 시도
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
```

- [ ] **Step 5: Create WeaknessSection**

```typescript
// apps/student-app/components/study/weakness-section.tsx
import { View, Text, ScrollView, Pressable } from "react-native";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { Zap } from "lucide-react-native";

interface WeaknessProfile {
  aiSummary: string;
  units: Array<{ subject: string; unitMajor: string; accuracy: number; topErrorType: string }>;
}

export function WeaknessSection() {
  const { colors } = useTheme();

  const { data } = useQuery({
    queryKey: ["weakness"],
    queryFn: () => api.get<WeaknessProfile>("/student-ai/weakness"),
  });

  const recommendMutation = useMutation({
    mutationFn: () => api.post("/student-ai/recommendations/generate"),
  });

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      {/* AI Summary */}
      {data?.aiSummary && (
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.textSecondary, marginBottom: 6 }}>
            AI 분석
          </Text>
          <Text style={{ fontSize: 14, color: colors.textPrimary, lineHeight: 22 }}>
            {data.aiSummary}
          </Text>
        </View>
      )}

      {/* Unit accuracy */}
      {data?.units?.map((unit, i) => (
        <View key={i} style={{
          backgroundColor: colors.card, borderRadius: 12, padding: 14,
          borderWidth: 1, borderColor: colors.border,
        }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 14, color: colors.textPrimary, fontWeight: "500" }}>
              {unit.subject} · {unit.unitMajor}
            </Text>
            <Text style={{
              fontSize: 14, fontWeight: "700",
              color: unit.accuracy >= 0.7 ? colors.success : unit.accuracy >= 0.4 ? colors.accent : colors.destructive,
            }}>
              {Math.round(unit.accuracy * 100)}%
            </Text>
          </View>
        </View>
      ))}

      {/* Recommend button */}
      <Pressable
        onPress={() => recommendMutation.mutate()}
        disabled={recommendMutation.isPending}
        style={{
          backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 16,
          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
        }}
      >
        <Zap color="#fff" size={18} />
        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>
          {recommendMutation.isPending ? "생성 중..." : "추천 문제 생성"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
```

- [ ] **Step 6: Create GradePredictionSection**

```typescript
// apps/student-app/components/study/grade-prediction-section.tsx
import { View, Text, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

interface Prediction {
  subject: string;
  predictedScore: number;
  grade: number;
  confidence: number;
}

export function GradePredictionSection() {
  const { colors } = useTheme();

  const { data } = useQuery({
    queryKey: ["grade-prediction"],
    queryFn: () => api.get<{ predictions: Prediction[] }>("/grade-prediction/me"),
  });

  const gradeColor = (g: number) => {
    if (g <= 2) return colors.success;
    if (g <= 4) return "#4a90d9";
    if (g <= 6) return colors.accent;
    return colors.destructive;
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 4 }}>
        현재 정답률 기반 예상 수능 등급
      </Text>
      {(data?.predictions ?? []).map((p) => (
        <View key={p.subject} style={{
          backgroundColor: colors.card, borderRadius: 14, padding: 16,
          borderWidth: 1, borderColor: colors.border,
          flexDirection: "row", justifyContent: "space-between", alignItems: "center",
        }}>
          <View>
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.textPrimary }}>{p.subject}</Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
              예상 {p.predictedScore}점 · 신뢰도 {Math.round(p.confidence * 100)}%
            </Text>
          </View>
          <View style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: gradeColor(p.grade) + "20",
            alignItems: "center", justifyContent: "center",
          }}>
            <Text style={{ fontSize: 20, fontWeight: "800", color: gradeColor(p.grade) }}>
              {p.grade}
            </Text>
          </View>
        </View>
      ))}
      {(!data?.predictions || data.predictions.length === 0) && (
        <View style={{ alignItems: "center", padding: 40 }}>
          <Text style={{ color: colors.textMuted }}>문제를 더 풀면 예측이 시작돼요</Text>
        </View>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/student-app/app/\(tabs\)/study.tsx apps/student-app/components/study/
git commit -m "feat(student-app): add study tab with wrong answers, review, mastery, weakness, grade prediction"
```

---

## Chunk 7: Profile Tab + iPad Canvas

### Task 16: Profile Tab

**Files:**
- Create: `apps/student-app/app/(tabs)/profile.tsx`

- [ ] **Step 1: Create profile screen**

```typescript
// apps/student-app/app/(tabs)/profile.tsx
import { View, Text, ScrollView, Pressable, Switch } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { LogOut, Moon, Flame, Trophy, Target } from "lucide-react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const { colors, isDark, mode, setMode } = useTheme();
  const router = useRouter();

  const { data: gamification } = useQuery({
    queryKey: ["gamification"],
    queryFn: () => api.get<{ level: number; xp: number; streak: number }>("/gamification/profile"),
  });

  const { data: achievements } = useQuery({
    queryKey: ["achievements"],
    queryFn: () => api.get<Array<{ id: string; title: string; earned: boolean }>>("/gamification/achievements"),
  });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, gap: 20 }}>
      {/* Profile card */}
      <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
        <View style={{
          width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accent,
          alignItems: "center", justifyContent: "center",
        }}>
          <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800" }}>
            {user?.email?.[0]?.toUpperCase() ?? "?"}
          </Text>
        </View>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.textPrimary, marginTop: 12 }}>
          {user?.email}
        </Text>
        {gamification && (
          <View style={{ flexDirection: "row", gap: 16, marginTop: 12 }}>
            <View style={{ alignItems: "center" }}>
              <Target color={colors.accent} size={18} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textPrimary }}>Lv.{gamification.level}</Text>
            </View>
            <View style={{ alignItems: "center" }}>
              <Trophy color={colors.accent} size={18} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textPrimary }}>{gamification.xp} XP</Text>
            </View>
            <View style={{ alignItems: "center" }}>
              <Flame color={colors.accent} size={18} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textPrimary }}>{gamification.streak}일</Text>
            </View>
          </View>
        )}
      </View>

      {/* Achievements */}
      {achievements && achievements.length > 0 && (
        <View>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textPrimary, marginBottom: 12 }}>업적</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {achievements.filter(a => a.earned).map((a) => (
              <View key={a.id} style={{ backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Text style={{ fontSize: 13, color: colors.textPrimary, fontWeight: "500" }}>{a.title}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Settings */}
      <View style={{ backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Moon color={colors.textSecondary} size={18} />
            <Text style={{ fontSize: 15, color: colors.textPrimary }}>다크 모드</Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={(v) => setMode(v ? "dark" : "light")}
            trackColor={{ true: colors.accent }}
          />
        </View>
        {/* Grade level setting */}
        <Pressable
          onPress={() => router.push("/(auth)/onboarding")}
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <Text style={{ fontSize: 15, color: colors.textPrimary }}>학년 / 교육과정</Text>
          <Text style={{ fontSize: 14, color: colors.textMuted }}>변경</Text>
        </Pressable>
        {/* Notification toggle */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 15, color: colors.textPrimary }}>복습 알림</Text>
          <Switch value={true} trackColor={{ true: colors.accent }} />
        </View>
        <Pressable
          onPress={async () => { await logout(); router.replace("/(auth)/welcome"); }}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 16 }}
        >
          <LogOut color={colors.destructive} size={18} />
          <Text style={{ fontSize: 15, color: colors.destructive }}>로그아웃</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/student-app/app/\(tabs\)/profile.tsx
git commit -m "feat(student-app): add profile tab with gamification, achievements, settings"
```

---

### Task 17: iPad Pencil Canvas

**Files:**
- Create: `apps/student-app/app/canvas/[problemId].tsx`
- Create: `apps/student-app/components/canvas/drawing-canvas.tsx`

- [ ] **Step 1: Create DrawingCanvas component**

```typescript
// apps/student-app/components/canvas/drawing-canvas.tsx
import { useRef, useState, useCallback } from "react";
import { View, Pressable, Text } from "react-native";
import { Canvas, Path, Skia, useCanvasRef } from "@shopify/react-native-skia";
import { Undo2, Redo2, Trash2, Eraser } from "lucide-react-native";
import { useTheme } from "@/lib/theme";

interface DrawingPath {
  path: string;
  color: string;
  strokeWidth: number;
}

interface DrawingCanvasProps {
  onCapture: (imageBase64: string) => void;
}

const PEN_COLORS = ["#333333", "#c87070", "#5da37e"];

export function DrawingCanvas({ onCapture }: DrawingCanvasProps) {
  const { colors } = useTheme();
  const canvasRef = useCanvasRef();
  const [paths, setPaths] = useState<DrawingPath[]>([]);
  const [undone, setUndone] = useState<DrawingPath[]>([]);
  const [currentColor, setCurrentColor] = useState(PEN_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [isEraser, setIsEraser] = useState(false);
  const currentPathRef = useRef<string>("");

  const handleTouchStart = useCallback((x: number, y: number) => {
    currentPathRef.current = `M ${x} ${y}`;
  }, []);

  const handleTouchMove = useCallback((x: number, y: number) => {
    currentPathRef.current += ` L ${x} ${y}`;
    setPaths((prev) => {
      const updated = [...prev];
      if (updated.length > 0 && updated[updated.length - 1].path.startsWith(currentPathRef.current.split(" L")[0])) {
        updated[updated.length - 1] = {
          path: currentPathRef.current,
          color: isEraser ? colors.bg : currentColor,
          strokeWidth: isEraser ? 20 : strokeWidth,
        };
      } else {
        updated.push({
          path: currentPathRef.current,
          color: isEraser ? colors.bg : currentColor,
          strokeWidth: isEraser ? 20 : strokeWidth,
        });
      }
      return updated;
    });
  }, [currentColor, strokeWidth, isEraser, colors.bg]);

  function undo() {
    setPaths((prev) => {
      if (prev.length === 0) return prev;
      setUndone((u) => [...u, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  }

  function redo() {
    setUndone((prev) => {
      if (prev.length === 0) return prev;
      setPaths((p) => [...p, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  }

  function clear() {
    setPaths([]);
    setUndone([]);
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Toolbar */}
      <View style={{
        flexDirection: "row", justifyContent: "space-between", alignItems: "center",
        paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
      }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {PEN_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => { setCurrentColor(c); setIsEraser(false); }}
              style={{
                width: 28, height: 28, borderRadius: 6, backgroundColor: c,
                borderWidth: currentColor === c && !isEraser ? 3 : 0, borderColor: colors.accent,
              }}
            />
          ))}
          <Pressable onPress={() => setIsEraser(!isEraser)} style={{ padding: 4 }}>
            <Eraser color={isEraser ? colors.accent : colors.textMuted} size={20} />
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable onPress={undo}><Undo2 color={colors.textMuted} size={20} /></Pressable>
          <Pressable onPress={redo}><Redo2 color={colors.textMuted} size={20} /></Pressable>
          <Pressable onPress={clear}><Trash2 color={colors.destructive} size={20} /></Pressable>
        </View>
      </View>

      {/* Canvas */}
      {/* Note: In Step 2 of this task, wire up react-native-gesture-handler
          PanGestureHandler around the Canvas to capture touch/pencil events
          and call handleTouchStart/handleTouchMove. This component provides
          the rendering + toolbar; gesture wiring is done in the parent screen. */}
      <Canvas
        ref={canvasRef}
        style={{ flex: 1, backgroundColor: colors.bg }}
      >
        {paths.map((p, i) => {
          const skPath = Skia.Path.MakeFromSVGString(p.path);
          if (!skPath) return null;
          return (
            <Path
              key={i}
              path={skPath}
              color={p.color}
              style="stroke"
              strokeWidth={p.strokeWidth}
              strokeCap="round"
              strokeJoin="round"
            />
          );
        })}
      </Canvas>
    </View>
  );
}
```

- [ ] **Step 2: Create canvas screen**

```typescript
// apps/student-app/app/canvas/[problemId].tsx
import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react-native";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { DrawingCanvas } from "@/components/canvas/drawing-canvas";

export default function CanvasScreen() {
  const { problemId } = useLocalSearchParams<{ problemId: string }>();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isTablet = width > 768;
  const router = useRouter();

  const { data: problem } = useQuery({
    queryKey: ["problem", problemId],
    queryFn: () => api.get<{ stemText: string; subject: string }>(`/problems/${problemId}/student-view`),
    enabled: !!problemId,
  });

  async function handleSubmit(imageBase64: string) {
    // Upload canvas image, then start tutor session with image analysis
    const uploadRes = await api.post<{ s3Key: string }>("/student-ai/canvas/upload", { image: imageBase64 });
    const session = await api.post<{ id: string }>("/student-ai/tutor/sessions", { problemId });
    await api.post(`/student-ai/tutor/sessions/${session.id}/message`, {
      content: "제 풀이를 확인해주세요",
      imageS3Key: uploadRes.s3Key,
    });
    router.push(`/tutor/${session.id}`);
  }

  if (isTablet) {
    // Split view: problem left, canvas right
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title: "펜슬 풀이", headerShown: true }} />

        {/* Left: Problem */}
        <View style={{ flex: 1, borderRightWidth: 1, borderRightColor: colors.border, padding: 20 }}>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 8 }}>문제</Text>
          <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: 16, flex: 1, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 16, color: colors.textPrimary, lineHeight: 26 }}>
              {problem?.stemText ?? "로딩 중..."}
            </Text>
          </View>
        </View>

        {/* Right: Canvas */}
        <View style={{ flex: 1 }}>
          <DrawingCanvas onCapture={handleSubmit} />
          <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", justifyContent: "flex-end", gap: 12 }}>
            <Pressable
              onPress={() => handleSubmit("")}
              style={{
                backgroundColor: colors.accent, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 24,
                flexDirection: "row", alignItems: "center", gap: 6,
              }}
            >
              <Send color="#fff" size={16} />
              <Text style={{ color: "#fff", fontWeight: "700" }}>풀이 제출</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // Phone: full-screen canvas
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "펜슬 풀이", headerShown: true }} />
      <DrawingCanvas onCapture={handleSubmit} />
      <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Pressable
          onPress={() => handleSubmit("")}
          style={{
            backgroundColor: colors.accent, borderRadius: 20, paddingVertical: 14, alignItems: "center",
            flexDirection: "row", justifyContent: "center", gap: 8,
          }}
        >
          <Send color="#fff" size={18} />
          <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>풀이 제출</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/student-app/app/canvas/ apps/student-app/components/canvas/
git commit -m "feat(student-app): add iPad pencil canvas with Skia drawing and split view"
```

---

## Chunk 8: Verify + Polish

### Task 18: Verify App Runs

- [ ] **Step 1: Add student-app to pnpm workspace**

In root `pnpm-workspace.yaml`, add `apps/student-app` if not already included by `apps/*` glob.

- [ ] **Step 2: Install and verify**

```bash
cd apps/student-app
npx expo start
```

Expected: Expo dev server starts, app loads in simulator with Welcome screen.

- [ ] **Step 3: Verify tab navigation works**

Navigate through all 4 tabs, confirm they render without crashes.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A apps/student-app/
git commit -m "fix(student-app): resolve startup and navigation issues"
```

---

### Task 19: Final Integration Commit

- [ ] **Step 1: Run lms-api to verify backend changes**

```bash
cd apps/lms-api && pnpm build
```

- [ ] **Step 2: Verify OCR endpoint**

```bash
cd apps/ocr-api && .venv/bin/python -c "from app.api.single_ocr_routes import router; print('OK')"
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete student-ai standalone app v1 with all screens and backend endpoints"
```
