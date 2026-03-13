"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  Upload,
  ClipboardCheck,
  BarChart3,
  Settings,
  GraduationCap,
  Calendar,
  Printer,
  BookX,
  TrendingUp,
  RotateCcw,
  GitBranch,
  BrainCircuit,
  MessageCircle,
  Award,
  Building2,
  Trophy,
  Radio,
  Users,
  Plug,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { isTeacherPortalRole, useAuth } from "@/lib/auth";

const teacherNav = [
  { title: "대시보드", href: "/dashboard", icon: LayoutDashboard },
  { title: "반 관리", href: "/classes", icon: BookOpen },
  { title: "캘린더", href: "/calendar", icon: Calendar },
  { title: "문제은행", href: "/problems", icon: FileText },
  { title: "과제/채점", href: "/assignments", icon: GraduationCap },
  { title: "시험지 제작", href: "/exam-builder", icon: Printer },
  { title: "지식 그래프", href: "/knowledge-graph", icon: GitBranch },
  { title: "AI 진단", href: "/diagnostics", icon: BrainCircuit },
  { title: "AI 튜터", href: "/tutor", icon: MessageCircle },
  { title: "등급 예측", href: "/grade-prediction", icon: Award },
  { title: "실시간 모니터", href: "/class-monitor", icon: Radio },
  { title: "학원 운영", href: "/operations", icon: Building2 },
  { title: "학부모 리포트", href: "/parent-reports", icon: Users },
];

const studentNav = [
  { title: "대시보드", href: "/dashboard", icon: LayoutDashboard },
  { title: "캘린더", href: "/calendar", icon: Calendar },
  { title: "과제", href: "/assignments", icon: GraduationCap },
  { title: "오답노트", href: "/wrong-answers", icon: BookX },
  { title: "학습 현황", href: "/mastery", icon: TrendingUp },
  { title: "지식 그래프", href: "/knowledge-graph", icon: GitBranch },
  { title: "오늘의 복습", href: "/review-daily", icon: RotateCcw },
  { title: "AI 튜터", href: "/tutor", icon: MessageCircle },
  { title: "등급 예측", href: "/grade-prediction", icon: Award },
  { title: "업적", href: "/achievements", icon: Trophy },
];

const parentNav = [
  { title: "대시보드", href: "/dashboard", icon: LayoutDashboard },
  { title: "캘린더", href: "/calendar", icon: Calendar },
  { title: "과제", href: "/assignments", icon: GraduationCap },
];

const ocrNav = [
  { title: "PDF 업로드", href: "/upload", icon: Upload },
  { title: "문제 검수", href: "/review", icon: ClipboardCheck },
  { title: "OCR 현황", href: "/analytics", icon: BarChart3 },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const mainNav = isTeacherPortalRole(user?.role ?? "student")
    ? teacherNav
    : user?.role === "student"
      ? studentNav
      : parentNav;

  const pipelineNavigation = user?.role === "admin" || user?.role === "teacher"
    ? ocrNav
    : [];

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-6 py-5">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-beige">
            <span className="text-sm font-bold text-brand-dark">JS</span>
          </div>
          <span className="text-lg font-bold tracking-tight text-sidebar-foreground">
            JSMath
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>메인</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(item.href)}
                  >
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {pipelineNavigation.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>OCR 파이프라인</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {pipelineNavigation.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith(item.href)}
                    >
                      <Link href={item.href}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {user?.role === "admin" && (
        <SidebarFooter className="border-t border-sidebar-border p-4">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/admin"}>
                <Link href="/admin">
                  <Settings className="h-4 w-4" />
                  <span>설정</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
