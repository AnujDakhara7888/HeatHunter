"""Public single-node-per-room RC model used for diagnosis (Kailash).

Each room has ONE dynamic temperature: its fabric (walls, furniture, thermal
mass) T_f. The measured room air is a quasi-steady layer. It settles within
minutes between the fabric and the incoming outdoor air, so it is algebraic,
not a second dynamic state. SI units: degC, W/K, J/K, seconds.

    H_air,i(t) = H_win,i + m_l H_inf0,i f_i(w, dT) + fan(t) 0.33 Q share_i
    H_ser,i    = H_af,i H_air,i / (H_af,i + H_air,i)      (air path in series)
    C_i dT_f,i/dt = -[m_c H_cond,i + H_ser,i(t)] (T_f,i - T_out)
                    + sum_j H_ij (T_f,j - T_f,i)
    T_air,i    = T_f,i - H_air,i / (H_af,i + H_air,i) (T_f,i - T_out)
    share_i    = m_l,i s_i / sum_j m_l,j s_j

The leakage law f is either:

* linear wind-only, ``1 + beta w`` (the specification's simplified form), or
* the ASHRAE/LBL stack-plus-wind relation,
  ``sqrt((dT + (Cw/Cs) w^2) / dT_ref)``, where leakage also rises with the
  indoor-outdoor difference dT.

Windows (H_win = published glazing U-value x documented window area) cool
the room air directly, in parallel with infiltration: glass has negligible
thermal mass. A draft multiplier scales infiltration only, never the glazing.

The engine-owned ``ModelExtension`` (calibrated air-fabric conductance H_af,
the leakage law and the fixed window conductances) is keyed by
``template_id``. Without an extension, H_af is infinite, there is no separate
window path and the law is linear, so the model reduces exactly to the
specification's single-node form with T_air = T_f.

This module reads only public inputs. It never imports simulator code or truth.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import numpy as np
from scipy.linalg import expm

from backend.app.contracts import (
    NightObservations,
    Protocol,
    Provenance,
    PublicTemplate,
    Series,
    WeatherNight,
)

SENSIBLE_AIR_FACTOR = 0.33  # W/K per m3/h of air exchange
MIN_STACK_DELTA_T = 0.5  # K; keeps the stack term well-defined near equilibrium
TEMPLATE_DIR = Path(__file__).resolve().parent / "templates"
DEFAULT_EXTENSION_PATH = TEMPLATE_DIR / "hh09_model_extension.json"


class PublicModelError(ValueError):
    """Raised for inputs the public model cannot evaluate honestly."""


@dataclass(frozen=True)
class Multipliers:
    """Hypothesis multipliers on a room's envelope conduction and air leakage paths."""

    conduction: float = 1.0
    leakage: float = 1.0

    def __post_init__(self) -> None:
        for name in ("conduction", "leakage"):
            number = getattr(self, name)
            if isinstance(number, bool) or not math.isfinite(number) or number <= 0:
                raise PublicModelError(f"{name} multiplier must be finite and positive")


@dataclass(frozen=True)
class LeakageLaw:
    """ASHRAE/LBL stack-plus-wind leakage scaling, normalized to 1 in calm air at ``reference_delta_t_k``."""

    stack_wind_ratio: float  # Cw / Cs in K s^2 / m^2
    reference_delta_t_k: float

    def __post_init__(self) -> None:
        for name in ("stack_wind_ratio", "reference_delta_t_k"):
            number = getattr(self, name)
            if not math.isfinite(number) or number <= 0:
                raise PublicModelError(f"{name} must be finite and positive")


def leakage_factor(wind_sensitivity, law: LeakageLaw | None, wind, delta_t):
    """Multiplier on calm reference infiltration conductance H_inf0."""

    wind = np.asarray(wind, float)
    if law is None:
        return 1.0 + wind_sensitivity * wind
    delta_t = np.maximum(np.abs(np.asarray(delta_t, float)), MIN_STACK_DELTA_T)
    return np.sqrt((delta_t + law.stack_wind_ratio * wind**2) / law.reference_delta_t_k)


