"""Calibrate the nominal public template from healthy TRAINING observations only.

Absolute scale comes from a sourced assumption: room capacitance = SAP
"medium" thermal mass x documented floor area + air capacity. Cooling data
reveals only loss/capacity, so this anchor fixes the units of every fitted
conductance.

For each healthy training house, all rooms are fitted jointly. Measured
neighbour temperatures drive the coupling. The fitted parameters are:

* envelope conductance H_cond and calm reference infiltration conductance
  H_inf0 for each room. Leakage follows the ASHRAE/LBL stack+wind relation
  with published coefficients, so calm and windy nights, and the night's
  falling indoor-outdoor difference, separate H_inf0 (which varies with
  weather) from H_cond (which does not). The template's
  wind_sensitivity_s_per_m stores the linearized wind equivalent for the
  contract;
* one air-fabric coefficient per house (W/K per m2 of floor area), fixed by
  the fast air dip on healthy fan nights;
* NOT fitted: window conductance = published SAP glazing U-value x documented
  window area, on the air side in parallel with infiltration. Without it the
  fit folds glazing into H_inf0, so a draft multiplier would scale the windows
  too and windy nights would wrongly make glazing loss wind-dependent;
* nuisance: a start fabric temperature per (night, room) and a sensor offset
  per room.

Inter-room coupling is NOT fitted. Passive cooling cannot identify it: rooms
cool in near-lockstep, and the sensor offsets absorb the small temperature
differences. It is fixed at an assumed partition U-value x plan-derived wall
area. The nominal template is the median of the per-house estimates.
"""

from __future__ import annotations

import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from scipy.optimize import least_squares
from scipy.sparse import lil_matrix

from backend.app.contracts import (
    InterRoomCoupling,
    NightObservations,
    Provenance,
    PublicTemplate,
    RoomTemplate,
    Split,
)
from backend.data_pipeline import load_hh09_twin_inputs

from .assumptions import load_assumptions, stack_wind_ratio, value, wind_sensitivity
from .fitting import FitSettings, NeighbourPhysics, RoomPhysics, predict_room_air, prepare_room_night
from .model import (
    TEMPLATE_DIR,
    LeakageLaw,
    ModelExtension,
    PublicModelError,
    TemplateArrays,
    leakage_factor,
    series_conductance,
)

DEFAULT_TEMPLATE_PATH = TEMPLATE_DIR / "hh09_public_template.json"
DEFAULT_REPORT_PATH = TEMPLATE_DIR / "hh09_calibration_report.json"
MIN_HOUSES = 5


class CalibrationError(ValueError):
    """Raised when calibration inputs could leak held-out data or cannot identify parameters."""


@dataclass(frozen=True)
class RoomGeometry:
    room_id: str
    name: str
    volume_m3: float
    floor_area_m2: float
    window_area_m2: float = 0.0


@dataclass(frozen=True)
class SharedWall:
    room_a: str
    room_b: str
    area_m2: float


@dataclass(frozen=True)
class CalibrationResult:
    template: PublicTemplate
    extension: ModelExtension
    report: dict[str, Any]


def twin_geometry(twin: dict[str, Any] | None = None) -> tuple[list[RoomGeometry], list[SharedWall]]:
    """Public HH09 geometry (Anuj's reader): room order, names, volumes, areas and shared walls."""

    twin = twin or load_hh09_twin_inputs()
    rooms = [
        RoomGeometry(
            room_id=room["simulator_room_id"],
            name=room["display_name"],
            volume_m3=float(room["geometry"]["volume"]["value"]),
            floor_area_m2=float(room["geometry"]["floor_area"]["value"]),
            window_area_m2=float(sum(w["area_m2"] for w in room["windows"]["value"])),
        )
        for room in twin["rooms"]
    ]
    by_source = {room["source_room_id"]: room["simulator_room_id"] for room in twin["rooms"]}
    ceiling = {
        room["simulator_room_id"]: float(room["geometry"]["ceiling_height"]["value"])
        for room in twin["rooms"]
    }
    order = [room.room_id for room in rooms]
    edges = []
    for boundary in twin["shared_boundaries"]:
        a, b = sorted((by_source[s] for s in boundary["source_room_ids"]), key=order.index)
        edges.append(SharedWall(a, b, float(boundary["length"]["value"]) * min(ceiling[a], ceiling[b])))
    edges.sort(key=lambda wall: (order.index(wall.room_a), order.index(wall.room_b)))
    return rooms, edges


