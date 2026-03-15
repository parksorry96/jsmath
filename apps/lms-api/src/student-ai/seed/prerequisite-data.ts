import { PrismaClient } from "@prisma/client";

export const PREREQUISITE_EDGES = [
  // 수학I -> 미적분
  { from: ["수학I", "지수함수와 로그함수"], to: ["미적분", "미분법"], strength: 1.0 },
  { from: ["수학I", "삼각함수"], to: ["미적분", "미분법"], strength: 1.0 },
  { from: ["수학I", "수열"], to: ["미적분", "수열의 극한"], strength: 1.0 },
  // 수학II -> 미적분
  { from: ["수학II", "함수의 극한과 연속"], to: ["미적분", "수열의 극한"], strength: 0.7 },
  { from: ["수학II", "미분"], to: ["미적분", "미분법"], strength: 1.0 },
  { from: ["수학II", "적분"], to: ["미적분", "적분법"], strength: 1.0 },
  // Internal 수학II
  { from: ["수학II", "함수의 극한과 연속"], to: ["수학II", "미분"], strength: 1.0 },
  { from: ["수학II", "미분"], to: ["수학II", "적분"], strength: 0.8 },
  // 확률과 통계
  { from: ["확률과 통계", "경우의 수"], to: ["확률과 통계", "확률"], strength: 1.0 },
  { from: ["확률과 통계", "확률"], to: ["확률과 통계", "통계"], strength: 0.8 },
  // 기하
  { from: ["기하", "이차곡선"], to: ["기하", "평면벡터"], strength: 0.5 },
  { from: ["기하", "평면벡터"], to: ["기하", "공간도형과 공간벡터"], strength: 1.0 },
  // Cross-subject
  { from: ["수학I", "삼각함수"], to: ["기하", "평면벡터"], strength: 0.6 },
];

export async function seedPrerequisites(prisma: PrismaClient) {
  let created = 0;
  let updated = 0;

  for (const edge of PREREQUISITE_EDGES) {
    const result = await prisma.curriculumPrerequisite.upsert({
      where: {
        fromSubject_fromUnit_toSubject_toUnit: {
          fromSubject: edge.from[0],
          fromUnit: edge.from[1],
          toSubject: edge.to[0],
          toUnit: edge.to[1],
        },
      },
      create: {
        fromSubject: edge.from[0],
        fromUnit: edge.from[1],
        toSubject: edge.to[0],
        toUnit: edge.to[1],
        strength: edge.strength,
      },
      update: {
        strength: edge.strength,
      },
    });

    // upsert always returns the record; check createdAt to distinguish
    if (result.createdAt.getTime() > Date.now() - 1000) {
      created++;
    } else {
      updated++;
    }
  }

  return { created, updated, total: PREREQUISITE_EDGES.length };
}
