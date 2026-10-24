"""Disclosed training demonstrations, separate from independent evaluation.

These definitions plant faults only. Diagnosis never receives this module or
the selected fault, and still has to earn its result through actual fitting.
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.app.contracts import FaultType

from .physics import Fault

GUIDED_SCENARIO_ID = "hh09-guided-v1"
GUIDED_INSULATION_ID = "hh09-guided-insulation-v1"


@dataclass(frozen=True)
class GuidedExample:
    seed: int
    fault: Fault
    passive_weather: str | None = None
    fan_weather: str | None = None


def guided_example(example_id: str) -> GuidedExample:
    if example_id in {GUIDED_SCENARIO_ID, "synthetic-guided-draft-01"}:
        return GuidedExample(20261024, Fault(FaultType.DRAFT, "bedroom_1", 2))
    if example_id == GUIDED_INSULATION_ID:
        return GuidedExample(
            961029,
            Fault(FaultType.ENVELOPE_CONDUCTION, "bedroom_2", 1),
            "smeter-hh09-2020-12-06",
            "smeter-hh09-2019-12-01",
        )
    raise ValueError(f"unknown guided scenario: {example_id}")
