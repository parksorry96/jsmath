"""Tests for auto-review confidence helpers."""

from app.workers.auto_review import _compute_ai_confidence


def test_compute_ai_confidence_averages_classification_and_solution() -> None:
    assert _compute_ai_confidence(0.9, 0.7) == 0.8


def test_compute_ai_confidence_uses_single_available_signal() -> None:
    assert _compute_ai_confidence(0.82, None) == 0.82
    assert _compute_ai_confidence(None, 0.64) == 0.64


def test_compute_ai_confidence_clamps_each_signal_before_averaging() -> None:
    assert _compute_ai_confidence(1.2, -0.2) == 0.5
