"""Hidden-fault demo home for the monitoring API (simulation workstream).

A demo home is one simulated HH09-twin house watched over consecutive real
weather nights from the HELD-OUT winter, so the demo is never shown on the
data the flag rule was tuned on. Its planted fault, house parameters and
sensor seed stay inside this object. Callers only receive public
``NightObservations``. The truth leaves through ``reveal()`` alone.

``apply_manual_fix`` stands in for the person doing a repair in the room. It
changes only the chosen path in the chosen room, back toward this house's own
healthy value, and from the next night on. A repair of the wrong path or room
honestly changes nothing.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date
from typing import Literal

from backend.app.contracts import FaultType, NightObservations, Split
from backend.data_pipeline.weather_timeline import night_dates, timeline_night

from .observations import nighttime_weather, passive_protocol, simulate_night, sub_seed
from .physics import Fault, build_house, checked_seed, inject_fault, repair_house

MAX_NIGHTS = 28
RANDOM_SEVERITIES = (0.6, 1.2, 2.0)
FixAction = Literal["seal_leaks", "add_insulation", "other"]
FIXED_PATH = {"seal_leaks": FaultType.DRAFT, "add_insulation": FaultType.ENVELOPE_CONDUCTION}


@dataclass(frozen=True)
class DemoTruth:
    fault_type: FaultType
    room_id: str | None
    severity: float  # excess multiplier: 1.2 means the path is 2.2x its healthy value


class DemoHome:
    def __init__(
        self,
        *,
        seed: int,
        fault: Fault | None = None,
        random_fault: bool = False,
        start_date: date | None = None,
    ) -> None:
        checked_seed(seed)
        if fault is not None and random_fault:
            raise ValueError("give a fault or ask for a random one, not both")
        rng = random.Random(sub_seed(seed, "demo-selection"))
        healthy = build_house(sub_seed(seed, "demo-house") % 2**63)
        rooms = [room.room_id for room in healthy.rooms]
        if random_fault:
            fault_type = rng.choice(list(FaultType))
            fault = (
                Fault(FaultType.NONE)
                if fault_type == FaultType.NONE
                else Fault(fault_type, rng.choice(rooms), rng.choice(RANDOM_SEVERITIES))
            )
        fault = fault or Fault(FaultType.NONE)
        if fault.room_id is not None and fault.room_id not in rooms:
            raise ValueError(f"unknown room {fault.room_id!r}")
        dates = night_dates(Split.HELDOUT.value)
        if start_date is None:
            start = rng.randrange(len(dates) - MAX_NIGHTS + 1)
        elif start_date in dates and dates.index(start_date) + MAX_NIGHTS <= len(dates):
            start = dates.index(start_date)
        else:
            raise ValueError(f"start_date must leave {MAX_NIGHTS} nights in the held-out winter")
        self.__healthy = healthy
        self.__current = inject_fault(healthy, fault)
        self.__fault = fault
        self.__sensor_seed = sub_seed(seed, "demo-sensors") % 2**63
        self._dates = dates[start : start + MAX_NIGHTS]
        self._next = 0
        self.room_ids = tuple(rooms)

    @property
    def nights_simulated(self) -> int:
        return self._next

    @property
    def nights_remaining(self) -> int:
        return len(self._dates) - self._next

    @property
    def next_night_date(self) -> date | None:
        return self._dates[self._next] if self.nights_remaining else None

    def _observe(self, house, index: int) -> NightObservations:
        weather = nighttime_weather(timeline_night(Split.HELDOUT.value, self._dates[index]))
        return simulate_night(house, weather, passive_protocol(), sensor_seed=self.__sensor_seed).observations

    def next_nights(self, count: int) -> list[NightObservations]:
        if not 1 <= count <= self.nights_remaining:
            raise ValueError(f"can advance 1 to {self.nights_remaining} nights")
        out = [self._observe(self.__current, self._next + k) for k in range(count)]
        self._next += count
        return out

    def apply_manual_fix(self, room_id: str, action: FixAction, effectiveness: float = 1.0) -> None:
        if room_id not in self.room_ids:
            raise ValueError(f"unknown room {room_id!r}")
        if action in FIXED_PATH:
            self.__current = repair_house(
                self.__current, self.__healthy, room_id, FIXED_PATH[action], effectiveness
            )

    def reveal(self) -> DemoTruth:
        return DemoTruth(self.__fault.fault_type, self.__fault.room_id, self.__fault.severity)

    def fault_free_night(self, index: int) -> NightObservations:
        """The same night, weather and sensor errors on the house without its planted fault."""

        if not 0 <= index < self._next:
            raise ValueError("night has not been simulated yet")
        return self._observe(self.__healthy, index)
