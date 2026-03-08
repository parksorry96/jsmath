"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isTeacherPortalRole, useAuth } from "@/lib/auth";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-dark">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-beige">
            <span className="text-lg font-bold text-brand-dark">JS</span>
          </div>
          <div className="h-1 w-32 overflow-hidden rounded-full bg-brand-charcoal">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-brand-beige" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!isTeacherPortalRole(user.role)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-dark p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>웹 접근 제한</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              현재 웹 포털은 교사와 관리자 계정만 지원합니다. 학생 또는 학부모 계정은 모바일 앱을 사용하세요.
            </p>
            <Button onClick={logout} className="w-full">
              로그아웃
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="max-h-svh">
        <AppHeader />
        <main className="flex-1 min-h-0 overflow-auto p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