def room_capacitances(rooms: Sequence[RoomGeometry], assumptions: dict[str, Any]) -> np.ndarray:
    tmp = value(assumptions, "physical", "thermal_mass_parameter")
    air = value(assumptions, "physical", "air_volumetric_heat_capacity")
    return np.array([tmp * room.floor_area_m2 + air * room.volume_m3 for room in rooms])


def window_conductances(rooms: Sequence[RoomGeometry], assumptions: dict[str, Any]) -> np.ndarray:
    """Glazing conductance (W/K): published SAP double-glazing U-value x documented window area."""

    u_value = value(assumptions, "physical", "window_u_value")
    return np.array([u_value * room.window_area_m2 for room in rooms])


def fixed_couplings(edges: Sequence[SharedWall], assumptions: dict[str, Any]) -> np.ndarray:
    """Inter-room conductance (W/K): assumed partition U-value x plan-derived wall area."""

    return np.array([value(assumptions, "physical", "partition_u_value") * wall.area_m2 for wall in edges])


def _validate_training(houses: Sequence[Sequence[NightObservations]], room_ids: set[str]) -> list[list]:
    if len(houses) < MIN_HOUSES:
        raise CalibrationError(f"at least {MIN_HOUSES} healthy training houses are required")
    validated = []
    for house in houses:
        nights = [NightObservations.model_validate(n.model_dump()) for n in house]
        keys = [(n.night_id, n.kind) for n in nights]
        if len(set(keys)) != len(keys):
            raise CalibrationError("each training house needs distinct (night, protocol) observations")
        for night in nights:
            if night.weather.train_or_heldout_split != Split.TRAINING:
                raise CalibrationError("calibration accepts TRAINING weather only; held-out data leaked")
            if set(night.room_temperature_series) != room_ids:
                raise CalibrationError("observed rooms must match the HH09 twin rooms")
            series = night.room_temperature_series.values()
            if any(s.provenance != Provenance.SIMULATED_MEASUREMENT for s in series):
                raise CalibrationError("calibration accepts simulated healthy training observations only")
        passive = [n for n in nights if n.kind == "passive"]
        if len(passive) < 2:
            raise CalibrationError("each house needs at least two passive nights")
        winds = [float(np.mean(n.weather.wind_speed.values)) for n in passive]
        if max(winds) - min(winds) < 2.0:
            raise CalibrationError(
                "each house needs calm and windy passive nights (mean wind spread >= 2 m/s)"
            )
        if not any(n.kind == "fan_test" for n in nights):
            raise CalibrationError("each house needs a healthy fan night to identify the air layer")
        validated.append(nights)
    return validated


