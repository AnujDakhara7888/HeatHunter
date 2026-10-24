"""Bounded deterministic integration, weather alignment, and synthetic sensors."""

from __future__ import annotations

import hashlib
import math
import random
from bisect import bisect_right
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta

from backend.app.contracts import NightObservations, Protocol, Provenance, Series, WeatherNight

from .physics import House, checked_seed, derivative, finite

SAMPLE_SECONDS = 300
# 50 cfm * 1.69901082 m3/h per cfm. Assumed delivered airflow, not HH09 measurement.
DEFAULT_FAN_FLOW = 84.950541
FAN_SOURCE = "https://basc.pnnl.gov/resource-guides/bathroom-exhaust-fans"


def sub_seed(seed: int, purpose: str) -> int:
    checked_seed(seed)
    return int.from_bytes(hashlib.sha256(f"{seed}:{purpose}".encode()).digest()[:8], "big")


def validate_weather(weather: WeatherNight) -> None:
    # Revalidate even model_construct/mutated objects; canonical models permit NaN.
    WeatherNight.model_validate(weather.model_dump())
    validate_forcing(weather.outdoor_temperature, weather.wind_speed)


def validate_forcing(temperature: Series, wind: Series) -> None:
    if temperature.unit != "degC" or wind.unit != "m/s":
        raise ValueError("weather requires degC and m/s units")
    if temperature.timestamps != wind.timestamps:
        raise ValueError("weather timestamps must align")
    timestamps = temperature.timestamps
    if len(timestamps) < 2:
        raise ValueError("weather requires at least two timestamps")
    duration = (timestamps[-1] - timestamps[0]).total_seconds()
    if not 300 <= duration <= 18 * 3600 or duration % SAMPLE_SECONDS:
        raise ValueError("weather duration must be 5 minutes to 18 hours on a five-minute grid")
    for value in temperature.values:
        if value is None:
            raise ValueError("weather temperature cannot be missing")
        finite(value, "outdoor temperature", -60, 60)
    for value in wind.values:
        if value is None:
            raise ValueError("weather wind cannot be missing")
        finite(value, "wind speed", 0, 60)
    if any((b - a).total_seconds() > 3600 for a, b in zip(timestamps, timestamps[1:], strict=False)):
        raise ValueError("weather gap exceeds one hour; no silent long-gap interpolation")


def interpolate(times: list[float], values: list[float], t: float) -> float:
    i = max(0, min(len(times) - 2, bisect_right(times, t) - 1))
    fraction = (t - times[i]) / (times[i + 1] - times[i])
    return values[i] + fraction * (values[i + 1] - values[i])


def resample_weather(weather: WeatherNight) -> WeatherNight:
    """Linear interpolation is MODEL_ESTIMATE; preserve original station/source.

    This yields the shared contract's common weather/indoor five-minute grid.
    The data pipeline's measured source files are never modified.
    """
    validate_weather(weather)
    temperature, wind = resample_forcing(weather.outdoor_temperature, weather.wind_speed)
    payload = weather.model_dump()
    payload["outdoor_temperature"] = temperature
    payload["wind_speed"] = wind
    # Selection metadata describes the original station samples, not interpolated ones.
    return WeatherNight.model_validate(payload)


def resample_forcing(temperature: Series, wind: Series) -> tuple[Series, Series]:
    """Interpolate raw station series independently of optional location metadata."""
    temperature = Series.model_validate(temperature.model_dump())
    wind = Series.model_validate(wind.model_dump())
    validate_forcing(temperature, wind)
    start = temperature.timestamps[0].astimezone(UTC)
    times = [(t - start).total_seconds() for t in temperature.timestamps]
    grid = list(range(0, int(times[-1]) + 1, SAMPLE_SECONDS))
    timestamps = [start + timedelta(seconds=t) for t in grid]
    result = []
    for original in (temperature, wind):
        result.append(
            Series(
                timestamps=timestamps,
                values=[interpolate(times, original.values, t) for t in grid],
                unit=original.unit,
                provenance=Provenance.MODEL_ESTIMATE,
            )
        )
    return result[0], result[1]


