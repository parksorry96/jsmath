"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Upload,
  Link2,
  Plus,
  CheckCircle2,
  XCircle,
  Loader2,
  FileCode,
  Settings2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { toast } from "sonner";

// ─── Types ─────────────────────────────────────────────────────────────────

interface LtiPlatform {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  authEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  deploymentId: string | null;
  isActive: boolean;
  createdAt: string;
}

interface RegisterPlatformForm {
  name: string;
  issuer: string;
  clientId: string;
  authEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  deploymentId: string;
}

const EMPTY_FORM: RegisterPlatformForm = {
  name: "",
  issuer: "",
  clientId: "",
  authEndpoint: "",
  tokenEndpoint: "",
  jwksUri: "",
  deploymentId: "",
};

// ─── QTI Tab ────────────────────────────────────────────────────────────────

function QtiTab() {
  const [problemId, setProblemId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [importXml, setImportXml] = useState("");
  const [importing, setImporting] = useState(false);
  const [exportingProblem, setExportingProblem] = useState(false);
  const [exportingAssignment, setExportingAssignment] = useState(false);

  async function downloadXml(path: string, filename: string) {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/v1";
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const res = await fetch(`${apiUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportProblem() {
    if (!problemId.trim()) {
      toast.error("문제 ID를 입력하세요.");
      return;
    }
    setExportingProblem(true);
    try {
      await downloadXml(
        `/integrations/qti/export/problem/${problemId.trim()}`,
        `problem-${problemId.trim()}.xml`,
      );
      toast.success("QTI XML 내보내기 완료");
    } catch {
      toast.error("내보내기 실패. 문제 ID를 확인하세요.");
    } finally {
      setExportingProblem(false);
    }
  }

  async function handleExportAssignment() {
    if (!assignmentId.trim()) {
      toast.error("과제 ID를 입력하세요.");
      return;
    }
    setExportingAssignment(true);
    try {
      await downloadXml(
        `/integrations/qti/export/assignment/${assignmentId.trim()}`,
        `assignment-${assignmentId.trim()}.xml`,
      );
      toast.success("QTI XML 내보내기 완료");
    } catch {
      toast.error("내보내기 실패. 과제 ID를 확인하세요.");
    } finally {
      setExportingAssignment(false);
    }
  }

  async function handleImport() {
    if (!importXml.trim()) {
      toast.error("QTI XML을 입력하세요.");
      return;
    }
    setImporting(true);
    try {
      const result = await api.post<{ imported: number; problems: string[] }>(
        "/integrations/qti/import",
        { xml: importXml },
      );
      toast.success(`${result.imported}개 문제를 성공적으로 가져왔습니다.`);
      setImportXml("");
    } catch {
      toast.error("QTI 가져오기 실패. XML 형식을 확인하세요.");
    } finally {
      setImporting(false);
    }
  }

  async function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportXml(text);
    toast.info(`파일 로드됨: ${file.name}`);
  }

  return (
    <div className="space-y-6">
      {/* Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4" />
            QTI 2.1 내보내기
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="problem-id">문제 내보내기</Label>
            <div className="flex gap-2">
              <Input
                id="problem-id"
                placeholder="문제 ID 입력"
                value={problemId}
                onChange={(e) => setProblemId(e.target.value)}
                className="max-w-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportProblem}
                disabled={exportingProblem}
              >
                {exportingProblem ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="ml-1">내보내기</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              assessmentItem XML (QTI 2.1) — 선다형, 단답형 지원
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="assignment-id">과제 내보내기</Label>
            <div className="flex gap-2">
              <Input
                id="assignment-id"
                placeholder="과제 ID 입력"
                value={assignmentId}
                onChange={(e) => setAssignmentId(e.target.value)}
                className="max-w-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportAssignment}
                disabled={exportingAssignment}
              >
                {exportingAssignment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="ml-1">내보내기</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              assessmentTest XML — 과제에 포함된 모든 문제 참조 포함
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Import */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" />
            QTI 2.1 가져오기
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>XML 파일 업로드</Label>
            <Input
              type="file"
              accept=".xml"
              onChange={handleFileImport}
              className="cursor-pointer"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-xml">또는 XML 직접 붙여넣기</Label>
            <textarea
              id="import-xml"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[120px] resize-y"
              placeholder="<?xml version=&quot;1.0&quot;?><assessmentItem ...>"
              value={importXml}
              onChange={(e) => setImportXml(e.target.value)}
            />
          </div>
          <Button onClick={handleImport} disabled={importing || !importXml.trim()}>
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCode className="mr-2 h-4 w-4" />}
            가져오기
          </Button>
          <p className="text-xs text-muted-foreground">
            QTI 2.1 assessmentItem 형식 지원. 가져온 문제는 검수 대기 상태로 등록됩니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── LTI Tab ────────────────────────────────────────────────────────────────

function LtiTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RegisterPlatformForm>(EMPTY_FORM);

  const { data: platforms, isLoading } = useQuery<LtiPlatform[]>({
    queryKey: ["lti-platforms"],
    queryFn: () => api.get<LtiPlatform[]>("/integrations/lti/platforms"),
  });

  const registerMutation = useMutation({
    mutationFn: (data: RegisterPlatformForm) =>
      api.post<LtiPlatform>("/integrations/lti/platforms", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lti-platforms"] });
      setForm(EMPTY_FORM);
      setShowForm(false);
      toast.success("LMS 플랫폼이 등록되었습니다.");
    },
    onError: () => toast.error("등록 실패. 입력 값을 확인하세요."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    registerMutation.mutate(form);
  }

  function handleField(key: keyof RegisterPlatformForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-6">
      {/* JWKS info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4" />
            JSMath Tool 설정 정보
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="font-medium text-muted-foreground">OIDC Launch URL</span>
            <code className="ml-2 rounded bg-muted px-2 py-0.5 text-xs">
              POST /v1/integrations/lti/launch
            </code>
          </div>
          <div>
            <span className="font-medium text-muted-foreground">JWKS URL</span>
            <code className="ml-2 rounded bg-muted px-2 py-0.5 text-xs">
              GET /v1/integrations/lti/jwks
            </code>
          </div>
          <p className="text-xs text-muted-foreground">
            LMS에 JSMath를 LTI 1.3 도구로 등록할 때 위 URL을 사용하세요.
          </p>
        </CardContent>
      </Card>

      {/* Platform list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" />
            등록된 LMS 플랫폼
          </CardTitle>
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="mr-1 h-4 w-4" />
            플랫폼 등록
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              불러오는 중...
            </div>
          ) : !platforms || platforms.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              등록된 플랫폼이 없습니다.
            </p>
          ) : (
            <div className="divide-y">
              {platforms.map((p) => (
                <div key={p.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{p.name}</span>
                      {p.isActive ? (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          <CheckCircle2 className="mr-1 h-3 w-3 text-green-500" />
                          활성
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs shrink-0">
                          <XCircle className="mr-1 h-3 w-3 text-red-400" />
                          비활성
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{p.issuer}</p>
                    <p className="text-xs text-muted-foreground">Client ID: {p.clientId}</p>
                    {p.deploymentId && (
                      <p className="text-xs text-muted-foreground">
                        Deployment: {p.deploymentId}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(p.createdAt).toLocaleDateString("ko-KR")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Register form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">새 LMS 플랫폼 등록</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="lti-name">플랫폼 이름 *</Label>
                  <Input
                    id="lti-name"
                    placeholder="예: Canvas LMS"
                    value={form.name}
                    onChange={(e) => handleField("name", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lti-issuer">Issuer (iss) *</Label>
                  <Input
                    id="lti-issuer"
                    placeholder="https://canvas.instructure.com"
                    value={form.issuer}
                    onChange={(e) => handleField("issuer", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lti-client-id">Client ID *</Label>
                  <Input
                    id="lti-client-id"
                    placeholder="12345"
                    value={form.clientId}
                    onChange={(e) => handleField("clientId", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lti-deployment-id">Deployment ID</Label>
                  <Input
                    id="lti-deployment-id"
                    placeholder="선택 사항"
                    value={form.deploymentId}
                    onChange={(e) => handleField("deploymentId", e.target.value)}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="lti-auth">인증 엔드포인트 (OIDC) *</Label>
                  <Input
                    id="lti-auth"
                    placeholder="https://canvas.instructure.com/api/lti/authorize_redirect"
                    value={form.authEndpoint}
                    onChange={(e) => handleField("authEndpoint", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="lti-token">토큰 엔드포인트 *</Label>
                  <Input
                    id="lti-token"
                    placeholder="https://canvas.instructure.com/login/oauth2/token"
                    value={form.tokenEndpoint}
                    onChange={(e) => handleField("tokenEndpoint", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="lti-jwks">플랫폼 JWKS URI *</Label>
                  <Input
                    id="lti-jwks"
                    placeholder="https://canvas.instructure.com/api/lti/security/jwks"
                    value={form.jwksUri}
                    onChange={(e) => handleField("jwksUri", e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={registerMutation.isPending}>
                  {registerMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  등록
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
                >
                  취소
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">연동 관리</h1>
        <p className="text-sm text-muted-foreground mt-1">
          외부 LMS 및 학습 표준 연동을 설정합니다. (QTI 2.1 / LTI 1.3)
        </p>
      </div>

      <Tabs defaultValue="qti">
        <TabsList>
          <TabsTrigger value="qti" className="flex items-center gap-1.5">
            <FileCode className="h-3.5 w-3.5" />
            QTI
          </TabsTrigger>
          <TabsTrigger value="lti" className="flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5" />
            LTI
          </TabsTrigger>
        </TabsList>

        <TabsContent value="qti" className="mt-4">
          <QtiTab />
        </TabsContent>

        <TabsContent value="lti" className="mt-4">
          <LtiTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
