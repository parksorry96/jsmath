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