def nighttime_weather(weather: WeatherNight) -> WeatherNight:
    """Crop HH09 18:00–06:00 cache to 22:00–06:00 (winter GMT only)."""
    validate_weather(weather)
    start = weather.outdoor_temperature.timestamps[0].astimezone(UTC)
    end = weather.outdoor_temperature.timestamps[-1].astimezone(UTC)
    desired = start.replace(hour=22, minute=0, second=0, microsecond=0)
    if start > desired or end < desired + timedelta(hours=8):
        raise ValueError("HH09 weather must cover 22:00–06:00 GMT")
    if weather.local_night_date and desired.date() != weather.local_night_date:
        raise ValueError("weather local night date disagrees with GMT coverage")
    data = weather.model_dump()
    for field in ("outdoor_temperature", "wind_speed"):
        series = getattr(weather, field)
        indices = [i for i, t in enumerate(series.timestamps) if desired <= t <= desired + timedelta(hours=8)]
        if not indices or series.timestamps[indices[0]] != desired:
            raise ValueError("HH09 source must have a recorded 22:00 sample")
        data[field] = series.model_copy(
            update={
                "timestamps": [series.timestamps[i] for i in indices],
                "values": [series.values[i] for i in indices],
            }
        )
    data["utc_window"] = {
        "start": desired,
        "end": desired + timedelta(hours=8),
        "note": "Heating-off simulation window; winter GMT assumption.",
    }
    return WeatherNight.model_validate(data)


@dataclass(frozen=True)
class SensorSettings:
    noise_sd: float = 0.15
    offset_bound: float = 0.3
    resolution: float = 0.1
    dropout_probability: float = 0.01

    def __post_init__(self) -> None:
        finite(self.noise_sd, "sensor noise", 0, 2)
        finite(self.offset_bound, "sensor offset", 0, 2)
        finite(self.resolution, "sensor resolution", 0.001, 1)
        finite(self.dropout_probability, "dropout probability", 0, 1)


@dataclass(frozen=True)
class SimulationRun:
    # Do not return this private object to the frontend/diagnosis.
    observations: NightObservations
    states: tuple[tuple[float, ...], ...]


def validate_protocol(protocol: Protocol, times: list[datetime]) -> None:
    Protocol.model_validate(protocol.model_dump())
    if not protocol.heating_off or not protocol.doors_closed:
        raise ValueError("core simulator supports only heating off, doors closed")
    if protocol.fan_on:
        finite(protocol.fan_airflow_m3_per_h, "fan airflow", 0.001, 500)
        start, end = protocol.fan_start, protocol.fan_end
        if start.tzinfo is None or end.tzinfo is None:
            raise ValueError("fan timestamps must be timezone aware")
        if not times[0] <= start < end <= times[-1]:
            raise ValueError("fan interval must lie inside the observation window")


def integrate_trajectory(
    house: House,
    outdoor_temperature: Series,
    wind_speed: Series,
    protocol: Protocol,
    *,
    max_step_seconds: float = 10.0,
) -> tuple[tuple[float, ...], ...]:
    """Metadata-independent truth physics; accepts actual station series.

    Useful for physics QA before the station-coordinate contract is resolved.
    Input timestamps must already be on the five-minute grid. No public weather
    identity or location is fabricated to run these equations.
    """
    house = replace(house, rooms=tuple(replace(r) for r in house.rooms))
    finite(max_step_seconds, "integration step", 0.05, 30)
    outdoor_temperature = Series.model_validate(outdoor_temperature.model_dump())
    wind_speed = Series.model_validate(wind_speed.model_dump())
    validate_forcing(outdoor_temperature, wind_speed)
    if any(
        (b - a).total_seconds() != SAMPLE_SECONDS
        for a, b in zip(outdoor_temperature.timestamps, outdoor_temperature.timestamps[1:], strict=False)
    ):
        raise ValueError("integration forcing must use a five-minute grid")
    validate_protocol(protocol, outdoor_temperature.timestamps)
    start = outdoor_temperature.timestamps[0]
    times = [(t - start).total_seconds() for t in outdoor_temperature.timestamps]
    outdoor = outdoor_temperature.values
    wind = wind_speed.values
    fan_start = (protocol.fan_start - start).total_seconds() if protocol.fan_on else -1
    fan_end = (protocol.fan_end - start).total_seconds() if protocol.fan_on else -1
    fan_flow = protocol.fan_airflow_m3_per_h if protocol.fan_on else 0.0
    state = (*house.initial_air, *house.initial_mass)
    lower, upper = min(*state, *outdoor), max(*state, *outdoor)
    # A diagonal outflow bound protects tiny capacitances / large conductances.
    max_delta = max(abs(upper - min(outdoor)), abs(lower - max(outdoor)))
    leakage_sum = sum(r.leakage for r in house.rooms)
    step = max_step_seconds
    for i, r in enumerate(house.rooms):
        ach = r.leakage * math.sqrt(
            house.stack_coefficient * max_delta + house.wind_coefficient * max(wind) ** 2
        )
        outflow = (
            r.window_h
            + r.air_mass_h
            + 0.33 * (ach * r.volume + fan_flow * r.leakage / leakage_sum)
            + sum(h for a, b, h in house.couplings if i in (a, b))
        )
        step = min(step, 0.4 * r.air_capacity / outflow, 0.4 * r.mass_capacity / (r.air_mass_h + r.wall_h))
    if step < 0.01 or times[-1] / step > 250000:
        raise ValueError("thermal parameters require an excessive integration workload")

    states = [tuple(state)]
    elapsed = 0.0
    for target in times[1:]:
        while elapsed < target - 1e-8:
            boundary = min([target] + [t for t in (fan_start, fan_end) if t > elapsed + 1e-8])
            dt = min(step, boundary - elapsed)
            active_flow = fan_flow if fan_start <= elapsed + dt / 2 < fan_end else 0.0

            def rhs(t: float, y: tuple[float, ...], flow: float = active_flow) -> tuple[float, ...]:
                return derivative(house, y, interpolate(times, outdoor, t), interpolate(times, wind, t), flow)

            k1 = rhs(elapsed, state)
            k2 = rhs(elapsed + dt / 2, tuple(y + dt * k / 2 for y, k in zip(state, k1, strict=True)))
            k3 = rhs(elapsed + dt / 2, tuple(y + dt * k / 2 for y, k in zip(state, k2, strict=True)))
            k4 = rhs(elapsed + dt, tuple(y + dt * k for y, k in zip(state, k3, strict=True)))
            state = tuple(
                y + dt * (a + 2 * b + 2 * c + d) / 6
                for y, a, b, c, d in zip(state, k1, k2, k3, k4, strict=True)
            )
            if any(not math.isfinite(y) or not lower - 1e-7 <= y <= upper + 1e-7 for y in state):
                raise ArithmeticError("integration violated passive thermal bounds")
            elapsed += dt
        states.append(state)

    return tuple(states)


