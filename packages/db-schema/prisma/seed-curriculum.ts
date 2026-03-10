import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Helper to generate a URL-safe code from Korean label
function toCode(parts: string[]): string {
  return parts.join(".");
}

interface SubjectDef {
  label: string;
  code: string;
  gradeLevel?: string;
  units: {
    label: string;
    code: string;
    subs: { label: string; code: string }[];
  }[];
}

// ─── 2015 개정교육과정 (applies through 2027 수능) ───
// Source of truth: apps/ocr-api/app/schemas/problem.py CURRICULUM_TREE

const CURRICULUM_2015: SubjectDef[] = [
  {
    label: "수학I",
    code: "math1",
    gradeLevel: "high_2",
    units: [
      {
        label: "지수함수와 로그함수",
        code: "exp_log",
        subs: [
          { label: "거듭제곱근", code: "nth_root" },
          { label: "지수의 확장", code: "exp_ext" },
          { label: "로그의 뜻과 성질", code: "log_def" },
          { label: "상용로그", code: "common_log" },
          { label: "지수함수", code: "exp_func" },
          { label: "로그함수", code: "log_func" },
        ],
      },
      {
        label: "삼각함수",
        code: "trig",
        subs: [
          { label: "일반각과 호도법", code: "radian" },
          { label: "삼각함수의 뜻", code: "trig_def" },
          { label: "삼각함수의 그래프", code: "trig_graph" },
          { label: "사인법칙", code: "sine_rule" },
          { label: "코사인법칙", code: "cosine_rule" },
        ],
      },
      {
        label: "수열",
        code: "seq",
        subs: [
          { label: "등차수열", code: "arith_seq" },
          { label: "등비수열", code: "geom_seq" },
          { label: "수열의 합", code: "seq_sum" },
          { label: "수학적 귀납법", code: "induction" },
        ],
      },
    ],
  },
  {
    label: "수학II",
    code: "math2",
    gradeLevel: "high_2",
    units: [
      {
        label: "함수의 극한과 연속",
        code: "limit_cont",
        subs: [
          { label: "함수의 극한", code: "func_limit" },
          { label: "함수의 연속", code: "func_cont" },
        ],
      },
      {
        label: "미분",
        code: "diff",
        subs: [
          { label: "평균변화율", code: "avg_rate" },
          { label: "미분계수", code: "deriv_coeff" },
          { label: "도함수", code: "derivative" },
          { label: "접선의 방정식", code: "tangent_eq" },
          { label: "함수의 증감", code: "inc_dec" },
          { label: "극대극소", code: "extrema" },
          { label: "최댓값최솟값", code: "max_min" },
        ],
      },
      {
        label: "적분",
        code: "integ",
        subs: [
          { label: "부정적분", code: "indef_integ" },
          { label: "정적분", code: "def_integ" },
          { label: "정적분과 급수의 관계", code: "integ_series" },
          { label: "넓이", code: "area" },
        ],
      },
    ],
  },
  {
    label: "확률과 통계",
    code: "prob_stat",
    gradeLevel: "high_2",
    units: [
      {
        label: "경우의 수",
        code: "counting",
        subs: [
          { label: "순열", code: "perm" },
          { label: "조합", code: "comb" },
          { label: "중복순열", code: "perm_rep" },
          { label: "중복조합", code: "comb_rep" },
        ],
      },
      {
        label: "확률",
        code: "prob",
        subs: [
          { label: "확률의 뜻", code: "prob_def" },
          { label: "조건부확률", code: "cond_prob" },
          { label: "사건의 독립과 종속", code: "independence" },
          { label: "독립시행", code: "indep_trial" },
        ],
      },
      {
        label: "통계",
        code: "stat",
        subs: [
          { label: "확률분포", code: "prob_dist" },
          { label: "정규분포", code: "normal_dist" },
          { label: "통계적 추정", code: "estimation" },
        ],
      },
    ],
  },
  {
    label: "미적분",
    code: "calculus",
    gradeLevel: "high_3",
    units: [
      {
        label: "수열의 극한",
        code: "seq_limit",
        subs: [
          { label: "수열의 극한", code: "seq_lim" },
          { label: "급수", code: "series" },
        ],
      },
      {
        label: "미분법",
        code: "diff_method",
        subs: [
          { label: "지수로그미분", code: "exp_log_diff" },
          { label: "삼각함수미분", code: "trig_diff" },
          { label: "매개변수미분법", code: "param_diff" },
          { label: "음함수미분법", code: "implicit_diff" },
          { label: "여러가지미분법", code: "misc_diff" },
          { label: "도함수의 활용", code: "deriv_app" },
        ],
      },
      {
        label: "적분법",
        code: "integ_method",
        subs: [
          { label: "치환적분", code: "subst_integ" },
          { label: "부분적분", code: "parts_integ" },
          { label: "여러가지적분법", code: "misc_integ" },
          { label: "정적분의 활용", code: "def_integ_app" },
          { label: "넓이와 부피", code: "area_vol" },
        ],
      },
    ],
  },
  {
    label: "기하",
    code: "geometry",
    gradeLevel: "high_3",
    units: [
      {
        label: "이차곡선",
        code: "conics",
        subs: [
          { label: "포물선", code: "parabola" },
          { label: "타원", code: "ellipse" },
          { label: "쌍곡선", code: "hyperbola" },
        ],
      },
      {
        label: "평면벡터",
        code: "plane_vec",
        subs: [
          { label: "벡터의 연산", code: "vec_ops" },
          { label: "평면벡터의 성분", code: "vec_comp" },
          { label: "내적", code: "dot_product" },
          { label: "직선과 원의 방정식", code: "line_circle_eq" },
        ],
      },
      {
        label: "공간도형과 공간벡터",
        code: "space",
        subs: [
          { label: "공간도형의 성질", code: "space_prop" },
          { label: "정사영", code: "projection" },
          { label: "공간좌표", code: "space_coord" },
          { label: "공간벡터", code: "space_vec" },
        ],
      },
    ],
  },
];

