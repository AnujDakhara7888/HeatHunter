"""Shared API paths and the held-out benchmark report reader."""

from __future__ import annotations

from pathlib import Path

from .contracts import EvaluationSummary

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
EVALUATION_SUMMARY = REPOSITORY_ROOT / "reports" / "evaluation" / "summary.json"


def load_evaluation_summary(path: Path = EVALUATION_SUMMARY) -> EvaluationSummary | None:
    if not path.exists():
        return None
    return EvaluationSummary.model_validate_json(path.read_text(encoding="utf-8"))