@dataclass(frozen=True)
class ModelExtension:
    """Engine-owned physics for one template: air-fabric and window conductances, leakage law.

    It is kept outside the canonical ``PublicTemplate`` contract, which has no
    fields for it, and is keyed by ``template_id`` so it cannot be paired with
    the wrong template.
    """

    template_id: str
    air_fabric_conductance_w_per_k: Mapping[str, float] = field(default_factory=dict)
    leakage_law: LeakageLaw | None = None
    provenance: str = Provenance.MODEL_ESTIMATE.value
    note: str = ""
    window_conductance_w_per_k: Mapping[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for room_id, value in self.air_fabric_conductance_w_per_k.items():
            if isinstance(value, bool) or not math.isfinite(value) or value <= 0:
                raise PublicModelError(f"air-fabric conductance for {room_id} must be finite and positive")
        for room_id, value in self.window_conductance_w_per_k.items():
            if isinstance(value, bool) or not math.isfinite(value) or value < 0:
                raise PublicModelError(f"window conductance for {room_id} must be finite and non-negative")

    def save(self, path: Path | None = None) -> Path:
        path = Path(path or DEFAULT_EXTENSION_PATH)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "template_id": self.template_id,
            "air_fabric_conductance_w_per_k": dict(self.air_fabric_conductance_w_per_k),
            "window_conductance_w_per_k": dict(self.window_conductance_w_per_k),
            "leakage_law": None
            if self.leakage_law is None
            else {
                "stack_wind_ratio": self.leakage_law.stack_wind_ratio,
                "reference_delta_t_k": self.leakage_law.reference_delta_t_k,
            },
            "provenance": self.provenance,
            "note": self.note,
        }
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return path


def load_model_extension(path: str | Path | None = None) -> ModelExtension:
    path = Path(path or DEFAULT_EXTENSION_PATH)
    if not path.is_file():
        raise FileNotFoundError(
            f"Calibrated model extension missing: {path}. Run scripts/calibrate_public_template.py"
        )
    payload = json.loads(path.read_text(encoding="utf-8"))
    law = payload.get("leakage_law")
    return ModelExtension(
        template_id=payload["template_id"],
        air_fabric_conductance_w_per_k={
            k: float(v) for k, v in payload["air_fabric_conductance_w_per_k"].items()
        },
        leakage_law=None if law is None else LeakageLaw(**law),
        provenance=payload.get("provenance", Provenance.MODEL_ESTIMATE.value),
        note=payload.get("note", ""),
        window_conductance_w_per_k={
            k: float(v) for k, v in payload.get("window_conductance_w_per_k", {}).items()
        },
    )


class _Auto:
    def __repr__(self) -> str:
        return "AUTO"


AUTO = _Auto()
"""Use the saved calibrated extension when it matches the template, else none."""


def resolve_extension(
    template: PublicTemplate, extension: ModelExtension | None | _Auto = AUTO
) -> ModelExtension | None:
    if not isinstance(extension, _Auto):
        return extension
    try:
        saved = load_model_extension()
    except FileNotFoundError:
        return None
    return saved if saved.template_id == template.template_id else None


