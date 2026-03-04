"""Pydantic schemas for problem domain — used by API endpoints and Celery tasks."""

from __future__ import annotations

from pydantic import BaseModel, Field


# ─── Classification Taxonomy Constants ───

GRADE_LEVELS = ["high_1", "high_2", "high_3"]

SUBJECTS = ["수학I", "수학II", "확률과 통계", "미적분", "기하"]

# Korean 2022 Revised Curriculum hierarchy
CURRICULUM_TREE: dict[str, dict[str, list[str]]] = {
    "수학I": {
        "지수와 로그": ["지수", "로그", "지수함수", "로그함수"],
        "삼각함수": ["삼각함수의 뜻", "삼각함수의 그래프", "사인법칙과 코사인법칙"],
        "수열": ["등차수열", "등비수열", "수열의 합", "수학적 귀납법"],
    },
    "수학II": {
        "함수의 극한과 연속": ["함수의 극한", "함수의 연속"],
        "미분": ["미분계수", "도함수", "접선의 방정식", "함수의 증감", "극대극소", "최댓값최솟값"],
        "적분": ["부정적분", "정적분", "넓이"],
    },
    "확률과 통계": {
        "경우의 수": ["순열", "조합"],
        "확률": ["확률의 뜻", "조건부확률", "독립시행"],
        "통계": ["확률분포", "정규분포", "통계적 추정"],
    },
    "미적분": {
        "수열의 극한": ["수열의 극한", "급수"],
        "미분법": ["지수로그미분", "삼각함수미분", "여러가지미분법", "도함수의 활용"],
        "적분법": ["여러가지적분법", "정적분의 활용", "넓이와 부피"],
    },
    "기하": {
        "이차곡선": ["포물선", "타원", "쌍곡선"],
        "평면벡터": ["벡터의 연산", "내적", "직선과 원의 방정식"],
        "공간도형과 공간벡터": ["공간좌표", "공간벡터"],
    },
}

DIFFICULTY_LEVELS = {1: "기초", 2: "쉬움", 3: "보통", 4: "어려움", 5: "최상"}

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
    bbox: BBox | None = None
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
    difficulty: int | None = Field(None, ge=1, le=5)
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