def _fit_house(
    nights: list[NightObservations],
    rooms: list[RoomGeometry],
    coupling: np.ndarray,
    capacitance: np.ndarray,
    glazing: np.ndarray,
    beta: float,
    law: LeakageLaw,
    settings: FitSettings,
) -> dict[str, Any]:
    r_count, n_count = len(rooms), len(nights)
    areas = np.array([room.floor_area_m2 for room in rooms])
    arrays = TemplateArrays(
        room_ids=tuple(room.room_id for room in rooms),
        capacitance=capacitance,
        conduction=np.ones(r_count),
        infiltration=np.ones(r_count),
        wind_sensitivity=np.full(r_count, beta),
        leakage_share=np.full(r_count, 1.0 / r_count),
        coupling=coupling,
        air_fabric=np.full(r_count, np.inf),
        leakage_law=law,
        window=glazing,
    )
    blocks = [[prepare_room_night(night, arrays, r, settings) for r in range(r_count)] for night in nights]
    neighbours_of = [np.nonzero(coupling[r])[0] for r in range(r_count)]
    cond, inf = slice(0, r_count), slice(r_count, 2 * r_count)
    haf_index = 2 * r_count
    t0_start = haf_index + 1
    offset_start = t0_start + n_count * r_count

    def residuals(x: np.ndarray) -> np.ndarray:
        h_cond, h_inf, h_af = x[cond], x[inf], x[haf_index] * areas
        shares = h_inf / h_inf.sum()
        chunks = []
        for n, night_blocks in enumerate(blocks):
            for r, block in enumerate(night_blocks):
                room = RoomPhysics(
                    capacitance[r], h_cond[r], h_inf[r], beta, shares[r], h_af[r], law, glazing[r]
                )
                neighbours = [
                    NeighbourPhysics(
                        int(j), coupling[r, j], h_inf[j], beta, shares[j], h_af[j], law, glazing[j]
                    )
                    for j in neighbours_of[r]
                ]
                prediction = predict_room_air(
                    block, room, neighbours, x[t0_start + n * r_count + r], x[offset_start + r]
                )
                chunks.append(prediction - block.observed)
        return np.concatenate(chunks)

    sizes = [len(block.observed) for night_blocks in blocks for block in night_blocks]
    sparsity = lil_matrix((sum(sizes), offset_start + r_count), dtype=int)
    row = 0
    for n in range(n_count):
        for r in range(r_count):
            rows = slice(row, row + sizes[n * r_count + r])
            for column in (r, haf_index, t0_start + n * r_count + r, offset_start + r):
                sparsity[rows, column] = 1
            for j in range(r_count):  # all leakages set the fan shares
                sparsity[rows, r_count + j] = 1
            row += sizes[n * r_count + r]

    window = settings.initial_temperature_window_deg_c
    bound = settings.sensor_offset_bound_deg_c
    first = np.array([float(blocks[n][r].observed[0]) for n in range(n_count) for r in range(r_count)])
    scale = capacitance / (15 * 3600)
    x0 = np.concatenate([0.8 * scale, 0.15 * scale, [10.0], first, np.zeros(r_count)])
    lower = np.concatenate(
        [np.full(r_count, 0.5), np.full(r_count, 0.05), [0.5], first - window, np.full(r_count, -bound)]
    )
    upper = np.concatenate(
        [np.full(r_count, 1000.0), np.full(r_count, 300.0), [500.0], first + window, np.full(r_count, bound)]
    )
    result = least_squares(
        residuals,
        np.clip(x0, lower, upper),
        bounds=(lower, upper),
        jac_sparsity=sparsity,
        method="trf",
        x_scale="jac",
        ftol=1e-10,
        xtol=1e-10,
        gtol=1e-10,
        max_nfev=5000,
    )
    physical = result.x[:t0_start]
    at_bound = np.isclose(physical, lower[:t0_start], rtol=1e-3) | np.isclose(
        physical, upper[:t0_start], rtol=1e-3
    )
    return {
        "envelope": result.x[cond].tolist(),
        "infiltration": result.x[inf].tolist(),
        "air_fabric_per_m2": float(result.x[haf_index]),
        "offsets": result.x[offset_start:].tolist(),
        "rmse_deg_c": float(math.sqrt(np.mean(result.fun**2))),
        "converged": bool(result.status > 0),
        "physical_parameters_at_bound": int(at_bound.sum()),
    }


def _summary(values: np.ndarray) -> dict[str, float]:
    q1, median, q3 = np.percentile(values, [25, 50, 75])
    return {"median": float(median), "q1": float(q1), "q3": float(q3)}