def simulate_night(
    house: House,
    weather: WeatherNight,
    protocol: Protocol,
    *,
    sensor_seed: int,
    sensors: SensorSettings | None = None,
    max_step_seconds: float = 10.0,
) -> SimulationRun:
    """RK4 with a conservative stability bound and exact protocol boundaries.

    External input and public models are defensively copied/validated. Noise
    streams are independent of integration steps and dropout draws, allowing
    paired repairs and convergence checks with identical measurement errors.
    """
    checked_seed(sensor_seed)
    # frozen dataclasses can still be bypassed by hostile callers; validate deeply.
    house = replace(house, rooms=tuple(replace(r) for r in house.rooms))
    finite(max_step_seconds, "integration step", 0.05, 30)
    weather = resample_weather(weather)
    validate_protocol(protocol, weather.outdoor_temperature.timestamps)
    sensors = sensors or SensorSettings()
    sensors = replace(sensors)
    states = integrate_trajectory(
        house, weather.outdoor_temperature, weather.wind_speed, protocol, max_step_seconds=max_step_seconds
    )

    series = {}
    for i, room in enumerate(house.rooms):
        offsets = random.Random(sub_seed(sensor_seed, f"offset:{room.room_id}"))
        noise = random.Random(sub_seed(sensor_seed, f"noise:{weather.night_id}:{room.room_id}"))
        drops = random.Random(sub_seed(sensor_seed, f"drop:{weather.night_id}:{room.room_id}"))
        offset = offsets.uniform(-sensors.offset_bound, sensors.offset_bound)
        values = []
        for row in states:
            measured = row[i] + offset + noise.gauss(0, sensors.noise_sd)
            rounded = round(round(measured / sensors.resolution) * sensors.resolution, 6)
            values.append(None if drops.random() < sensors.dropout_probability else rounded)
        series[room.room_id] = Series(
            timestamps=weather.outdoor_temperature.timestamps,
            values=values,
            unit="degC",
            provenance=Provenance.SIMULATED_MEASUREMENT,
        )
    observations = NightObservations(
        night_id=weather.night_id,
        kind="fan_test" if protocol.fan_on else "passive",
        room_temperature_series=series,
        weather=weather,
        protocol=protocol.model_copy(deep=True),
    )
    return SimulationRun(observations, tuple(states))


def passive_protocol() -> Protocol:
    return Protocol(heating_off=True, doors_closed=True, fan_on=False)


def fan_protocol(start: datetime, *, airflow: float = DEFAULT_FAN_FLOW) -> Protocol:
    return Protocol(
        heating_off=True,
        doors_closed=True,
        fan_on=True,
        fan_airflow_m3_per_h=airflow,
        fan_start=start,
        fan_end=start + timedelta(hours=2),
    )