// ─── 2022 개정교육과정 (applies from 2028 수능) ───

const CURRICULUM_2022: SubjectDef[] = [
  {
    label: "공통수학1",
    code: "common1",
    gradeLevel: "high_1",
    units: [
      {
        label: "다항식",
        code: "polynomial",
        subs: [
          { label: "다항식의 연산", code: "poly_ops" },
          { label: "나머지정리와 인수분해", code: "remainder_factor" },
        ],
      },
      {
        label: "방정식과 부등식",
        code: "eq_ineq",
        subs: [
          { label: "복소수와 이차방정식", code: "complex_quad" },
          { label: "이차방정식과 이차함수", code: "quad_eq_func" },
          { label: "여러 가지 방정식", code: "misc_eq" },
          { label: "여러 가지 부등식", code: "misc_ineq" },
        ],
      },
      {
        label: "경우의 수",
        code: "counting",
        subs: [
          { label: "순열과 조합", code: "perm_comb" },
        ],
      },
    ],
  },
  {
    label: "공통수학2",
    code: "common2",
    gradeLevel: "high_1",
    units: [
      {
        label: "도형의 방정식",
        code: "fig_eq",
        subs: [
          { label: "직선의 방정식", code: "line_eq" },
          { label: "원의 방정식", code: "circle_eq" },
          { label: "도형의 이동", code: "transform" },
        ],
      },
      {
        label: "집합과 명제",
        code: "set_logic",
        subs: [
          { label: "집합", code: "set" },
          { label: "명제", code: "proposition" },
        ],
      },
      {
        label: "함수",
        code: "function",
        subs: [
          { label: "함수", code: "func_def" },
          { label: "유리함수와 무리함수", code: "rational_irrational" },
        ],
      },
    ],
  },
  {
    label: "대수",
    code: "algebra",
    gradeLevel: "high_2",
    units: [
      {
        label: "지수와 로그",
        code: "exp_log",
        subs: [
          { label: "지수", code: "exponent" },
          { label: "로그", code: "logarithm" },
        ],
      },
      {
        label: "지수함수와 로그함수",
        code: "exp_log_func",
        subs: [
          { label: "지수함수", code: "exp_func" },
          { label: "로그함수", code: "log_func" },
        ],
      },
      {
        label: "수열",
        code: "seq",
        subs: [
          { label: "등차수열과 등비수열", code: "arith_geom" },
          { label: "수열의 합", code: "seq_sum" },
          { label: "수학적 귀납법", code: "induction" },
        ],
      },
    ],
  },
  {
    label: "미적분I",
    code: "calc1",
    gradeLevel: "high_2",
    units: [
      {
        label: "함수의 극한과 연속",
        code: "limit_cont",
        subs: [
          { label: "함수의 극한", code: "func_limit" },
          { label: "함수의 연속", code: "func_cont" },
        ],
      },
      {
        label: "미분",
        code: "diff",
        subs: [
          { label: "미분계수와 도함수", code: "deriv" },
          { label: "도함수의 활용", code: "deriv_app" },
        ],
      },
      {
        label: "적분",
        code: "integ",
        subs: [
          { label: "부정적분과 정적분", code: "integ_def" },
          { label: "정적분의 활용", code: "integ_app" },
        ],
      },
    ],
  },
  {
    label: "확률과 통계",
    code: "prob_stat",
    gradeLevel: "high_2",
    units: [
      {
        label: "경우의 수",
        code: "counting",
        subs: [
          { label: "순열과 조합", code: "perm_comb" },
        ],
      },
      {
        label: "확률",
        code: "prob",
        subs: [
          { label: "확률의 뜻과 활용", code: "prob_def" },
          { label: "조건부확률", code: "cond_prob" },
        ],
      },
      {
        label: "통계",
        code: "stat",
        subs: [
          { label: "확률분포", code: "prob_dist" },
          { label: "통계적 추정", code: "estimation" },
        ],
      },
    ],
  },
  {
    label: "미적분II",
    code: "calc2",
    gradeLevel: "high_3",
    units: [
      {
        label: "수열의 극한",
        code: "seq_limit",
        subs: [
          { label: "수열의 극한", code: "seq_lim" },
          { label: "급수", code: "series" },
        ],
      },
      {
        label: "미분법",
        code: "diff_method",
        subs: [
          { label: "여러 가지 함수의 미분", code: "adv_diff" },
          { label: "여러 가지 미분법", code: "misc_diff" },
          { label: "도함수의 활용", code: "deriv_app" },
        ],
      },
      {
        label: "적분법",
        code: "integ_method",
        subs: [
          { label: "여러 가지 적분법", code: "adv_integ" },
          { label: "정적분의 활용", code: "integ_app" },
        ],
      },
    ],
  },
  {
    label: "기하",
    code: "geometry",
    gradeLevel: "high_3",
    units: [
      {
        label: "이차곡선",
        code: "conics",
        subs: [
          { label: "이차곡선", code: "conics_def" },
          { label: "이차곡선과 직선", code: "conics_line" },
        ],
      },
      {
        label: "벡터",
        code: "vector",
        subs: [
          { label: "평면벡터", code: "plane_vec" },
          { label: "공간벡터", code: "space_vec" },
        ],
      },
      {
        label: "공간도형",
        code: "space_fig",
        subs: [
          { label: "공간도형", code: "space_fig_def" },
          { label: "공간좌표", code: "space_coord" },
        ],
      },
    ],
  },
];

