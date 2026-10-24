from __future__ import annotations

import random

import pytest

from backend.app.contracts import Provenance, Split
from backend.engine import load_model_extension
from backend.engine.assumptions import load_assumptions, wind_sensitivity
from backend.engine.calibration import (
    CalibrationError,
    calibrate_public_template,
    fixed_couplings,
    load_public_template,
    room_capacitances,
    twin_geometry,
)
from backend.engine.tests.helpers import fan, observe, passive, synthetic_weather

CALM = dict(outdoor=lambda h: 3 - 0.3 * h, wind=0.8)
WINDY = dict(outdoor=lambda h: 5 - 0.1 * h, wind=lambda h: 6 + 0.4 * h)


def generator_template(seed: int, spread: float):
    """Public-physics 'houses' scattered around the saved nominal template."""

    template = load_public_template()
    rng = random.Random(seed)
    rooms = [
        room.model_copy(
            update={
                "nominal_envelope_conductance_w_per_k": room.nominal_envelope_conductance_w_per_k
                * rng.uniform(1 - spread, 1 + spread),
                "nominal_infiltration_conductance_w_per_k": room.nominal_infiltration_conductance_w_per_k
                * rng.uniform(1 - spread, 1 + spread),
            }
        )
        for room in template.rooms
    ]
    return template.model_copy(update={"rooms": rooms})


def synthetic_houses(count: int = 6, spread: float = 0.05, noise: float = 0.1):
    calm = synthetic_weather("train-calm", **CALM)
    windy = synthetic_weather("train-windy", **WINDY)
    houses = []
    for h in range(count):
        template = generator_template(h, spread)
        initial = {room.room_id: 20.0 + 0.2 * i for i, room in enumerate(template.rooms)}
        houses.append(
            [
                observe(template, calm, passive(), initial, noise=noise, seed=10 * h),
                observe(template, windy, passive(), initial, noise=noise, seed=10 * h + 1),
                observe(template, calm, fan(calm), initial, noise=noise, seed=10 * h + 2),
            ]
        )
    return houses


def test_recovers_nominal_template_from_public_physics_houses():
    nominal = load_public_template()
    result = calibrate_public_template(synthetic_houses())
    for expected, recovered in zip(nominal.rooms, result.template.rooms, strict=True):
        total = (
            expected.nominal_envelope_conductance_w_per_k + expected.nominal_infiltration_conductance_w_per_k
        )
        recovered_total = (
            recovered.nominal_envelope_conductance_w_per_k
            + recovered.nominal_infiltration_conductance_w_per_k
        )
        assert recovered_total == pytest.approx(total, rel=0.06)
        assert recovered.nominal_infiltration_conductance_w_per_k == pytest.approx(
            expected.nominal_infiltration_conductance_w_per_k, rel=0.35
        )
    assert sum(r.nominal_leakage_share for r in result.template.rooms) == pytest.approx(1.0)
    assert result.report["per_house_rmse_deg_c"]["median"] == pytest.approx(0.1, abs=0.03)
    expected_air = load_model_extension().air_fabric_conductance_w_per_k
    for room_id, value in result.extension.air_fabric_conductance_w_per_k.items():
        assert value == pytest.approx(expected_air[room_id], rel=0.15)
    assert result.extension.template_id == result.template.template_id
    assert result.extension.leakage_law is not None


def test_template_uses_documented_geometry_and_sourced_anchors():
    assumptions = load_assumptions()
    rooms, edges = twin_geometry()
    template = load_public_template()
    capacitance = room_capacitances(rooms, assumptions)
    assert [(r.room_id, r.room_name, r.volume_m3) for r in template.rooms] == [
        ("living_room", "Living Room", 31.416),
        ("kitchen", "Kitchen", 13.8),
        ("bedroom_1", "Bedroom", 28.296),
        ("bedroom_2", "Hall", 6.528),
    ]
    assert [r.nominal_capacitance_j_per_k for r in template.rooms] == pytest.approx(list(capacitance))
    assert [c.conductance_w_per_k for c in template.inter_room_couplings] == pytest.approx(
        list(fixed_couplings(edges, assumptions))
    )
    assert len(template.inter_room_couplings) == 5  # includes Bedroom-Living chimney-breast wall
    assert all(r.wind_sensitivity_s_per_m == pytest.approx(wind_sensitivity()) for r in template.rooms)
    assert template.calibrated_from_split == Split.TRAINING


def test_public_coupling_assumption_differs_from_the_simulator_assumption():
    # Avoid the inverse crime: the diagnosis model must not share the simulator's partition U.
    from backend.simulation.physics import PARTITION_U_W_PER_M2K

    assert load_assumptions()["physical"]["partition_u_value"]["value"] != PARTITION_U_W_PER_M2K


def test_rejects_heldout_weather():
    houses = synthetic_houses(5)
    leaked = synthetic_weather("heldout-night", split=Split.HELDOUT, **WINDY)
    template = load_public_template()
    initial = {room.room_id: 20.0 for room in template.rooms}
    houses[0][1] = observe(template, leaked, passive(), initial)
    with pytest.raises(CalibrationError, match="held-out"):
        calibrate_public_template(houses)


def test_rejects_missing_fan_night_real_measurements_and_too_few_houses():
    houses = synthetic_houses(5)
    no_fan = [[n for n in h if n.kind == "passive"] for h in houses]
    with pytest.raises(CalibrationError, match="fan night"):
        calibrate_public_template(no_fan)

    real = [list(h) for h in houses]
    night = real[0][0]
    real[0][0] = night.model_copy(
        update={
            "room_temperature_series": {
                k: s.model_copy(update={"provenance": Provenance.REAL_MEASUREMENT})
                for k, s in night.room_temperature_series.items()
            }
        }
    )
    with pytest.raises(CalibrationError, match="simulated"):
        calibrate_public_template(real)

    with pytest.raises(CalibrationError, match="at least"):
        calibrate_public_template(houses[:3])


def test_requires_calm_and_windy_nights():
    template = load_public_template()
    initial = {room.room_id: 20.0 for room in template.rooms}
    calm_a = synthetic_weather("calm-a", **CALM)
    calm_b = synthetic_weather("calm-b", **CALM)
    houses = [
        [observe(template, calm_a, passive(), initial), observe(template, calm_b, passive(), initial)]
    ] * 5
    with pytest.raises(CalibrationError, match="calm and windy"):
        calibrate_public_template(houses)
