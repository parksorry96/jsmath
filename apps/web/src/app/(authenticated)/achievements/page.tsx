"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Trophy,
  Flame,
  Rocket,
  Star,
  Crown,
  Target,
  Lock,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Streak {
  type: string;
  current: number;
  longest: number;
  lastActivityAt: string | null;
}

interface ProfileAchievement {
  key: string;
  earnedAt: string;
  title?: string;
  description?: string;
  icon?: string;
}

interface GamificationProfile {
  id: string;
  name: string;
  xp: number;
  level: number;
  xpToNextLevel: number;
  xpProgress: number;
  streaks: Streak[];
  achievements: ProfileAchievement[];
  rank: number;
}

interface AchievementDef {
  key: string;
  title: string;
  description: string;
  icon: string;
  earned: boolean;
  earnedAt: string | null;
}

interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  xp: number;
  level: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, typeof Trophy> = {
  rocket: Rocket,
  flame: Flame,
  star: Star,
  crown: Crown,
  target: Target,
  trophy: Trophy,
};

function AchievementIcon({
  icon,
  earned,
  size = 24,
}: {
  icon: string;
  earned: boolean;
  size?: number;
}) {
  const IconComponent = ICON_MAP[icon] ?? Trophy;
  if (!earned) {
    return <Lock className="text-muted-foreground" style={{ width: size, height: size }} />;
  }
  return <IconComponent className="text-yellow-400" style={{ width: size, height: size }} />;
}

function streakLabel(type: string): string {
  if (type === "daily_solve") return "문제 풀기";
  if (type === "daily_login") return "로그인";
  return type;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProfileCard({ profile }: { profile: GamificationProfile }) {
  const progressPct = profile.xpProgress;
  const solveStreak = profile.streaks.find((s) => s.type === "daily_solve");

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:gap-8">
        {/* Level badge */}
        <div className="flex flex-col items-center gap-1">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-yellow-500/20">
            <span className="text-3xl font-bold text-yellow-400">
              {profile.level}
            </span>
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            레벨
          </span>
        </div>

        {/* XP bar + stats */}
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold">{profile.name}</span>
            <span className="text-sm text-muted-foreground">
              #{profile.rank} 등
            </span>
          </div>

          {/* XP progress */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                <Zap className="mr-1 inline h-3 w-3 text-yellow-400" />
                {profile.xp} XP
              </span>
              <span>다음 레벨까지 {profile.xpToNextLevel} XP</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-brand-charcoal">
              <div
                className="h-full rounded-full bg-yellow-500 transition-all duration-500"
                style={{ width: `${Math.min(100, progressPct)}%` }}
              />
            </div>
          </div>

          {/* Streaks */}
          <div className="flex gap-4">
            {profile.streaks.map((s) => (
              <div
                key={s.type}
                className="flex items-center gap-1.5 rounded-lg bg-brand-charcoal px-3 py-1.5"
              >
                <Flame className="h-4 w-4 text-orange-400" />
                <span className="text-sm font-medium">{s.current}일</span>
                <span className="text-xs text-muted-foreground">
                  {streakLabel(s.type)}
                </span>
              </div>
            ))}
            {profile.streaks.length === 0 && solveStreak === undefined && (
              <div className="flex items-center gap-1.5 rounded-lg bg-brand-charcoal px-3 py-1.5">
                <Flame className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  아직 스트릭이 없습니다
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AchievementGrid({ achievements }: { achievements: AchievementDef[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {achievements.map((a) => (
        <Card
          key={a.key}
          className={a.earned ? "" : "opacity-50"}
        >
          <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
            <AchievementIcon icon={a.icon} earned={a.earned} size={32} />
            <span className="text-sm font-semibold">{a.title}</span>
            <span className="text-xs text-muted-foreground">
              {a.description}
            </span>
            {a.earned && a.earnedAt && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(a.earnedAt).toLocaleDateString("ko-KR")}
              </span>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LeaderboardTable({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">순위</th>
              <th className="px-4 py-3 font-medium">이름</th>
              <th className="px-4 py-3 font-medium text-right">레벨</th>
              <th className="px-4 py-3 font-medium text-right">XP</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">
                  {e.rank <= 3 ? (
                    <span
                      className={
                        e.rank === 1
                          ? "text-yellow-400"
                          : e.rank === 2
                            ? "text-gray-400"
                            : "text-orange-400"
                      }
                    >
                      {e.rank === 1 ? "1st" : e.rank === 2 ? "2nd" : "3rd"}
                    </span>
                  ) : (
                    e.rank
                  )}
                </td>
                <td className="px-4 py-3">{e.name}</td>
                <td className="px-4 py-3 text-right">Lv.{e.level}</td>
                <td className="px-4 py-3 text-right font-medium">
                  {e.xp.toLocaleString()}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  리더보드 데이터가 없습니다
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AchievementsPage() {
  const {
    data: profile,
    isLoading: profileLoading,
  } = useQuery({
    queryKey: ["gamification-profile"],
    queryFn: () => api.get<GamificationProfile>("/gamification/profile"),
  });

  const {
    data: achievements,
    isLoading: achievementsLoading,
  } = useQuery({
    queryKey: ["gamification-achievements"],
    queryFn: () => api.get<AchievementDef[]>("/gamification/achievements"),
  });

  const {
    data: leaderboard,
    isLoading: leaderboardLoading,
  } = useQuery({
    queryKey: ["gamification-leaderboard"],
    queryFn: () =>
      api.get<LeaderboardEntry[]>("/gamification/leaderboard?limit=20"),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">업적</h1>
        <p className="text-muted-foreground">
          XP를 쌓고 레벨업하며 업적을 달성하세요.
        </p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">내 프로필</TabsTrigger>
          <TabsTrigger value="achievements">업적 목록</TabsTrigger>
          <TabsTrigger value="leaderboard">리더보드</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {profileLoading ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : profile ? (
            <ProfileCard profile={profile} />
          ) : null}

          {/* Recent achievements */}
          {!achievementsLoading && achievements && (
            <>
              <h2 className="text-lg font-semibold">획득한 업적</h2>
              <AchievementGrid
                achievements={achievements.filter((a) => a.earned)}
              />
              {achievements.filter((a) => a.earned).length === 0 && (
                <Card>
                  <CardContent className="flex flex-col items-center py-12">
                    <Trophy className="h-12 w-12 text-muted-foreground" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      아직 획득한 업적이 없습니다. 문제를 풀어보세요!
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* Achievements Tab */}
        <TabsContent value="achievements" className="space-y-4">
          {achievementsLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-36 rounded-xl" />
              ))}
            </div>
          ) : achievements ? (
            <AchievementGrid achievements={achievements} />
          ) : null}
        </TabsContent>

        {/* Leaderboard Tab */}
        <TabsContent value="leaderboard" className="space-y-4">
          {leaderboardLoading ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : leaderboard ? (
            <LeaderboardTable entries={leaderboard} />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
