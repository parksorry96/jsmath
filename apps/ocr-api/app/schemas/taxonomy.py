"""Korean math curriculum taxonomy — seed data for tag_dictionary and classification prompts.

Based on the 2022 Revised Korean National Curriculum for Mathematics.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Unit:
    name: str
    topics: tuple[str, ...]


@dataclass(frozen=True)
class Subject:
    name: str
    grade_levels: tuple[str, ...]
    units: tuple[Unit, ...]


# ─── High School Subjects (2022 Revised Curriculum) ───

MATH_1 = Subject(
    name="수학I",
    grade_levels=("high_1", "high_2"),
    units=(
        Unit("지수와 로그", ("지수", "로그", "지수함수", "로그함수")),
        Unit("삼각함수", ("삼각함수의 뜻", "삼각함수의 그래프", "사인법칙과 코사인법칙")),
        Unit("수열", ("등차수열", "등비수열", "수열의 합", "수학적 귀납법")),
    ),
)

MATH_2 = Subject(
    name="수학II",
    grade_levels=("high_1", "high_2"),
    units=(
        Unit("함수의 극한과 연속", ("함수의 극한", "함수의 연속")),
        Unit("미분", ("미분계수", "도함수", "접선의 방정식", "함수의 증감", "극대극소", "최댓값최솟값")),
        Unit("적분", ("부정적분", "정적분", "넓이")),
    ),
)

PROB_AND_STAT = Subject(
    name="확률과 통계",
    grade_levels=("high_1", "high_2"),
    units=(
        Unit("경우의 수", ("순열", "조합")),
        Unit("확률", ("확률의 뜻", "조건부확률", "독립시행")),
        Unit("통계", ("확률분포", "정규분포", "통계적 추정")),
    ),
)

CALCULUS = Subject(
    name="미적분",
    grade_levels=("high_2", "high_3"),
    units=(
        Unit("수열의 극한", ("수열의 극한", "급수")),
        Unit("미분법", ("지수로그미분", "삼각함수미분", "여러가지미분법", "도함수의 활용")),
        Unit("적분법", ("여러가지적분법", "정적분의 활용", "넓이와 부피")),
    ),
)

GEOMETRY = Subject(
    name="기하",
    grade_levels=("high_2", "high_3"),
    units=(
        Unit("이차곡선", ("포물선", "타원", "쌍곡선")),
        Unit("평면벡터", ("벡터의 연산", "내적", "직선과 원의 방정식")),
        Unit("공간도형과 공간벡터", ("공간좌표", "공간벡터")),
    ),
)

ALL_SUBJECTS = (MATH_1, MATH_2, PROB_AND_STAT, CALCULUS, GEOMETRY)


def get_all_topic_tags() -> list[str]:
    """Return a flat list of all topic names for seeding tag_dictionary."""
    tags: list[str] = []
    for subject in ALL_SUBJECTS:
        for unit in subject.units:
            tags.append(unit.name)
            tags.extend(unit.topics)
    return sorted(set(tags))


def get_subject_for_unit(unit_name: str) -> str | None:
    """Given a unit name, return the subject it belongs to."""
    for subject in ALL_SUBJECTS:
        for unit in subject.units:
            if unit.name == unit_name:
                return subject.name
    return None


def get_unit_hierarchy(topic: str) -> dict[str, str] | None:
    """Given a topic name, return its full hierarchy: subject, major unit, topic."""
    for subject in ALL_SUBJECTS:
        for unit in subject.units:
            if topic in unit.topics:
                return {
                    "subject": subject.name,
                    "unit_major": unit.name,
                    "unit_sub": topic,
                }
            if topic == unit.name:
                return {
                    "subject": subject.name,
                    "unit_major": unit.name,
                    "unit_sub": "",
                }
    return None
