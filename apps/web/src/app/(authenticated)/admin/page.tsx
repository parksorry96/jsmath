"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/auth";

export default function AdminPage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [router, user]);

  if (!user || user.role !== "admin") {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">설정</h1>
        <p className="text-muted-foreground">시스템 설정을 관리합니다.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mathpix API</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="app-id">App ID</Label>
              <Input
                id="app-id"
                placeholder="mathpix_app_id"
                className="bg-brand-dark"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="app-key">App Key</Label>
              <Input
                id="app-key"
                type="password"
                placeholder="••••••••"
                className="bg-brand-dark"
              />
            </div>
            <Button size="sm">저장</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">OpenAI API</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="openai-key">API Key</Label>
              <Input
                id="openai-key"
                type="password"
                placeholder="sk-••••••••"
                className="bg-brand-dark"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="openai-model">Model</Label>
              <Input
                id="openai-model"
                defaultValue="gpt-4o"
                className="bg-brand-dark"
              />
            </div>
            <Button size="sm">저장</Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">OCR 파이프라인 설정</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="confidence">자동 승인 신뢰도 임계값</Label>
                <Input
                  id="confidence"
                  type="number"
                  defaultValue="0.90"
                  step="0.01"
                  min="0"
                  max="1"
                  className="bg-brand-dark"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-retry">최대 재시도 횟수</Label>
                <Input
                  id="max-retry"
                  type="number"
                  defaultValue="3"
                  className="bg-brand-dark"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dpi">렌더링 DPI</Label>
                <Input
                  id="dpi"
                  type="number"
                  defaultValue="300"
                  className="bg-brand-dark"
                />
              </div>
            </div>
            <Separator />
            <Button size="sm">설정 저장</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
