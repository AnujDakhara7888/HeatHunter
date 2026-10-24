"""Clearly synthetic public-model fixtures for engine tests (not evidence of accuracy)."""

from __future__ import annotations

import random
from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta

from backend.app.contracts import (
    InterRoomCoupling,
    Location,
    NightObservations,
    Protocol,
    Provenance,
    PublicTemplate,
    RoomTemplate,
    Series,
    SourceMetadata,
    Split,
    WeatherNight,
)
from backend.engine.model import Multipliers, PublicNightInputs, simulate_public

FAN_FLOW = 84.950541


def synthetic_weather(
    night_id: str = "synthetic-night",
    *,
    outdoor: float | Callable[[float], float] = 2.0,
    wind: float | Callable[[float], float] = 1.0,
    hours: float = 8,
    step_minutes: int = 5,
    split: Split = Split.TRAINING,
    start: datetime | None = None,
) -> WeatherNight:
    start = start or datetime(2020, 1, 1, 22, tzinfo=UTC)
    count = int(hours * 60 / step_minutes) + 1
    stamps = [start + timedelta(minutes=step_minutes * i) for i in range(count)]
    hours_elapsed = [i * step_minutes / 60 for i in range(count)]

    def values(spec: float | Callable[[float], float]) -> list[float]:
        return [spec(h) if callable(spec) else spec for h in hours_elapsed]

    return WeatherNight(
        night_id=night_id,
        source=SourceMetadata(provider="HeatHunter tests", dataset="Synthetic engine fixture"),
        location=Location(name="Synthetic test location", timezone="UTC"),
        outdoor_temperature=Series(
            timestamps=stamps, values=values(outdoor), unit="degC", provenance=Provenance.ASSUMPTION
        ),
        wind_speed=Series(
            timestamps=stamps, values=values(wind), unit="m/s", provenance=Provenance.ASSUMPTION
        ),
        train_or_heldout_split=split,
    )


def passive() -> Protocol:
    return Protocol(heating_off=True, doors_closed=True, fan_on=False)


def fan(weather: WeatherNight, hours: float = 2.0, flow: float = FAN_FLOW) -> Protocol:
    start = weather.outdoor_temperature.timestamps[0]
    return Protocol(
        heating_off=True,
        doors_closed=True,
        fan_on=True,
        fan_airflow_m3_per_h=flow,
        fan_start=start,
        fan_end=start + timedelta(hours=hours),
    )


def two_room_template(coupling: float = 8.0) -> PublicTemplate:
    return PublicTemplate(
        template_id="synthetic-two-room",
        rooms=[
            RoomTemplate(
                room_id="a",
                room_name="Room A",
                volume_m3=30.0,
                nominal_capacitance_j_per_k=3.0e6,
                nominal_envelope_conductance_w_per_k=40.0,
                nominal_infiltration_conductance_w_per_k=8.0,
                wind_sensitivity_s_per_m=0.3,
                nominal_leakage_share=0.6,
            ),
            RoomTemplate(
                room_id="b",
                room_name="Room B",
                volume_m3=20.0,
                nominal_capacitance_j_per_k=2.0e6,
                nominal_envelope_conductance_w_per_k=25.0,
                nominal_infiltration_conductance_w_per_k=5.0,
                wind_sensitivity_s_per_m=0.3,
                nominal_leakage_share=0.4,
            ),
        ],
        inter_room_couplings=[InterRoomCoupling(room_a_id="a", room_b_id="b", conductance_w_per_k=coupling)],
    )


def observe(
    template: PublicTemplate,
    weather: WeatherNight,
    protocol: Protocol,
    initial: Mapping[str, float],
    *,
    multipliers: Mapping[str, Multipliers] | None = None,
    noise: float = 0.0,
    offsets: Mapping[str, float] | None = None,
    seed: int = 0,
    drop: Mapping[str, set[int]] | None = None,
) -> NightObservations:
    """Public-model trajectories turned into labelled synthetic sensor readings."""

    truth = simulate_public(template, PublicNightInputs(weather, protocol, initial), multipliers)
    rng = random.Random(seed)
    series = {}
    for room_id, trajectory in truth.items():
        offset = (offsets or {}).get(room_id, 0.0)
        dropped = (drop or {}).get(room_id, set())
        values = [
            None if k in dropped else v + offset + (rng.gauss(0, noise) if noise else 0.0)
            for k, v in enumerate(trajectory.values)
        ]
        series[room_id] = Series(
            timestamps=trajectory.timestamps,
            values=values,
            unit="degC",
            provenance=Provenance.SIMULATED_MEASUREMENT,
        )
    return NightObservations(
        night_id=weather.night_id,
        kind="fan_test" if protocol.fan_on else "passive",
        room_temperature_series=series,
        weather=weather,
        protocol=protocol,
    )
