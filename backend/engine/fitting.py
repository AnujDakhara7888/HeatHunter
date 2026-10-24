"""Per-room hypothesis fitting with SciPy bounded nonlinear least squares.

Each fit uses one room's observations. Neighbour rooms enter through their
*measured* temperatures, as the specification's public model states, so rooms
are fitted independently. Measured neighbour air is converted to fabric
temperature with the same quasi-steady air relation the model uses.

Every hypothesis fits the same nuisance parameters: one starting fabric
temperature per night and one bounded sensor offset for the room. Their BIC
scores are therefore comparable; only the fault multiplier differs. The normal
hypothesis fixes all multipliers at exactly 1.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import least_squares

from backend.app.contracts import HypothesisFit, HypothesisType, NightObservations, PublicTemplate

from .model import (
    AUTO,
    Forcing,
    LeakageLaw,
    ModelExtension,
    PublicModelError,
    TemplateArrays,
    air_fraction,
    air_side_conductance,
    leakage_factor,
    resolve_extension,
    room_order,
    series_conductance,
)


@dataclass(frozen=True)
class FitSettings:
    # Skip the first minutes of each night: heating-off starts include fast
    # air/fabric transients that the quasi-steady air layer does not represent.
    transient_skip_seconds: float = 900.0
    # The air needs a few minutes to settle after each fan switch, so readings
    # within this window after a switch are excluded.
    switch_skip_seconds: float = 600.0
    # Agreed with the diagnosis controller (Mihir): fault multipliers in [0.3, 6].
    multiplier_bounds: tuple[float, float] = (0.3, 6.0)
    sensor_offset_bound_deg_c: float = 0.5
    initial_temperature_window_deg_c: float = 3.0
    min_observations: int = 8
    fault_starts: tuple[float, ...] = (1.0, 2.0, 4.0)


@dataclass(frozen=True)
class RoomNight:
    """Precomputed public inputs for one room on one night, after transient skips."""

    night_id: str
    dt: np.ndarray
    outdoor: np.ndarray
    wind: np.ndarray
    fan: np.ndarray
    own_mid: np.ndarray  # this room's measured AIR at step midpoints (drives the stack term)
    neighbour_mid: dict[int, np.ndarray]  # measured neighbour AIR at step midpoints
    obs_index: np.ndarray
    observed: np.ndarray
    obs_outdoor: np.ndarray
    obs_wind: np.ndarray
    obs_fan: np.ndarray
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class RoomPhysics:
    """Effective (hypothesis-adjusted) parameters of the room being predicted."""

    capacitance: float
    conduction: float
    infiltration: float
    wind_sensitivity: float
    fan_share: float
    air_fabric: float
    leakage_law: LeakageLaw | None = None


@dataclass(frozen=True)
class NeighbourPhysics:
    index: int
    coupling: float
    infiltration: float
    wind_sensitivity: float
    fan_share: float
    air_fabric: float
    leakage_law: LeakageLaw | None = None


def recurrence(initial: float, dt: np.ndarray, a: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Exact solution of dT/dt = -a T + c with piecewise-constant a > 0 and c.

    Returns the temperature at every grid point. It is vectorized through the
    closed form of the linear recurrence T_{k+1} = alpha_k T_k + beta_k.
    """

    alpha = np.exp(-a * dt)
    beta = (c / a) * (1.0 - alpha)
    cumulative = np.concatenate(([1.0], np.cumprod(alpha)))
    contributions = np.concatenate(([0.0], np.cumsum(beta / cumulative[1:])))
    return cumulative * (initial + contributions)


def predict_room_air(
    block: RoomNight,
    room: RoomPhysics,
    neighbours: Sequence[NeighbourPhysics],
    initial_fabric: float,
    offset: float,
) -> np.ndarray:
    """Predicted sensor readings for one room on one night, at its kept observation times."""

    factor = leakage_factor(
        room.wind_sensitivity, room.leakage_law, block.wind, block.own_mid - block.outdoor
    )
    air_side = air_side_conductance(room.infiltration, factor, room.fan_share, block.fan)
    loss = room.conduction + series_conductance(room.air_fabric, air_side)
    neighbour_total = 0.0
    neighbour_heat = np.zeros_like(block.dt)
    for n in neighbours:
        measured = block.neighbour_mid[n.index]
        n_factor = leakage_factor(n.wind_sensitivity, n.leakage_law, block.wind, measured - block.outdoor)
        n_air_side = air_side_conductance(n.infiltration, n_factor, n.fan_share, block.fan)
        fraction = air_fraction(n.air_fabric, n_air_side)
        fabric = (measured - fraction * block.outdoor) / (1.0 - fraction)
        neighbour_total += n.coupling
        neighbour_heat = neighbour_heat + n.coupling * fabric
    a = (loss + neighbour_total) / room.capacitance
    c = (loss * block.outdoor + neighbour_heat) / room.capacitance
    fabric_path = recurrence(initial_fabric, block.dt, a, c)[block.obs_index]
    obs_factor = leakage_factor(
        room.wind_sensitivity, room.leakage_law, block.obs_wind, block.observed - block.obs_outdoor
    )
    obs_air_side = air_side_conductance(room.infiltration, obs_factor, room.fan_share, block.obs_fan)
    fraction = air_fraction(room.air_fabric, obs_air_side)
    return fabric_path - fraction * (fabric_path - block.obs_outdoor) + offset