@dataclass(frozen=True)
class TemplateArrays:
    """Vectorized view of a ``PublicTemplate`` (plus optional extension) in room order."""

    room_ids: tuple[str, ...]
    capacitance: np.ndarray
    conduction: np.ndarray
    infiltration: np.ndarray
    wind_sensitivity: np.ndarray
    leakage_share: np.ndarray
    coupling: np.ndarray  # symmetric W/K matrix with zero diagonal
    air_fabric: np.ndarray  # W/K; inf means no air layer (single-node limit)
    leakage_law: LeakageLaw | None = None
    window: np.ndarray | None = None  # W/K glazing on the air side; None means no separate path

    def __post_init__(self) -> None:
        if self.window is None:
            object.__setattr__(self, "window", np.zeros(len(self.room_ids)))

    @classmethod
    def from_template(
        cls, template: PublicTemplate, extension: ModelExtension | None = None
    ) -> TemplateArrays:
        template = PublicTemplate.model_validate(template.model_dump())
        room_ids = tuple(room.room_id for room in template.rooms)
        index = {room_id: i for i, room_id in enumerate(room_ids)}
        coupling = np.zeros((len(room_ids), len(room_ids)))
        for edge in template.inter_room_couplings:
            if edge.room_a_id not in index or edge.room_b_id not in index or edge.room_a_id == edge.room_b_id:
                raise PublicModelError("template coupling references an unknown or identical room")
            a, b = index[edge.room_a_id], index[edge.room_b_id]
            if coupling[a, b]:
                raise PublicModelError("template contains a duplicate coupling")
            coupling[a, b] = coupling[b, a] = edge.conductance_w_per_k
        air_fabric = np.full(len(room_ids), np.inf)
        window = np.zeros(len(room_ids))
        law = None
        if extension is not None:
            if extension.template_id != template.template_id:
                raise PublicModelError("model extension was calibrated for a different public template")
            if extension.air_fabric_conductance_w_per_k:
                if set(extension.air_fabric_conductance_w_per_k) != set(room_ids):
                    raise PublicModelError("model extension must cover exactly the template rooms")
                air_fabric = np.array([extension.air_fabric_conductance_w_per_k[r] for r in room_ids], float)
            if extension.window_conductance_w_per_k:
                if set(extension.window_conductance_w_per_k) != set(room_ids):
                    raise PublicModelError("model extension windows must cover exactly the template rooms")
                window = np.array([extension.window_conductance_w_per_k[r] for r in room_ids], float)
            law = extension.leakage_law
        return cls(
            room_ids=room_ids,
            capacitance=np.array([r.nominal_capacitance_j_per_k for r in template.rooms], float),
            conduction=np.array([r.nominal_envelope_conductance_w_per_k for r in template.rooms], float),
            infiltration=np.array(
                [r.nominal_infiltration_conductance_w_per_k for r in template.rooms], float
            ),
            wind_sensitivity=np.array([r.wind_sensitivity_s_per_m for r in template.rooms], float),
            leakage_share=np.array([r.nominal_leakage_share for r in template.rooms], float),
            coupling=coupling,
            air_fabric=air_fabric,
            leakage_law=law,
            window=window,
        )

    def index(self, room_id: str) -> int:
        try:
            return self.room_ids.index(room_id)
        except ValueError:
            raise PublicModelError(f"room {room_id!r} is not in the public template") from None


def leakage_shares(nominal_shares: np.ndarray, leakage_multipliers: np.ndarray) -> np.ndarray:
    """Fan make-up air shares under hypothesis leakage multipliers.

    With one candidate room i and normalized nominal shares this reduces to the
    specification's ``m s_i / (sum(s) + (m - 1) s_i)``.
    """

    weighted = np.asarray(leakage_multipliers, float) * np.asarray(nominal_shares, float)
    total = weighted.sum()
    if total <= 0:
        raise PublicModelError("leakage shares must have a positive total")
    return weighted / total


def air_side_conductance(infiltration, factor, fan_share, fan_flow, window=0.0):
    """Glazing + infiltration (scaled by the leakage law factor) + fan conductance on the room air (W/K)."""

    return window + infiltration * factor + SENSIBLE_AIR_FACTOR * fan_flow * fan_share


def series_conductance(air_fabric, air_side):
    """Fabric -> air -> outdoors path; equals ``air_side`` when there is no air layer."""

    air_fabric = np.asarray(air_fabric, float)
    air_side = np.asarray(air_side, float)
    with np.errstate(invalid="ignore"):
        return np.where(np.isinf(air_fabric), air_side, air_fabric * air_side / (air_fabric + air_side))


def air_fraction(air_fabric, air_side):
    """How far the air sits from the fabric toward outdoors (0 = air equals fabric)."""

    air_fabric = np.asarray(air_fabric, float)
    air_side = np.asarray(air_side, float)
    with np.errstate(invalid="ignore"):
        return np.where(np.isinf(air_fabric), 0.0, air_side / (air_fabric + air_side))