def calibrate_public_template(
    healthy_training_nights: Sequence[Sequence[NightObservations]],
    *,
    twin: dict[str, Any] | None = None,
    assumptions: dict[str, Any] | None = None,
    settings: FitSettings | None = None,
    template_id: str = "hh09-public-template-v1",
) -> CalibrationResult:
    """Calibrate a nominal template; the input is a list of houses, each a list of nights.

    Only simulated, healthy TRAINING nights are accepted: passive nights (calm
    and windy) plus at least one fan night per house. Diagnosis is never told
    which held-out houses exist, so held-out data cannot leak in.
    """

    assumptions = assumptions or load_assumptions()
    settings = settings or FitSettings()
    rooms, edges = twin_geometry(twin)
    houses = _validate_training(healthy_training_nights, {room.room_id for room in rooms})
    capacitance = room_capacitances(rooms, assumptions)
    window = window_conductances(rooms, assumptions)
    couplings = fixed_couplings(edges, assumptions)
    index = {room.room_id: i for i, room in enumerate(rooms)}
    coupling = np.zeros((len(rooms), len(rooms)))
    for wall, h in zip(edges, couplings, strict=True):
        a, b = index[wall.room_a], index[wall.room_b]
        coupling[a, b] = coupling[b, a] = h
    beta = wind_sensitivity(assumptions)
    law = LeakageLaw(*stack_wind_ratio(assumptions))
    fits = [
        _fit_house(nights, rooms, coupling, capacitance, window, beta, law, settings) for nights in houses
    ]

    envelope = np.array([fit["envelope"] for fit in fits])
    infiltration = np.array([fit["infiltration"] for fit in fits])
    air_per_m2 = np.array([fit["air_fabric_per_m2"] for fit in fits])
    envelope_nominal = np.median(envelope, axis=0)
    infiltration_nominal = np.median(infiltration, axis=0)
    shares = infiltration_nominal / infiltration_nominal.sum()
    air_fabric = float(np.median(air_per_m2)) * np.array([room.floor_area_m2 for room in rooms])
    warnings = []
    bounded = sum(fit["physical_parameters_at_bound"] > 0 for fit in fits)
    if bounded:
        warnings.append(f"{bounded} house fits had a physical parameter at its bound")

    template = PublicTemplate(
        template_id=template_id,
        rooms=[
            RoomTemplate(
                room_id=room.room_id,
                room_name=room.name,
                volume_m3=room.volume_m3,
                nominal_capacitance_j_per_k=float(capacitance[r]),
                nominal_envelope_conductance_w_per_k=float(envelope_nominal[r]),
                nominal_infiltration_conductance_w_per_k=float(infiltration_nominal[r]),
                wind_sensitivity_s_per_m=beta,
                nominal_leakage_share=float(shares[r]),
            )
            for r, room in enumerate(rooms)
        ],
        inter_room_couplings=[
            InterRoomCoupling(room_a_id=wall.room_a, room_b_id=wall.room_b, conductance_w_per_k=float(h))
            for wall, h in zip(edges, couplings, strict=True)
        ],
    )
    extension = ModelExtension(
        template_id=template_id,
        air_fabric_conductance_w_per_k={room.room_id: float(air_fabric[r]) for r, room in enumerate(rooms)},
        leakage_law=law,
        window_conductance_w_per_k={room.room_id: float(window[r]) for r, room in enumerate(rooms)},
        note=(
            "Air-fabric: median per-house coefficient x documented floor area (healthy TRAINING fan nights). "
            "Leakage law: ASHRAE/LBL one-storey shelter-class-3 stack+wind relation (config assumptions). "
            "Windows: SAP 2012 Table 6e double-glazing U-value x documented window area (not fitted)."
        ),
    )
    mean_wind = value(assumptions, "economic", "heating_season_mean_wind_speed")
    seasonal_factor = float(leakage_factor(beta, law, mean_wind, law.reference_delta_t_k))
    seasonal_air_side = window + infiltration_nominal * seasonal_factor
    seasonal = envelope_nominal + series_conductance(air_fabric, seasonal_air_side)
    report = {
        "template_id": template_id,
        "method": "per-house joint fit of healthy simulated TRAINING passive + fan nights; median of houses",
        "house_count": len(houses),
        "nights_per_house": sorted({len(nights) for nights in houses}),
        "observations": sorted({f"{n.night_id}:{n.kind}" for nights in houses for n in nights}),
        "wind_sensitivity_s_per_m_linearized": beta,
        "leakage_law": {
            "stack_wind_ratio": law.stack_wind_ratio,
            "reference_delta_t_k": law.reference_delta_t_k,
        },
        "capacitance_anchor": "SAP 2012 Table 1f medium TMP x documented floor area + air capacity",
        "air_fabric_w_per_m2_k": _summary(air_per_m2),
        "rooms": {
            room.room_id: {
                "capacitance_j_per_k": float(capacitance[r]),
                "envelope_conductance_w_per_k": _summary(envelope[:, r]),
                "infiltration_conductance_w_per_k": _summary(infiltration[:, r]),
                "air_fabric_conductance_w_per_k": float(air_fabric[r]),
                "window_conductance_w_per_k": float(window[r]),
                "leakage_share": float(shares[r]),
                "seasonal_effective_conductance_w_per_k": float(seasonal[r]),
            }
            for r, room in enumerate(rooms)
        },
        "couplings_fixed_w_per_k": {
            f"{wall.room_a}|{wall.room_b}": float(h) for wall, h in zip(edges, couplings, strict=True)
        },
        "coupling_basis": "ASSUMPTION: partition U-value x plan-derived shared wall area; not fitted",
        "window_basis": (
            "ASSUMPTION: SAP 2012 Table 6e double-glazing U-value x documented window area; not fitted"
        ),
        "per_house_rmse_deg_c": _summary(np.array([fit["rmse_deg_c"] for fit in fits])),
        "unconverged_houses": sum(not fit["converged"] for fit in fits),
        "four_room_total_conductance_at_season_mean_wind_w_per_k": float(seasonal.sum()),
        "reference_check": (
            "HH09's measured co-heating HTC is 172 W/K for the whole dwelling, including the bathroom and "
            "closets the four-room twin omits. It is a reference sanity check only; it was not used to fit."
        ),
        "warnings": warnings,
        "provenance": Provenance.MODEL_ESTIMATE.value,
    }
    return CalibrationResult(template=template, extension=extension, report=report)


def save_calibration(
    result: CalibrationResult,
    template_path: Path | None = None,
    report_path: Path | None = None,
    extension_path: Path | None = None,
) -> tuple[Path, Path, Path]:
    template_path = Path(template_path or DEFAULT_TEMPLATE_PATH)
    report_path = Path(report_path or DEFAULT_REPORT_PATH)
    template_path.parent.mkdir(parents=True, exist_ok=True)
    template_path.write_text(result.template.model_dump_json(indent=2) + "\n", encoding="utf-8")
    report_path.write_text(json.dumps(result.report, indent=2) + "\n", encoding="utf-8")
    return template_path, report_path, result.extension.save(extension_path)


def load_public_template(path: str | Path | None = None) -> PublicTemplate:
    """Load the saved, calibrated HH09 public template (offline)."""

    path = Path(path or DEFAULT_TEMPLATE_PATH)
    if not path.is_file():
        raise FileNotFoundError(
            f"Calibrated public template missing: {path}. Run scripts/calibrate_public_template.py"
        )
    template = PublicTemplate.model_validate_json(path.read_text(encoding="utf-8"))
    if template.calibrated_from_split != Split.TRAINING:
        raise PublicModelError("public template must be calibrated from training data")
    return template
