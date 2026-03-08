"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { useAuth } from "@/lib/auth";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
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