@dataclass(frozen=True)
class Forcing:
    """Outdoor forcing and protocol on one night's timestamps."""

    night_id: str
    timestamps: tuple[datetime, ...]
    seconds: np.ndarray
    outdoor: np.ndarray
    wind: np.ndarray
    fan_flow_m3_per_h: float
    fan_start_s: float | None
    fan_end_s: float | None

    @classmethod
    def from_weather(cls, weather: WeatherNight, protocol: Protocol) -> Forcing:
        weather = WeatherNight.model_validate(weather.model_dump())
        protocol = Protocol.model_validate(protocol.model_dump())
        if not protocol.heating_off:
            raise PublicModelError("the public model supports heating-off protocols only")
        timestamps = tuple(weather.outdoor_temperature.timestamps)
        if len(timestamps) < 2:
            raise PublicModelError("weather must contain at least two timestamps")
        outdoor = weather.outdoor_temperature.values
        wind = weather.wind_speed.values
        if any(v is None or not math.isfinite(v) for v in (*outdoor, *wind)):
            raise PublicModelError("weather forcing cannot contain missing or non-finite values")
        start = timestamps[0]
        seconds = np.array([(t - start).total_seconds() for t in timestamps], float)
        fan_start = fan_end = None
        flow = 0.0
        if protocol.fan_on:
            flow = float(protocol.fan_airflow_m3_per_h)
            fan_start = (protocol.fan_start - start).total_seconds()
            fan_end = (protocol.fan_end - start).total_seconds()
        return cls(
            night_id=weather.night_id,
            timestamps=timestamps,
            seconds=seconds,
            outdoor=np.array(outdoor, float),
            wind=np.array(wind, float),
            fan_flow_m3_per_h=flow,
            fan_start_s=fan_start,
            fan_end_s=fan_end,
        )

    @property
    def switch_times(self) -> tuple[float, ...]:
        return tuple(t for t in (self.fan_start_s, self.fan_end_s) if t is not None)

    def integration_grid(self, start_s: float = 0.0) -> np.ndarray:
        """Observation times from ``start_s`` plus fan switching instants inside the window."""

        points = [t for t in self.seconds if t >= start_s - 1e-9]
        for boundary in self.switch_times:
            if points[0] < boundary < points[-1]:
                points.append(boundary)
        return np.unique(np.round(np.array(points, float), 6))

    def midpoints(self, grid: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Step lengths and midpoint outdoor temperature, wind and fan airflow."""

        dt = np.diff(grid)
        mid = grid[:-1] + dt / 2
        outdoor = np.interp(mid, self.seconds, self.outdoor)
        wind = np.interp(mid, self.seconds, self.wind)
        fan = np.zeros_like(mid)
        if self.fan_start_s is not None and self.fan_end_s is not None:
            fan[(mid >= self.fan_start_s) & (mid < self.fan_end_s)] = self.fan_flow_m3_per_h
        return dt, outdoor, wind, fan

    def fan_at_readings(self, seconds: np.ndarray) -> np.ndarray:
        """Fan airflow seen by readings at ``seconds``.

        Air lags the switch by a few minutes, so a reading exactly at switch-on
        is still pre-fan and a reading exactly at switch-off still shows the fan.
        """

        fan = np.zeros_like(np.asarray(seconds, float))
        if self.fan_start_s is not None and self.fan_end_s is not None:
            fan[(seconds > self.fan_start_s) & (seconds <= self.fan_end_s)] = self.fan_flow_m3_per_h
        return fan


@dataclass(frozen=True)
class PublicNightInputs:
    """Inputs for a forward public-model run with no indoor observations."""

    weather: WeatherNight
    protocol: Protocol
    initial_temperatures: Mapping[str, float]


def _multiplier_vectors(
    arrays: TemplateArrays, multipliers: Mapping[str, Multipliers] | None
) -> tuple[np.ndarray, np.ndarray]:
    conduction = np.ones(len(arrays.room_ids))
    leakage = np.ones(len(arrays.room_ids))
    for room_id, multiplier in (multipliers or {}).items():
        i = arrays.index(room_id)
        conduction[i] = multiplier.conduction
        leakage[i] = multiplier.leakage
    return conduction, leakage


def simulate_trajectory(
    arrays: TemplateArrays,
    forcing: Forcing,
    initial_air: np.ndarray,
    multipliers: Mapping[str, Multipliers] | None = None,
) -> np.ndarray:
    """Coupled forward run; returns room AIR temperatures (rooms x observation times).

    Each step holds coefficients constant and advances the fabric states
    exactly with a matrix exponential. The stack term uses the fabric-outdoor
    difference at the start of each five-minute step, the only state-dependent
    input. Initial values are air readings, converted to fabric temperatures
    with the same quasi-steady relation.
    """

    initial_air = np.asarray(initial_air, float)
    if initial_air.shape != (len(arrays.room_ids),) or not np.all(np.isfinite(initial_air)):
        raise PublicModelError("initial temperatures must be finite for every template room")
    conduction_m, leakage_m = _multiplier_vectors(arrays, multipliers)
    shares = leakage_shares(arrays.leakage_share, leakage_m)
    infiltration = leakage_m * arrays.infiltration
    law = arrays.leakage_law

    def air_side(wind, fan, delta_t):
        factor = leakage_factor(arrays.wind_sensitivity, law, wind, delta_t)
        return air_side_conductance(infiltration, factor, shares, fan, arrays.window)

    fan_obs = forcing.fan_at_readings(forcing.seconds)
    fraction0 = air_fraction(
        arrays.air_fabric, air_side(forcing.wind[0], fan_obs[0], initial_air - forcing.outdoor[0])
    )
    state = (initial_air - fraction0 * forcing.outdoor[0]) / (1.0 - fraction0)

    grid = forcing.integration_grid()
    dt, outdoor, wind, fan = forcing.midpoints(grid)
    n = len(arrays.room_ids)
    coupling_out = arrays.coupling.sum(axis=1)
    fabric = {0.0: state.copy()}
    augmented = np.zeros((n + 1, n + 1))
    for k in range(len(dt)):
        h_air = air_side(wind[k], fan[k], state - outdoor[k])
        exterior = conduction_m * arrays.conduction + series_conductance(arrays.air_fabric, h_air)
        augmented[:n, :n] = (arrays.coupling - np.diag(exterior + coupling_out)) / arrays.capacitance[:, None]
        augmented[:n, n] = exterior * outdoor[k] / arrays.capacitance
        step = expm(augmented * dt[k])
        state = step[:n, :n] @ state + step[:n, n]
        fabric[round(float(grid[k + 1]), 6)] = state.copy()
    fabric_obs = np.array([fabric[round(float(t), 6)] for t in forcing.seconds]).T
    air = np.empty_like(fabric_obs)
    for k in range(len(forcing.seconds)):
        h_air = air_side(forcing.wind[k], fan_obs[k], fabric_obs[:, k] - forcing.outdoor[k])
        fraction = air_fraction(arrays.air_fabric, h_air)
        air[:, k] = fabric_obs[:, k] - fraction * (fabric_obs[:, k] - forcing.outdoor[k])
    return air


def simulate_public(
    template: PublicTemplate,
    night_inputs: PublicNightInputs | NightObservations,
    multipliers: Mapping[str, Multipliers] | None = None,
    extension: ModelExtension | None | _Auto = AUTO,
) -> dict[str, Series]:
    """Forward-simulate every template room's air temperature (``MODEL_ESTIMATE``).

    ``night_inputs`` may be explicit forward inputs or observed nights. For
    observed nights, each room's first reading is the initial condition, so it
    must be present.
    """

    arrays = TemplateArrays.from_template(template, resolve_extension(template, extension))
    if isinstance(night_inputs, NightObservations):
        night = NightObservations.model_validate(night_inputs.model_dump())
        weather, protocol = night.weather, night.protocol
        initial_map = {}
        for room_id in arrays.room_ids:
            series = night.room_temperature_series.get(room_id)
            if series is None or series.values[0] is None:
                raise PublicModelError(f"room {room_id} has no first reading for the initial condition")
            initial_map[room_id] = series.values[0]
    else:
        weather, protocol = night_inputs.weather, night_inputs.protocol
        initial_map = dict(night_inputs.initial_temperatures)
    if set(initial_map) != set(arrays.room_ids):
        raise PublicModelError("initial temperatures must cover exactly the template rooms")
    forcing = Forcing.from_weather(weather, protocol)
    initial = np.array([float(initial_map[room_id]) for room_id in arrays.room_ids])
    trajectory = simulate_trajectory(arrays, forcing, initial, multipliers)
    return {
        room_id: Series(
            timestamps=list(forcing.timestamps),
            values=[float(v) for v in trajectory[i]],
            unit="degC",
            provenance=Provenance.MODEL_ESTIMATE,
        )
        for i, room_id in enumerate(arrays.room_ids)
    }


def room_order(nights: Sequence[NightObservations], arrays: TemplateArrays) -> None:
    """Check that every observed night covers exactly the template rooms."""

    for night in nights:
        if set(night.room_temperature_series) != set(arrays.room_ids):
            raise PublicModelError("observed rooms must match the public template rooms")
