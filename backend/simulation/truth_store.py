"""Private scenario state. Only simulation services may import this module."""

from __future__ import annotations

from dataclasses import dataclass

from .physics import Fault, House


@dataclass(frozen=True)
class PrivateScenario:
    healthy: House
    faulty: House
    fault: Fault
    sensor_seed: int
    experiment_night_id: str


class TruthStore:
    """No public enumeration or serialization; owned by one scenario service.

    Dependency isolation is an application boundary, not a Python sandbox.
    Callers must never expose this object to diagnosis or API responses.
    """

    def __init__(self) -> None:
        self.__records: dict[str, PrivateScenario] = {}

    def put(self, scenario_id: str, record: PrivateScenario) -> None:
        if scenario_id in self.__records:
            raise ValueError("scenario truth already exists")
        self.__records[scenario_id] = record

    def get(self, scenario_id: str) -> PrivateScenario:
        try:
            return self.__records[scenario_id]
        except KeyError:
            raise KeyError("unknown scenario") from None

    def discard(self, scenario_id: str) -> None:
        self.__records.pop(scenario_id, None)