def _interpolate_measured(seconds: np.ndarray, values: np.ndarray, at: np.ndarray) -> np.ndarray | None:
    valid = np.isfinite(values)
    if valid.sum() == 0:
        return None
    if valid.sum() == 1:
        return np.full_like(at, values[valid][0])
    return np.interp(at, seconds[valid], values[valid])


def _series_array(night: NightObservations, room_id: str) -> np.ndarray:
    values = night.room_temperature_series[room_id].values
    return np.array([np.nan if v is None else float(v) for v in values])


def prepare_room_night(
    night: NightObservations, arrays: TemplateArrays, room_index: int, settings: FitSettings
) -> RoomNight:
    forcing = Forcing.from_weather(night.weather, night.protocol)
    room_id = arrays.room_ids[room_index]
    own = _series_array(night, room_id)
    eligible = forcing.seconds >= settings.transient_skip_seconds - 1e-9
    if not eligible.any():
        raise PublicModelError(f"night {night.night_id} is shorter than the transient skip")
    start = float(forcing.seconds[eligible][0])
    grid = forcing.integration_grid(start)
    dt, outdoor, wind, fan = forcing.midpoints(grid)
    mid = grid[:-1] + dt / 2
    own_mid = _interpolate_measured(forcing.seconds, own, mid)
    if own_mid is None:
        raise PublicModelError(f"{night.night_id}: room {room_id} has no readings")
    warnings: list[str] = []
    neighbour_mid: dict[int, np.ndarray] = {}
    for j in np.nonzero(arrays.coupling[room_index])[0]:
        measured = _interpolate_measured(forcing.seconds, _series_array(night, arrays.room_ids[j]), mid)
        if measured is None:
            measured = own_mid
            warnings.append(
                f"{night.night_id}: neighbour {arrays.room_ids[j]} has no readings; "
                "its coupling used this room's own readings"
            )
        neighbour_mid[int(j)] = measured
    grid_lookup = {round(float(t), 6): k for k, t in enumerate(grid)}
    settling = [(switch, switch + settings.switch_skip_seconds) for switch in forcing.switch_times]
    kept = [
        k
        for k, (t, y) in enumerate(zip(forcing.seconds, own, strict=True))
        if round(float(t), 6) in grid_lookup
        and np.isfinite(y)
        and not any(low < t <= high for low, high in settling)
    ]
    if not kept:
        raise PublicModelError(f"{night.night_id}: room {room_id} has no readings after the transient skip")
    missing = int(np.isnan(own[eligible]).sum())
    if missing:
        warnings.append(f"{night.night_id}: {missing} missing readings for {room_id} were skipped")
    kept_seconds = forcing.seconds[kept]
    return RoomNight(
        night_id=night.night_id,
        dt=dt,
        outdoor=outdoor,
        wind=wind,
        fan=fan,
        own_mid=own_mid,
        neighbour_mid=neighbour_mid,
        obs_index=np.array([grid_lookup[round(float(t), 6)] for t in kept_seconds], int),
        observed=own[kept],
        obs_outdoor=forcing.outdoor[kept],
        obs_wind=forcing.wind[kept],
        obs_fan=forcing.fan_at_readings(kept_seconds),
        warnings=tuple(warnings),
    )


@dataclass(frozen=True)
class FitResult:
    """Detailed fit; ``fit`` is the canonical contract object for diagnosis."""

    fit: HypothesisFit
    room_id: str
    n_observations: int
    n_parameters: int
    sensor_offset_deg_c: float
    initial_temperatures_deg_c: dict[str, float]
    converged: bool
    warnings: tuple[str, ...] = field(default_factory=tuple)


def bic(sse: float, n_observations: int, n_parameters: int) -> float:
    """Gaussian-likelihood BIC: n ln(SSE/n) + k ln(n). It is a fit score, not a probability."""

    sse = max(sse, 1e-12)
    return n_observations * math.log(sse / n_observations) + n_parameters * math.log(n_observations)


def hypothesis_physics(
    arrays: TemplateArrays, i: int, conduction_m: float, leakage_m: float
) -> tuple[RoomPhysics, list[NeighbourPhysics]]:
    """Room and neighbour parameters when room ``i`` has the given multipliers."""

    shares = arrays.leakage_share / arrays.leakage_share.sum()
    normalizer = 1.0 + (leakage_m - 1.0) * shares[i]
    room = RoomPhysics(
        capacitance=arrays.capacitance[i],
        conduction=conduction_m * arrays.conduction[i],
        infiltration=leakage_m * arrays.infiltration[i],
        wind_sensitivity=arrays.wind_sensitivity[i],
        fan_share=leakage_m * shares[i] / normalizer,
        air_fabric=arrays.air_fabric[i],
        leakage_law=arrays.leakage_law,
    )
    neighbours = [
        NeighbourPhysics(
            index=int(j),
            coupling=arrays.coupling[i, j],
            infiltration=arrays.infiltration[j],
            wind_sensitivity=arrays.wind_sensitivity[j],
            fan_share=shares[j] / normalizer,
            air_fabric=arrays.air_fabric[j],
            leakage_law=arrays.leakage_law,
        )
        for j in np.nonzero(arrays.coupling[i])[0]
    ]
    return room, neighbours


