"""Private two-node HH09-inspired truth physics (never imported by diagnosis).

All unspecified thermal properties below are illustrative ASSUMPTIONs, not
measurements or a reconstruction of HH09. SI units; integration time is seconds.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, replace

from backend.app.contracts import FaultType
from backend.data_pipeline import load_hh09_twin_inputs


def finite(value: float, name: str, low: float, high: float) -> None:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not low <= value <= high
    ):
        raise ValueError(f"{name} must be finite and in [{low}, {high}]")


def checked_seed(seed: int) -> None:
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2**63:
        raise ValueError("seed must be an integer in [0, 2**63)")


@dataclass(frozen=True)
class Room:
    room_id: str
    name: str
    volume: float
    air_capacity: float
    mass_capacity: float
    window_h: float
    wall_h: float
    air_mass_h: float
    leakage: float

    def __post_init__(self) -> None:
        if not self.room_id or not self.name:
            raise ValueError("room ID and name are required")
        for name in ("volume", "air_capacity", "mass_capacity", "wall_h", "air_mass_h", "leakage"):
            finite(getattr(self, name), name, 1e-6, 1e10)
        finite(self.window_h, "window_h", 0, 1e5)


MAX_ROOMS = 16  # the HH09 twin has 4; a plan-built house has its sensed rooms


@dataclass(frozen=True)
class House:
    rooms: tuple[Room, ...]
    # Unique undirected edges, ensuring internal energy exchange cancels exactly.
    couplings: tuple[tuple[int, int, float], ...]
    initial_air: tuple[float, ...]
    initial_mass: tuple[float, ...]
    stack_coefficient: float = 0.025
    wind_coefficient: float = 0.06

    def __post_init__(self) -> None:
        n = len(self.rooms)
        if not 1 <= n <= MAX_ROOMS or len({r.room_id for r in self.rooms}) != n:
            raise ValueError(f"house must have 1 to {MAX_ROOMS} unique rooms")
        if len(self.initial_air) != n or len(self.initial_mass) != n:
            raise ValueError("initial states must match rooms")
        for value in (*self.initial_air, *self.initial_mass):
            finite(value, "initial temperature", -60, 80)
        finite(self.stack_coefficient, "stack coefficient", 0, 1)
        finite(self.wind_coefficient, "wind coefficient", 0, 1)
        seen = set()
        for a, b, conductance in self.couplings:
            if type(a) is not int or type(b) is not int or not (0 <= a < b < n) or (a, b) in seen:
                raise ValueError("couplings must be unique ordered room-index pairs")
            finite(conductance, "coupling", 0, 1e5)
            seen.add((a, b))


# ASSUMPTION: HH09 partition construction is unpublished. ISO 6946 surface
# resistances (2 x 0.13 m2K/W, horizontal flow) + two 12.5 mm plasterboard
# leaves (ISO 10456 gypsum, 0.25 W/mK) + unventilated stud cavity (0.18 m2K/W)
# give R = 0.54 m2K/W, U ~= 1.85 W/m2K. Closed doors are treated as partition;
# door gaps/undercut airflow are neglected.
PARTITION_U_W_PER_M2K = 1.85


def build_house(seed: int, *, variation: float = 0.12) -> House:
    """Use documented mapping/adjacency and assumed volume and thermal values.

    No real indoor measurements, HTC, or blower-door values are consumed.
    Room capacitances/conductances scale with geometry, not reference HTC.
    """
    checked_seed(seed)
    finite(variation, "house variation", 0, 0.15)
    metadata = load_hh09_twin_inputs()
    rng = random.Random(seed)

    def vary(value: float) -> float:
        return value * rng.uniform(1 - variation, 1 + variation)

    rooms = []
    for entry in metadata["rooms"]:
        geometry = entry["geometry"]
        area = float(geometry["floor_area"]["value"])
        volume = float(geometry["volume"]["value"])
        windows = sum(w["area_m2"] for w in entry["windows"]["value"])
        rooms.append(
            Room(
                room_id=entry["simulator_room_id"],
                name=entry["display_name"],
                volume=volume,
                air_capacity=vary(1200 * volume),
                mass_capacity=vary(160000 * area),
                window_h=vary(2.0 * windows),
                wall_h=vary(1.8 * area),
                air_mass_h=vary(12.0 * area),
                leakage=vary(1.0),
            )
        )
    by_source = {r["source_room_id"]: i for i, r in enumerate(metadata["rooms"])}
    areas = {}
    for boundary in metadata["shared_boundaries"]:
        a, b = sorted(by_source[source_id] for source_id in boundary["source_room_ids"])
        ceiling = float(metadata["rooms"][a]["geometry"]["ceiling_height"]["value"])
        areas[(a, b)] = float(boundary["length"]["value"]) * ceiling
    edges = tuple((a, b, vary(PARTITION_U_W_PER_M2K * areas[(a, b)])) for a, b in sorted(areas))
    air = tuple(rng.uniform(20, 21) for _ in rooms)
    mass = tuple(t - rng.uniform(0.3, 1.0) for t in air)
    return House(tuple(rooms), edges, air, mass)


@dataclass(frozen=True)
class Fault:
    fault_type: FaultType
    room_id: str | None = None
    # Canonical request severity means EXCESS multiplier: 1 -> 2x, 3 -> 4x.
    severity: float = 0.0

    def __post_init__(self) -> None:
        if not isinstance(self.fault_type, FaultType):
            raise ValueError("fault_type must be a FaultType")
        finite(self.severity, "severity", 0, 3)
        if self.fault_type == FaultType.NONE:
            if self.room_id is not None or self.severity != 0:
                raise ValueError("healthy cases have no room and zero severity")
        elif not self.room_id or self.severity <= 0:
            raise ValueError("fault requires a room and positive severity")


def inject_fault(healthy: House, fault: Fault) -> House:
    if fault.fault_type == FaultType.NONE:
        return healthy
    if fault.room_id not in {r.room_id for r in healthy.rooms}:
        raise ValueError("unknown fault room")
    field = "leakage" if fault.fault_type == FaultType.DRAFT else "wall_h"
    return replace(
        healthy,
        rooms=tuple(
            replace(r, **{field: getattr(r, field) * (1 + fault.severity)})
            if r.room_id == fault.room_id
            else r
            for r in healthy.rooms
        ),
    )


def repair_house(
    current: House, healthy: House, room_id: str, diagnosed_type: FaultType, effectiveness: float
) -> House:
    """Change only the diagnosed path, toward this house's pre-fault baseline.

    A mismatched path is already healthy and remains untouched. No fault label
    is consulted. Not a promise that every real-world wrong repair has zero benefit.
    """
    finite(effectiveness, "effectiveness", 0, 1)
    if diagnosed_type not in {FaultType.DRAFT, FaultType.ENVELOPE_CONDUCTION}:
        raise ValueError("repair requires a supported fault diagnosis")
    if tuple(r.room_id for r in current.rooms) != tuple(r.room_id for r in healthy.rooms):
        raise ValueError("repair baseline must have matching room IDs")
    if room_id not in {r.room_id for r in current.rooms}:
        raise ValueError("unknown repair room")
    field = "leakage" if diagnosed_type == FaultType.DRAFT else "wall_h"
    rooms = tuple(
        replace(r, **{field: (1 - effectiveness) * getattr(r, field) + effectiveness * getattr(base, field)})
        if r.room_id == room_id
        else r
        for r, base in zip(current.rooms, healthy.rooms, strict=True)
    )
    return replace(current, rooms=rooms)


def fan_shares(house: House) -> tuple[float, ...]:
    """Make-up air split proportional to natural leakage (L x volume).

    The same convention the public model uses: a room's fan share equals its
    share of natural infiltration conductance at equal weather.
    """
    weights = [r.leakage * r.volume for r in house.rooms]
    total = sum(weights)
    return tuple(w / total for w in weights)


def derivative(
    house: House, state: tuple[float, ...], outdoor: float, wind: float, fan_flow: float = 0
) -> tuple[float, ...]:
    """2n derivatives: the n air nodes followed by the n mass nodes."""
    n = len(house.rooms)
    air, mass = state[:n], state[n:]
    shares = fan_shares(house)
    qa, qm = [], []
    for i, r in enumerate(house.rooms):
        ach = r.leakage * math.sqrt(
            house.stack_coefficient * abs(air[i] - outdoor) + house.wind_coefficient * wind**2
        )
        infiltration_h = 0.33 * (ach * r.volume + fan_flow * shares[i])
        air_mass = r.air_mass_h * (air[i] - mass[i])
        qa.append(-(r.window_h + infiltration_h) * (air[i] - outdoor) - air_mass)
        qm.append(air_mass - r.wall_h * (mass[i] - outdoor))
    for a, b, conductance in house.couplings:
        exchange = conductance * (air[b] - air[a])
        qa[a] += exchange
        qa[b] -= exchange
    return tuple(qa[i] / r.air_capacity for i, r in enumerate(house.rooms)) + tuple(
        qm[i] / r.mass_capacity for i, r in enumerate(house.rooms)
    )
