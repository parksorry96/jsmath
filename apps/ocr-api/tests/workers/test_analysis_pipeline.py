"""Tests for analysis pipeline timeout fallback behavior."""

from __future__ import annotations

import asyncio
import importlib

import pytest

from app.workers import analysis_pipeline


def test_get_fallback_retry_reason_retries_common_question_when_classification_is_missing() -> None:
    reason = analysis_pipeline._get_fallback_retry_reason(
        {"subject": None, "unit_major": None, "answer": "1"},
        {"answers": set(), "exam_source": {"isCommon": True}},
    )

    assert reason == "common-question classification missing"


def test_get_fallback_retry_reason_skips_answer_check_for_metadata_only_modes() -> None:
    reason = analysis_pipeline._get_fallback_retry_reason(
        {
            "analysis_mode": "exam_reference_metadata_v1",
            "subject": "수학II",
            "unit_major": "미분",
            "answer": None,
        },
        {"answers": {"1"}, "exam_source": {}},
    )

    assert reason is None


def test_normalize_answer_for_compare_handles_parenthesized_choice_answers() -> None:
    assert analysis_pipeline._normalize_answer_for_compare("(2)") == "2"
    assert analysis_pipeline._normalize_answer_for_compare("답 ③") == "3"


@pytest.mark.asyncio
async def test_process_single_safe_retries_timed_out_problem_with_fallback_model(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_process_single(problem_id: str, sem: asyncio.Semaphore, *, model: str | None = None):
        if model is None:
            await asyncio.sleep(0.02)
            return {"problem_id": problem_id, "decision": "failed"}
        return {"problem_id": problem_id, "decision": "auto_approved", "model": model}

    async def fake_mark_problem_failed(problem_id: str, error_msg: str) -> None:
        raise AssertionError(f"should not mark failed: {problem_id} {error_msg}")

    monkeypatch.setattr(analysis_pipeline, "_process_single", fake_process_single)
    monkeypatch.setattr(analysis_pipeline, "_mark_problem_failed", fake_mark_problem_failed)
    monkeypatch.setattr(analysis_pipeline, "SINGLE_PROBLEM_TIMEOUT", 0.01)
    monkeypatch.setattr(analysis_pipeline, "FALLBACK_MODEL", "gpt-5.4")
    monkeypatch.setattr(analysis_pipeline.settings, "ai_model", "gpt-5-mini")
    monkeypatch.setattr(analysis_pipeline.settings, "ai_fallback_timeout_sec", 1)

    result = await analysis_pipeline._process_single_safe("problem-1", asyncio.Semaphore(1))

    assert result["problem_id"] == "problem-1"
    assert result["decision"] == "auto_approved"
    assert result["model"] == "gpt-5.4"


@pytest.mark.asyncio
async def test_process_single_safe_marks_failed_when_fallback_also_times_out(monkeypatch: pytest.MonkeyPatch) -> None:
    marked: dict[str, str] = {}

    async def fake_process_single(problem_id: str, sem: asyncio.Semaphore, *, model: str | None = None):
        await asyncio.sleep(0.02)
        return {"problem_id": problem_id, "decision": "failed", "model": model}

    async def fake_mark_problem_failed(problem_id: str, error_msg: str) -> None:
        marked[problem_id] = error_msg

    monkeypatch.setattr(analysis_pipeline, "_process_single", fake_process_single)
    monkeypatch.setattr(analysis_pipeline, "_mark_problem_failed", fake_mark_problem_failed)
    monkeypatch.setattr(analysis_pipeline, "SINGLE_PROBLEM_TIMEOUT", 0.01)
    monkeypatch.setattr(analysis_pipeline, "FALLBACK_MODEL", "gpt-5.4")
    monkeypatch.setattr(analysis_pipeline.settings, "ai_model", "gpt-5-mini")
    monkeypatch.setattr(analysis_pipeline.settings, "ai_fallback_timeout_sec", 0.01)

    result = await analysis_pipeline._process_single_safe("problem-2", asyncio.Semaphore(1))

    assert result["problem_id"] == "problem-2"
    assert result["decision"] == "failed"
    assert "fallback gpt-5.4 also timed out" in result["error"]
    assert "fallback gpt-5.4 also timed out" in marked["problem-2"]


@pytest.mark.asyncio
async def test_process_single_routes_textbook_to_metadata_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {"textbook": False, "exam_reference": False, "unified": False}

    async def fake_get_problem_analysis_mode(problem_id: str) -> str:
        if problem_id == "textbook-1":
            return "textbook"
        if problem_id == "exam-1":
            return "reference_solution"
        return "default"

    async def fake_textbook_metadata(problem_id: str, *, model: str | None = None, max_retries: int = 3):
        called["textbook"] = True
        return {
            "problem_id": problem_id,
            "analysis_mode": "textbook_metadata_v1",
            "subject": "수학I",
            "unit_major": "지수함수와 로그함수",
        }

    async def fake_unified(problem_id: str, *, model: str | None = None, max_retries: int = 3):
        called["unified"] = True
        return {"problem_id": problem_id}

    async def fake_exam_reference_metadata(problem_id: str, *, model: str | None = None, max_retries: int = 3):
        called["exam_reference"] = True
        return {
            "problem_id": problem_id,
            "analysis_mode": "exam_reference_metadata_v1",
            "subject": "수학II",
            "unit_major": "미분",
        }

    async def fake_apply_rules(problem_id: str, prev_result: dict[str, object]) -> dict[str, object]:
        return {"problem_id": problem_id, **prev_result}

    async def fake_generate_embedding_async(problem_id: str, prev_result: dict[str, object]) -> None:
        return None

    async def fake_find(problem_id: str) -> None:
        return None

    async def fake_review(problem_id: str) -> dict[str, object]:
        return {"problem_id": problem_id, "decision": "auto_approved"}

    monkeypatch.setattr(analysis_pipeline, "_get_problem_analysis_mode", fake_get_problem_analysis_mode)

    auto_review = importlib.import_module("app.workers.auto_review")
    detect_exam_pattern = importlib.import_module("app.workers.detect_exam_pattern")
    exam_reference_metadata_analysis = importlib.import_module("app.workers.exam_reference_metadata_analysis")
    find_similar = importlib.import_module("app.workers.find_similar")
    generate_embedding = importlib.import_module("app.workers.generate_embedding")
    textbook_metadata_analysis = importlib.import_module("app.workers.textbook_metadata_analysis")
    unified_analysis = importlib.import_module("app.workers.unified_analysis")

    monkeypatch.setattr(textbook_metadata_analysis, "analyze_textbook_metadata", fake_textbook_metadata)
    monkeypatch.setattr(
        exam_reference_metadata_analysis,
        "analyze_exam_reference_metadata",
        fake_exam_reference_metadata,
    )
    monkeypatch.setattr(unified_analysis, "analyze_problem", fake_unified)
    monkeypatch.setattr(detect_exam_pattern, "_apply_rules", fake_apply_rules)
    monkeypatch.setattr(find_similar, "_find", fake_find)
    monkeypatch.setattr(auto_review, "_review", fake_review)
    monkeypatch.setattr(generate_embedding, "generate_embedding_async", fake_generate_embedding_async)

    result = await analysis_pipeline._process_single("textbook-1", asyncio.Semaphore(1))

    assert result["problem_id"] == "textbook-1"
    assert result["decision"] == "auto_approved"
    assert called["textbook"] is True
    assert called["exam_reference"] is False
    assert called["unified"] is False


@pytest.mark.asyncio
async def test_process_single_routes_exam_reference_solution_to_metadata_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {"exam_reference": False, "unified": False}

    async def fake_get_problem_analysis_mode(problem_id: str) -> str:
        return "reference_solution" if problem_id == "exam-1" else "default"

    async def fake_exam_reference_metadata(problem_id: str, *, model: str | None = None, max_retries: int = 3):
        called["exam_reference"] = True
        return {
            "problem_id": problem_id,
            "analysis_mode": "exam_reference_metadata_v1",
            "subject": "수학II",
            "unit_major": "미분",
        }

    async def fake_unified(problem_id: str, *, model: str | None = None, max_retries: int = 3):
        called["unified"] = True
        return {"problem_id": problem_id}

    async def fake_apply_rules(problem_id: str, prev_result: dict[str, object]) -> dict[str, object]:
        return {"problem_id": problem_id, **prev_result}

    async def fake_generate_embedding_async(problem_id: str, prev_result: dict[str, object]) -> None:
        return None

    async def fake_find(problem_id: str) -> None:
        return None

    async def fake_review(problem_id: str) -> dict[str, object]:
        return {"problem_id": problem_id, "decision": "auto_approved"}

    monkeypatch.setattr(analysis_pipeline, "_get_problem_analysis_mode", fake_get_problem_analysis_mode)

    auto_review = importlib.import_module("app.workers.auto_review")
    detect_exam_pattern = importlib.import_module("app.workers.detect_exam_pattern")
    exam_reference_metadata_analysis = importlib.import_module("app.workers.exam_reference_metadata_analysis")
    find_similar = importlib.import_module("app.workers.find_similar")
    generate_embedding = importlib.import_module("app.workers.generate_embedding")
    unified_analysis = importlib.import_module("app.workers.unified_analysis")

    monkeypatch.setattr(
        exam_reference_metadata_analysis,
        "analyze_exam_reference_metadata",
        fake_exam_reference_metadata,
    )
    monkeypatch.setattr(unified_analysis, "analyze_problem", fake_unified)
    monkeypatch.setattr(detect_exam_pattern, "_apply_rules", fake_apply_rules)
    monkeypatch.setattr(find_similar, "_find", fake_find)
    monkeypatch.setattr(auto_review, "_review", fake_review)
    monkeypatch.setattr(generate_embedding, "generate_embedding_async", fake_generate_embedding_async)

    result = await analysis_pipeline._process_single("exam-1", asyncio.Semaphore(1))

    assert result["problem_id"] == "exam-1"
    assert result["decision"] == "auto_approved"
    assert called["exam_reference"] is True
    assert called["unified"] is False
