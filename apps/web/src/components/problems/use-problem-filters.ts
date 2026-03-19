"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Preset } from "./constants";
import { PRESETS } from "./constants";

export interface ProblemFilters {
  q: string;
  searchMode: string;
  reviewStatus: string;
  examYear: string;
  examYearMin: string;
  examMonth: string;
  examType: string;
  position: string;
  correctRateMin: string;
  correctRateMax: string;
  pointValue: string;
  curriculumYear: string;
  subject: string;
  gradeLevel: string;
  difficulty: string;
  problemType: string;
  bookTitle: string;
  solutionTag: string;
  curriculumNodeId: string;
  sortBy: string;
  page: string;
  viewMode: string;
}

const FILTER_KEYS: (keyof ProblemFilters)[] = [
  'q', 'searchMode', 'reviewStatus', 'examYear', 'examYearMin', 'examMonth', 'examType',
  'position', 'correctRateMin', 'correctRateMax', 'pointValue',
  'curriculumYear', 'subject', 'gradeLevel', 'difficulty', 'problemType',
  'bookTitle', 'solutionTag', 'curriculumNodeId', 'sortBy', 'page', 'viewMode',
];

export function useProblemFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters: ProblemFilters = useMemo(() => {
    const f = {} as ProblemFilters;
    for (const key of FILTER_KEYS) {
      f[key] = searchParams.get(key) ?? '';
    }
    if (!f.curriculumYear) f.curriculumYear = '2015';
    if (!f.viewMode) f.viewMode = 'table';
    if (!f.sortBy) f.sortBy = 'newest';
    return f;
  }, [searchParams]);

  const setFilter = useCallback((key: keyof ProblemFilters, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key !== 'page') params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [router, pathname, searchParams]);

  const setFilters = useCallback((updates: Partial<ProblemFilters>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    if (!('page' in updates)) params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [router, pathname, searchParams]);

  const resetFilters = useCallback(() => {
    const params = new URLSearchParams();
    params.set('viewMode', filters.viewMode);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [router, pathname, filters.viewMode]);

  const applyPreset = useCallback((preset: Preset) => {
    const params = new URLSearchParams();
    params.set('viewMode', filters.viewMode);
    for (const [key, value] of Object.entries(preset.filters)) {
      params.set(key, String(value));
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [router, pathname, filters.viewMode]);

  const activePreset = useMemo(() => {
    return PRESETS.find(preset => {
      const entries = Object.entries(preset.filters);
      if (entries.length === 0) {
        return !searchParams.get('examYear') && !searchParams.get('examType')
          && !searchParams.get('position') && !searchParams.get('correctRateMax');
      }
      return entries.every(([key, value]) => searchParams.get(key) === String(value));
    }) ?? null;
  }, [searchParams]);

  const apiQueryString = useMemo(() => {
    const params = new URLSearchParams();
    const apiKeys: (keyof ProblemFilters)[] = [
      'q', 'searchMode', 'reviewStatus', 'examYear', 'examYearMin', 'examMonth', 'examType',
      'position', 'correctRateMin', 'correctRateMax', 'pointValue',
      'subject', 'gradeLevel', 'difficulty', 'problemType',
      'bookTitle', 'solutionTag', 'curriculumNodeId', 'sortBy',
    ];
    for (const key of apiKeys) {
      if (filters[key]) params.set(key, filters[key]);
    }
    params.set('page', filters.page || '1');
    params.set('limit', '20');
    return params.toString();
  }, [filters]);

  return {
    filters,
    setFilter,
    setFilters,
    resetFilters,
    applyPreset,
    activePreset,
    apiQueryString,
  };
}