async function seedCurriculum(year: number, subjects: SubjectDef[]) {
  let subjectOrder = 0;
  for (const subject of subjects) {
    const subjectCode = toCode([subject.code]);
    const subjectNode = await prisma.curriculumNode.upsert({
      where: {
        curriculumYear_code: { curriculumYear: year, code: subjectCode },
      },
      update: {
        label: subject.label,
        level: 1,
        sortOrder: subjectOrder,
        gradeLevel: subject.gradeLevel ?? null,
      },
      create: {
        curriculumYear: year,
        level: 1,
        code: subjectCode,
        label: subject.label,
        sortOrder: subjectOrder,
        gradeLevel: subject.gradeLevel ?? null,
      },
    });
    subjectOrder++;

    let unitOrder = 0;
    for (const unit of subject.units) {
      const unitCode = toCode([subject.code, unit.code]);
      const unitNode = await prisma.curriculumNode.upsert({
        where: {
          curriculumYear_code: { curriculumYear: year, code: unitCode },
        },
        update: {
          label: unit.label,
          level: 2,
          parentId: subjectNode.id,
          sortOrder: unitOrder,
          gradeLevel: subject.gradeLevel ?? null,
        },
        create: {
          curriculumYear: year,
          level: 2,
          code: unitCode,
          label: unit.label,
          parentId: subjectNode.id,
          sortOrder: unitOrder,
          gradeLevel: subject.gradeLevel ?? null,
        },
      });
      unitOrder++;

      let subOrder = 0;
      for (const sub of unit.subs) {
        const subCode = toCode([subject.code, unit.code, sub.code]);
        await prisma.curriculumNode.upsert({
          where: {
            curriculumYear_code: { curriculumYear: year, code: subCode },
          },
          update: {
            label: sub.label,
            level: 3,
            parentId: unitNode.id,
            sortOrder: subOrder,
            gradeLevel: subject.gradeLevel ?? null,
          },
          create: {
            curriculumYear: year,
            level: 3,
            code: subCode,
            label: sub.label,
            parentId: unitNode.id,
            sortOrder: subOrder,
            gradeLevel: subject.gradeLevel ?? null,
          },
        });
        subOrder++;
      }
    }
  }
}

async function main() {
  console.log("Seeding 2015 curriculum...");
  await seedCurriculum(2015, CURRICULUM_2015);

  console.log("Seeding 2022 curriculum...");
  await seedCurriculum(2022, CURRICULUM_2022);

  const count = await prisma.curriculumNode.count();
  console.log(`Done. Total curriculum nodes: ${count}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
