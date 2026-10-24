"""Compute transparent benchmark metrics from held-out scenario records."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from backend.app.contracts import (
    ConfusionMatrix,
    DiagnosisStatus,
    EvaluationSummary,
    FaultType,
)

from .models import EvaluationRecord

ACTUAL_LABELS = [FaultType.DRAFT.value, FaultType.ENVELOPE_CONDUCTION.value, FaultType.NONE.value]
PREDICTED_LABELS = [*ACTUAL_LABELS, DiagnosisStatus.AMBIGUOUS.value, DiagnosisStatus.UNEXPLAINED.value]


def _prediction_label(status: DiagnosisStatus, predicted_fault: FaultType | None) -> str:
    if status == DiagnosisStatus.NO_FAULT:
        return FaultType.NONE.value
    if status == DiagnosisStatus.AMBIGUOUS:
        return DiagnosisStatus.AMBIGUOUS.value
    if status == DiagnosisStatus.UNEXPLAINED:
        return DiagnosisStatus.UNEXPLAINED.value
    if predicted_fault not in {FaultType.DRAFT, FaultType.ENVELOPE_CONDUCTION}:
        raise ValueError("confident diagnosis must predict draft or envelope_conduction")
    return predicted_fault.value


def _confusion_matrix(actual: list[str], predicted: list[str]) -> ConfusionMatrix:
    counts = {
        actual_label: {predicted_label: 0 for predicted_label in PREDICTED_LABELS}
        for actual_label in ACTUAL_LABELS
    }
    for actual_label, predicted_label in zip(actual, predicted, strict=True):
        counts[actual_label][predicted_label] += 1
    return ConfusionMatrix(
        actual_labels=ACTUAL_LABELS,
        predicted_labels=PREDICTED_LABELS,
        counts=counts,
    )


def _ratio(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        raise ValueError("metric denominator must be positive")
    return numerator / denominator


def evaluate_records(
    records: Iterable[EvaluationRecord],
    *,
    benchmark_id: str,
    generated_at: datetime | None = None,
) -> EvaluationSummary:
    """Compute a summary without tuning thresholds or reading simulator internals.

    Post-experiment accuracy is calculated only over scenarios where an experiment
    actually ran. Baseline accuracy is calculated only when every record contains
    an independently computed baseline result.
    """

    rows = list(records)
    if not rows:
        raise ValueError("at least one held-out evaluation record is required")
    if len({row.scenario_id for row in rows}) != len(rows):
        raise ValueError("scenario IDs must be unique")
    if generated_at is None:
        generated_at = datetime.now(UTC)
    if generated_at.tzinfo is None:
        raise ValueError("generated_at must be timezone-aware")

    actual = [row.actual_fault_type.value for row in rows]
    pre_predicted = [_prediction_label(row.pre_status, row.pre_predicted_fault_type) for row in rows]
    fault_detection_correct = sum(
        (actual_label == FaultType.NONE.value and predicted_label == FaultType.NONE.value)
        or (
            actual_label != FaultType.NONE.value
            and predicted_label in {FaultType.DRAFT.value, FaultType.ENVELOPE_CONDUCTION.value}
        )
        for actual_label, predicted_label in zip(actual, pre_predicted, strict=True)
    )
    faulty_rows = [row for row in rows if row.actual_fault_type != FaultType.NONE]
    room_correct = sum(
        row.pre_status == DiagnosisStatus.CONFIDENT and row.pre_predicted_room_id == row.actual_room_id
        for row in faulty_rows
    )
    healthy_rows = [row for row in rows if row.actual_fault_type == FaultType.NONE]
    if not healthy_rows:
        raise ValueError("false-positive evaluation requires at least one healthy scenario")
    false_positives = sum(row.pre_status == DiagnosisStatus.CONFIDENT for row in healthy_rows)

    experimented = [row for row in rows if row.experiment_run]
    post_matrix: ConfusionMatrix | None = None
    post_accuracy: float | None = None
    if experimented:
        post_actual = [row.actual_fault_type.value for row in experimented]
        post_predicted = [
            _prediction_label(row.post_status, row.post_predicted_fault_type)  # type: ignore[arg-type]
            for row in experimented
        ]
        post_matrix = _confusion_matrix(post_actual, post_predicted)
        post_accuracy = _ratio(
            sum(a == p for a, p in zip(post_actual, post_predicted, strict=True)),
            len(experimented),
        )

    baseline_values = [row.baseline_strategy_correct for row in rows]
    baseline_accuracy = None
    if all(value is not None for value in baseline_values):
        baseline_accuracy = _ratio(sum(bool(value) for value in baseline_values), len(rows))

    return EvaluationSummary(
        benchmark_id=benchmark_id,
        generated_at=generated_at,
        heldout_scenario_count=len(rows),
        fault_detection_accuracy=_ratio(fault_detection_correct, len(rows)),
        room_identification_accuracy=_ratio(room_correct, len(faulty_rows)),
        pre_experiment_cause_classification_accuracy=_ratio(
            sum(a == p for a, p in zip(actual, pre_predicted, strict=True)),
            len(rows),
        ),
        post_experiment_cause_classification_accuracy=post_accuracy,
        baseline_strategy_accuracy=baseline_accuracy,
        false_positive_rate=_ratio(false_positives, len(healthy_rows)),
        ambiguity_rate=_ratio(
            sum(row.pre_status == DiagnosisStatus.AMBIGUOUS for row in rows),
            len(rows),
        ),
        unexplained_rate=_ratio(
            sum(row.pre_status == DiagnosisStatus.UNEXPLAINED for row in rows),
            len(rows),
        ),
        pre_experiment_confusion_matrix=_confusion_matrix(actual, pre_predicted),
        post_experiment_confusion_matrix=post_matrix,
        disclaimer=(
            "Diagnosis accuracy on held-out simulated scenarios. This synthetic benchmark is not a "
            "real-home field trial."
        ),
    )