def fit_hypothesis_detailed(
    nights: Sequence[NightObservations],
    room_id: str,
    template: PublicTemplate,
    cause: HypothesisType,
    settings: FitSettings | None = None,
    extension: ModelExtension | None = AUTO,
) -> FitResult:
    settings = settings or FitSettings()
    cause = HypothesisType(cause)
    nights = [NightObservations.model_validate(n.model_dump()) for n in nights]
    if not nights or len({n.night_id for n in nights}) != len(nights):
        raise PublicModelError("provide one or more uniquely identified nights")
    arrays = TemplateArrays.from_template(template, resolve_extension(template, extension))
    room_order(nights, arrays)
    i = arrays.index(room_id)
    blocks = [prepare_room_night(night, arrays, i, settings) for night in nights]
    n_obs = sum(len(b.observed) for b in blocks)
    warnings = [w for b in blocks for w in b.warnings]
    has_multiplier = cause != HypothesisType.NORMAL
    first_t0 = 1 if has_multiplier else 0
    offset_index = first_t0 + len(blocks)

    def residuals(x: np.ndarray) -> np.ndarray:
        multiplier = x[0] if has_multiplier else 1.0
        room, neighbours = hypothesis_physics(
            arrays,
            i,
            multiplier if cause == HypothesisType.ENVELOPE_CONDUCTION else 1.0,
            multiplier if cause == HypothesisType.DRAFT else 1.0,
        )
        return np.concatenate(
            [
                predict_room_air(block, room, neighbours, x[first_t0 + n], x[offset_index]) - block.observed
                for n, block in enumerate(blocks)
            ]
        )

    window = settings.initial_temperature_window_deg_c
    first = [float(b.observed[0]) for b in blocks]
    lower = [p - window for p in first] + [-settings.sensor_offset_bound_deg_c]
    upper = [p + window for p in first] + [settings.sensor_offset_bound_deg_c]
    base = first + [0.0]
    low_m, high_m = settings.multiplier_bounds
    starts = [[m, *base] for m in settings.fault_starts if low_m <= m <= high_m] if has_multiplier else [base]
    if has_multiplier:
        lower, upper = [low_m, *lower], [high_m, *upper]
    n_params = len(lower)
    if n_obs < max(settings.min_observations, n_params + 2):
        raise PublicModelError(f"room {room_id} has too few readings ({n_obs}) to fit {cause.value}")

    best = None
    for start in starts:
        result = least_squares(
            residuals,
            np.array(start, float),
            bounds=(np.array(lower), np.array(upper)),
            method="trf",
            x_scale="jac",
            ftol=1e-10,
            xtol=1e-10,
            gtol=1e-10,
            max_nfev=3000,
        )
        if best is None or result.cost < best.cost:
            best = result
    sse = float(np.sum(best.fun**2))
    multiplier = float(best.x[0]) if has_multiplier else 1.0
    if has_multiplier and (
        math.isclose(multiplier, low_m, rel_tol=1e-3) or math.isclose(multiplier, high_m, rel_tol=1e-3)
    ):
        warnings.append(f"{cause.value} multiplier reached its bound ({multiplier:.3f})")
    offset = float(best.x[offset_index])
    if abs(offset) >= settings.sensor_offset_bound_deg_c * 0.999:
        warnings.append(f"sensor offset reached its bound ({offset:+.3f} degC)")
    if best.status <= 0:
        warnings.append(f"optimizer did not converge: {best.message}")
    fit = HypothesisFit(
        fault_type=cause,
        fitted_multiplier=multiplier,
        sse=sse,
        bic=bic(sse, n_obs, n_params),
        residual_rmse_deg_c=math.sqrt(sse / n_obs),
    )
    return FitResult(
        fit=fit,
        room_id=room_id,
        n_observations=n_obs,
        n_parameters=n_params,
        sensor_offset_deg_c=offset,
        initial_temperatures_deg_c={b.night_id: float(best.x[first_t0 + n]) for n, b in enumerate(blocks)},
        converged=best.status > 0,
        warnings=tuple(warnings),
    )


def fit_hypothesis(
    nights: Sequence[NightObservations],
    room_id: str,
    template: PublicTemplate,
    cause: HypothesisType,
    settings: FitSettings | None = None,
    extension: ModelExtension | None = AUTO,
) -> HypothesisFit:
    """Canonical service: fit one hypothesis for one room over one or more nights."""

    return fit_hypothesis_detailed(nights, room_id, template, cause, settings, extension).fit
