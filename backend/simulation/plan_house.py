"""Private truth house built from any single-storey plan (simulation workstream).

The HH09 twin (``physics.build_house``) reads its rooms from the documented
twin package. A demo house of another shape is built here from a ``HomePlan``
with the same per-geometry ASSUMPTIONs, so the two kinds of house share one
physics:

* air and fabric capacity, air-fabric coupling and leakage per floor area or
  volume, exactly as in ``build_house``;
* window loss from the plan's window area (the twin's 2.0 W/m2K);
* fabric (wall, roof, floor) loss per m2 of EXPOSED envelope, transferred from
  the twin: its rooms carry 1.8 W/K per m2 of floor, which is this many W/K per
  exposed m2 (median over the four rooms), so an interior room loses less than
  a corner room;
* partitions from shared wall length x ceiling height x the twin's U-value.

Only rooms with a sensor are simulated; the public engine models the same rooms.
Never imported by diagnosis.
"""

from __future__ import annotations

import random
import statistics

from backend.app.contracts import HomePlan
from backend.app.homes import HH09_CEILING_M, HH09_EXPOSED, exposed_m2, plan_geometry

from .physics import MAX_ROOMS, PARTITION_U_W_PER_M2K, House, Room, checked_seed, finite

WALL_H_PER_FLOOR_M2 = 1.8  # build_house: wall_h = 1.8 x floor area (twin ASSUMPTION)
# the same loss per exposed m2: median over the twin's rooms of 1.8 x floor / exposed
WALL_H_PER_EXPOSED_M2 = statistics.median(
    WALL_H_PER_FLOOR_M2 * floor / (wall * HH09_CEILING_M + 2 * floor) for wall, floor in HH09_EXPOSED.values()
)


def build_plan_house(plan: HomePlan, seed: int, *, variation: float = 0.12) -> House:
    """A truth house for a plan's sensed rooms, varied per seed like the twin."""

    checked_seed(seed)
    finite(variation, "house variation", 0, 0.15)
    rng = random.Random(seed)

    def vary(value: float) -> float:
        return value * rng.uniform(1 - variation, 1 + variation)

    sensed = [r for r in plan.rooms if r.has_sensor]
    if not 1 <= len(sensed) <= MAX_ROOMS:
        raise ValueError(f"a simulated house needs 1 to {MAX_ROOMS} rooms with sensors")
    exterior, shared, windows = plan_geometry(plan)
    exposed = exposed_m2(plan, exterior)
    h = plan.ceiling_height_m
    rooms = []
    for r in sensed:
        area = r.width * r.depth
        volume = area * h
        rooms.append(
            Room(
                room_id=r.room_id,
                name=r.name,
                volume=volume,
                air_capacity=vary(1200 * volume),
                mass_capacity=vary(160000 * area),
                window_h=vary(2.0 * windows.get(r.room_id, 0.0)),
                wall_h=vary(WALL_H_PER_EXPOSED_M2 * exposed[r.room_id]),
                air_mass_h=vary(12.0 * area),
                leakage=vary(1.0),
            )
        )
    index = {r.room_id: i for i, r in enumerate(sensed)}
    edges = tuple(
        sorted(
            (min(index[a], index[b]), max(index[a], index[b]), vary(PARTITION_U_W_PER_M2K * length * h))
            for (a, b), length in shared.items()
            if a in index and b in index
        )
    )
    air = tuple(rng.uniform(20, 21) for _ in rooms)
    mass = tuple(t - rng.uniform(0.3, 1.0) for t in air)
    return House(tuple(rooms), edges, air, mass)
