from __future__ import annotations

from datetime import UTC, datetime

import pytest

from backend.app.contracts import DiagnosisStatus, FaultType
from backend.evaluation import EvaluationRecord, evaluate_records


def _records() -> list[EvaluationRecord]:
    return [
        EvaluationRecord(
            "healthy-correct",
            FaultType.NONE,
            None,
            DiagnosisStatus.NO_FAULT,
            None,
            None,
            baseline_strategy_correct=True,
        ),
        EvaluationRecord(
            "healthy-false-positive",
            FaultType.NONE,
            None,
            DiagnosisStatus.CONFIDENT,
            FaultType.DRAFT,
            "bedroom_1",
            baseline_strategy_correct=False,
        ),
        EvaluationRecord(
            "draft-correct",
            FaultType.DRAFT,
            "bedroom_1",
            DiagnosisStatus.CONFIDENT,
            FaultType.DRAFT,
            "bedroom_1",
            baseline_strategy_correct=True,
        ),
        EvaluationRecord(
            "draft-ambiguous-then-correct",
            FaultType.DRAFT,
            "kitchen",
            DiagnosisStatus.AMBIGUOUS,
            None,
            "kitchen",
            experiment_recommended=True,
            experiment_run=True,
            post_status=DiagnosisStatus.CONFIDENT,
            post_predicted_fault_type=FaultType.DRAFT,
            post_predicted_room_id="kitchen",
            baseline_strategy_correct=False,
        ),
        EvaluationRecord(
            "conduction-correct",
            FaultType.ENVELOPE_CONDUCTION,
            "living_room",
            DiagnosisStatus.CONFIDENT,
            FaultType.ENVELOPE_CONDUCTION,
            "living_room",
            baseline_strategy_correct=True,
        ),
        EvaluationRecord(
            "conduction-unexplained",
            FaultType.ENVELOPE_CONDUCTION,
            "bedroom_2",
            DiagnosisStatus.UNEXPLAINED,
            None,
            None,
            baseline_strategy_correct=False,
        ),
    ]


def test_metrics_are_computed_with_documented_denominators() -> None:
    summary = evaluate_records(
        _records(),
        benchmark_id="unit-test-only",
        generated_at=datetime(2025, 1, 1, tzinfo=UTC),
    )

    assert summary.heldout_scenario_count == 6
    assert summary.fault_detection_accuracy == pytest.approx(3 / 6)
    assert summary.room_identification_accuracy == pytest.approx(2 / 4)
    assert summary.pre_experiment_cause_classification_accuracy == pytest.approx(3 / 6)
    assert summary.post_experiment_cause_classification_accuracy == 1.0
    assert summary.baseline_strategy_accuracy == 0.5
    assert summary.false_positive_rate == 0.5
    assert summary.ambiguity_rate == pytest.approx(1 / 6)
    assert summary.unexplained_rate == pytest.approx(1 / 6)


def test_confusion_matrix_retains_ambiguous_and_unexplained_outcomes() -> None:
    summary = evaluate_records(_records(), benchmark_id="unit-test-only")
    counts = summary.pre_experiment_confusion_matrix.counts

    assert counts["draft"]["ambiguous"] == 1
    assert counts["envelope_conduction"]["unexplained"] == 1
    assert counts["none"]["draft"] == 1


def test_evaluation_refuses_empty_or_duplicate_scenario_sets() -> None:
    with pytest.raises(ValueError, match="at least one"):
        evaluate_records([], benchmark_id="empty")

    record = _records()[0]
    with pytest.raises(ValueError, match="unique"):
        evaluate_records([record, record], benchmark_id="duplicate")


def test_record_enforces_hidden_truth_consistency() -> None:
    with pytest.raises(ValueError, match="cannot have an actual room"):
        EvaluationRecord(
            "invalid",
            FaultType.NONE,
            "bedroom_1",
            DiagnosisStatus.NO_FAULT,
            None,
            None,
        )
