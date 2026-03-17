"""Pydantic schemas for problem domain — used by API endpoints and Celery tasks."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

# ─── Classification Taxonomy Constants ───

GRADE_LEVELS = ["high_1", "high_2", "high_3"]

SUBJECTS_2015 = ["수학I", "수학II", "확률과 통계", "미적분", "기하"]
SUBJECTS_2022 = ["공통수학1", "공통수학2", "대수", "미적분I", "확률과 통계", "미적분II", "기하"]

SUBJECTS = SUBJECTS_2015

# 2015 개정교육과정 hierarchy (applies through 2027 수능)
CURRICULUM_TREE_2015: dict[str, dict[str, list[str]]] = {
    "수학I": {
        "지수함수와 로그함수": ["거듭제곱근", "지수의 확장", "로그의 뜻과 성질", "상용로그", "지수함수", "로그함수"],
        "삼각함수": ["일반각과 호도법", "삼각함수의 뜻", "삼각함수의 그래프", "사인법칙", "코사인법칙"],
        "수열": ["등차수열", "등비수열", "수열의 합", "수학적 귀납법"],
    },
    "수학II": {
        "함수의 극한과 연속": ["함수의 극한", "함수의 연속"],
        "미분": ["평균변화율", "미분계수", "도함수", "접선의 방정식", "함수의 증감", "극대극소", "최댓값최솟값"],
        "적분": ["부정적분", "정적분", "정적분과 급수의 관계", "넓이"],
    },
    "확률과 통계": {
        "경우의 수": ["순열", "조합", "중복순열", "중복조합"],
        "확률": ["확률의 뜻", "조건부확률", "사건의 독립과 종속", "독립시행"],
        "통계": ["확률분포", "정규분포", "통계적 추정"],
    },
    "미적분": {
        "수열의 극한": ["수열의 극한", "급수"],
        "미분법": ["지수로그미분", "삼각함수미분", "매개변수미분법", "음함수미분법", "여러가지미분법", "도함수의 활용"],
        "적분법": ["치환적분", "부분적분", "여러가지적분법", "정적분의 활용", "넓이와 부피"],
    },
    "기하": {
        "이차곡선": ["포물선", "타원", "쌍곡선"],
        "평면벡터": ["벡터의 연산", "평면벡터의 성분", "내적", "직선과 원의 방정식"],
        "공간도형과 공간벡터": ["공간도형의 성질", "정사영", "공간좌표", "공간벡터"],
    },
}

# 2022 개정교육과정 hierarchy (applies from 2028 수능)
CURRICULUM_TREE_2022: dict[str, dict[str, list[str]]] = {
    "공통수학1": {
        "다항식": ["다항식의 연산", "나머지정리와 인수분해"],
        "방정식과 부등식": ["복소수와 이차방정식", "이차방정식과 이차함수", "여러 가지 방정식", "여러 가지 부등식"],
        "경우의 수": ["순열과 조합"],
    },
    "공통수학2": {
        "도형의 방정식": ["직선의 방정식", "원의 방정식", "도형의 이동"],
        "집합과 명제": ["집합", "명제"],
        "함수": ["함수", "유리함수와 무리함수"],
    },
    "대수": {
        "지수와 로그": ["지수", "로그"],
        "지수함수와 로그함수": ["지수함수", "로그함수"],
        "수열": ["등차수열과 등비수열", "수열의 합", "수학적 귀납법"],
    },
    "미적분I": {
        "함수의 극한과 연속": ["함수의 극한", "함수의 연속"],
        "미분": ["미분계수와 도함수", "도함수의 활용"],
        "적분": ["부정적분과 정적분", "정적분의 활용"],
    },
    "확률과 통계": {
        "경우의 수": ["순열과 조합"],
        "확률": ["확률의 뜻과 활용", "조건부확률"],
        "통계": ["확률분포", "통계적 추정"],
    },
    "미적분II": {
        "수열의 극한": ["수열의 극한", "급수"],
        "미분법": ["여러 가지 함수의 미분", "여러 가지 미분법", "도함수의 활용"],
        "적분법": ["여러 가지 적분법", "정적분의 활용"],
    },
    "기하": {
        "이차곡선": ["이차곡선", "이차곡선과 직선"],
        "벡터": ["평면벡터", "공간벡터"],
        "공간도형": ["공간도형", "공간좌표"],
    },
}

CURRICULUM_TREE = CURRICULUM_TREE_2015
CURRICULUM_TREES = {
    2015: CURRICULUM_TREE_2015,
    2022: CURRICULUM_TREE_2022,
}
SUBJECTS_BY_CURRICULUM_YEAR = {
    2015: SUBJECTS_2015,
    2022: SUBJECTS_2022,
}

SOLUTION_STRATEGY_TAGS = [
    "직접계산", "치환", "귀류법", "수학적귀납법",
    "그래프활용", "미분활용", "적분활용", "벡터활용",
    "경우의수", "확률계산", "점화식", "극한",
    "넓이/부피", "방정식풀이", "부등식풀이",
    "도형성질", "좌표기하", "삼각함수활용",
    "함수의성질", "합성함수", "역함수",
    "조건분석", "범위추정", "대칭성활용",
]

DIFFICULTY_LEVELS = {1: "기초", 2: "쉬움", 3: "보통", 4: "약간 어려움", 5: "어려움", 6: "최상"}

PROBLEM_TYPES = ["multiple_choice", "short_answer", "written_solution", "essay"]

ASSET_KINDS = [
    "graph", "geometry", "statistics", "number_line",
    "tree_diagram", "venn_diagram", "table", "other",
]

ASSET_SUB_KINDS = {
    "graph": ["function_plot", "inequality_region", "parametric", "polar"],
    "geometry": ["triangle", "circle", "polygon", "3d_solid", "composite"],
    "statistics": ["histogram", "box_plot", "scatter_plot", "pie_chart"],
    "number_line": ["interval", "point_set"],
    "tree_diagram": ["probability", "counting"],
    "venn_diagram": ["two_set", "three_set"],
    "table": ["data_table", "truth_table", "frequency_table"],
}

# ─── Number pattern regex patterns for problem segmentation ───

PROBLEM_NUMBER_PATTERNS = [
    # Main problem: "1.", "2.", "12." (with period, NOT decimals like "1.0")
    r"^\s*(\d{1,3})\s*\.(?!\d)\s*",
    # Main problem: "1 ", "2 " (standalone number at line start, followed by text)
    r"^\s*(\d{1,3})\s+(?=[가-힣\[（(])",
    # Sub-problem: "(1)", "(2)"
    r"^\s*\((\d{1,2})\)\s*",
    # Sub-problem: "1)", "2)"
    r"^\s*(\d{1,2})\)\s*",
    # Korean sub-labels: "(가)", "(나)", "(다)"
    r"^\s*\(([가-힣])\)\s*",
    # Consonant labels: "ㄱ.", "ㄴ.", "ㄷ."
    r"^\s*([ㄱ-ㅎ])\.\s*",
    # Circled numbers: ①②③④⑤
    r"^\s*([①②③④⑤])\s*",
    # Section markers
    r"^\s*\[?(서술형|논술형|단답형)\]?\s*",
]


# ─── Pydantic Schemas ───


class BBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class ProblemLayout(BaseModel):
    x: float
    y: float
    w: float
    h: float
    boxed_blocks: list[dict[str, Any]] | None = None
    structured_stem: list[dict[str, Any]] | None = None


class SegmentedProblem(BaseModel):
    """Output of the problem segmentation step."""

    problem_number: str | None = None
    display_number: str | None = None
    problem_type: str = "short_answer"
    start_page: int
    end_page: int
    start_line: int
    end_line: int
    stem_latex: str
    stem_text: str
    bbox: ProblemLayout | None = None
    choices: list[ChoiceItem] | None = None
    sub_problems: list[SegmentedProblem] | None = None
    shared_stem_latex: str | None = None
    shared_stem_text: str | None = None


class ChoiceItem(BaseModel):
    position: int = Field(ge=1, le=5)
    label: str  # "①", "②", etc.
    content_latex: str
    content_text: str


# Forward ref resolution
SegmentedProblem.model_rebuild()


class ClassificationResult(BaseModel):
    """Output of the AI classification step."""

    grade_level: str | None = None
    subject: str | None = None
    unit_major: str | None = None
    unit_minor: str | None = None
    unit_sub: str | None = None
    difficulty: int | None = Field(None, ge=1, le=6)
    concept_tags: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)


class GraphCropResult(BaseModel):
    """Output of the graph/figure crop step."""

    kind: str  # AssetKind value
    sub_kind: str | None = None
    page_number: int
    bbox: BBox
    s3_key: str
    width_px: int
    height_px: int
    edge_density: float
    blank_ratio: float
    detection_method: str  # "line_data" or "vision_fallback"
    ai_description: str | None = None
