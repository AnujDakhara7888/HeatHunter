from __future__ import annotations

import math
from dataclasses import replace
from datetime import timedelta

import pytest

from backend.app.contracts import FaultType, Series
from backend.data_pipeline import list_weather_nights, load_weather_night
from backend.simulation.observations import (
    SensorSettings,
    fan_protocol,
    integrate_trajectory,
    passive_protocol,
    resample_forcing,
    simulate_night,
)
from backend.simulation.physics import (
    Fault,
    build_house,
    derivative,
    fan_shares,
    inject_fault,
    repair_house,
)
from backend.simulation.tests.helpers import synthetic_weather


def test_hh09_mapping_and_symmetric_topology():
    house = build_house(1, variation=0)
    assert [(r.room_id, r.name, r.volume) for r in house.rooms] == [
        ("living_room", "Living Room", 31.416),
        ("kitchen", "Kitchen", 13.8),
        ("bedroom_1", "Bedroom", 28.296),
        ("bedroom_2", "Hall", 6.528),
    ]
    # Includes the Bedroom-Living chimney-breast wall (0, 2) from the floor plan.
    assert {(a, b) for a, b, _ in house.couplings} == {(0, 1), (0, 2), (0, 3), (1, 2), (2, 3)}
    conductance = {(a, b): h for a, b, h in house.couplings}
    # Geometry-based: living-kitchen 3.14 m x 2.4 m x 1.85 W/m2K.
    assert conductance[(0, 1)] == pytest.approx(1.85 * 3.14 * 2.4)
    assert conductance[(0, 1)] > conductance[(2, 3)]


def test_internal_exchange_cancels_and_external_energy_balance():
    house = build_house(4)
    state = (20.0, 19.0, 18.0, 17.0, 16.0, 15.0, 14.0, 13.0)
    rates = derivative(house, state, 0, 0)
    total = sum(r.air_capacity * rates[i] + r.mass_capacity * rates[i + 4] for i, r in enumerate(house.rooms))
    expected = -sum(
        (r.window_h + 0.33 * r.volume * r.leakage * math.sqrt(house.stack_coefficient * state[i])) * state[i]
        + r.wall_h * state[i + 4]
        for i, r in enumerate(house.rooms)
    )
    assert total == pytest.approx(expected, abs=1e-9)
    assert total < 0


def test_equilibrium_is_stationary_even_with_fan():
    house = build_house(2)
    assert derivative(house, (5.0,) * 8, 5.0, 10.0, 85.0) == (0.0,) * 8


def test_constant_outdoor_passive_equilibrium_solution():
    house = build_house(3)
    house = replace(
        house,
        initial_air=(10.0,) * 4,
        initial_mass=(10.0,) * 4,
        couplings=(),
        stack_coefficient=0,
        wind_coefficient=0,
        rooms=tuple(
            replace(r, window_h=20, wall_h=1e-6, air_mass_h=1e-6, air_capacity=100000) for r in house.rooms
        ),
    )
    weather = synthetic_weather(temperature=0, hours=2)
    result = simulate_night(house, weather, passive_protocol(), sensor_seed=1)
    assert result.states[-1][0] == pytest.approx(10 * math.exp(-20 * 7200 / 100000), abs=2e-6)


def test_rk4_convergence_and_fan_boundary_not_on_step():
    house = build_house(4)
    weather = synthetic_weather(hours=3)
    protocol = fan_protocol(weather.outdoor_temperature.timestamps[0] + timedelta(seconds=17))
    a = simulate_night(house, weather, protocol, sensor_seed=1, max_step_seconds=30)
    b = simulate_night(house, weather, protocol, sensor_seed=1, max_step_seconds=2)
    assert (
        max(
            abs(x - y) for sa, sb in zip(a.states, b.states, strict=True) for x, y in zip(sa, sb, strict=True)
        )
        < 2e-5
    )


@pytest.mark.parametrize("kind", [FaultType.DRAFT, FaultType.ENVELOPE_CONDUCTION])
def test_faults_change_only_the_selected_path_and_correct_repair_restores_baseline(kind):
    healthy = build_house(7)
    faulty = inject_fault(healthy, Fault(kind, "bedroom_1", 2))
    assert faulty != healthy
    assert faulty.initial_air == healthy.initial_air
    assert faulty.rooms[0] == healthy.rooms[0]
    assert repair_house(faulty, healthy, "bedroom_1", kind, 1) == healthy
    assert repair_house(faulty, healthy, "bedroom_1", kind, 0) == faulty
    half = repair_house(faulty, healthy, "bedroom_1", kind, 0.5)
    field = "leakage" if kind == FaultType.DRAFT else "wall_h"
    assert getattr(half.rooms[2], field) == pytest.approx(2 * getattr(healthy.rooms[2], field))
    wrong = FaultType.ENVELOPE_CONDUCTION if kind == FaultType.DRAFT else FaultType.DRAFT
    assert repair_house(faulty, healthy, "bedroom_1", wrong, 1) == faulty
    assert repair_house(faulty, healthy, "kitchen", kind, 1) == faulty


def test_fan_energy_is_conserved_across_leakage_shares():
    house = inject_fault(build_house(9), Fault(FaultType.DRAFT, "bedroom_1", 3))
    state = (20.0,) * 8
    before = derivative(house, state, 0, 0, 0)
    after = derivative(house, state, 0, 0, 85)
    extra_loss = sum(r.air_capacity * (before[i] - after[i]) for i, r in enumerate(house.rooms))
    assert extra_loss == pytest.approx(0.33 * 85 * 20, abs=1e-9)
    room_loss = [r.air_capacity * (before[i] - after[i]) for i, r in enumerate(house.rooms)]
    assert room_loss[2] > max(room_loss[:2] + room_loss[3:])
    weights = [r.leakage * r.volume for r in house.rooms]
    for loss, weight in zip(room_loss, weights, strict=True):
        assert loss == pytest.approx(0.33 * 85 * 20 * weight / sum(weights), abs=1e-9)


def test_fan_share_scales_with_room_volume_not_only_leakage():
    house = build_house(9, variation=0)
    shares = fan_shares(house)
    assert sum(shares) == pytest.approx(1)
    # Equal leakage coefficients: the 6.5 m3 Hall gets far less than the 31 m3 Living Room.
    assert shares[3] == pytest.approx(6.528 / sum(r.volume for r in house.rooms))
    assert shares[0] > 4 * shares[3]


def test_deterministic_sensors_independent_of_step_and_dropout():
    house = build_house(12)
    weather = synthetic_weather(hours=2)
    a = simulate_night(house, weather, passive_protocol(), sensor_seed=1)
    b = simulate_night(house, weather, passive_protocol(), sensor_seed=1)
    assert a == b
    all_missing = simulate_night(
        house, weather, passive_protocol(), sensor_seed=1, sensors=SensorSettings(dropout_probability=1)
    )
    assert all(v is None for s in all_missing.observations.room_temperature_series.values() for v in s.values)
    assert a.states == all_missing.states
    assert all(
        s.provenance == "SIMULATED_MEASUREMENT" for s in a.observations.room_temperature_series.values()
    )
    assert all(
        (b - a).total_seconds() == 300
        for a, b in zip(
            a.observations.weather.outdoor_temperature.timestamps[:-1],
            a.observations.weather.outdoor_temperature.timestamps[1:],
            strict=True,
        )
    )


@pytest.mark.parametrize("seed", [-1, 2**63, True, 1.1])
def test_invalid_seeds_rejected(seed):
    with pytest.raises(ValueError):
        build_house(seed)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -1])
def test_invalid_capacity_rejected(value):
    with pytest.raises(ValueError):
        replace(build_house(1).rooms[0], air_capacity=value)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -1, 2])
def test_invalid_repair_effectiveness_rejected(value):
    house = build_house(1)
    with pytest.raises(ValueError):
        repair_house(house, house, "kitchen", FaultType.DRAFT, value)


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), -3, 61])
def test_invalid_wind_rejected_even_if_canonical_model_accepts_it(bad):
    weather = synthetic_weather(hours=1)
    weather.wind_speed.values[0] = bad
    with pytest.raises(ValueError):
        simulate_night(build_house(1), weather, passive_protocol(), sensor_seed=1)


def test_pathological_stiffness_fails_fast():
    house = build_house(1)
    house = replace(house, rooms=tuple(replace(r, air_capacity=1e-5) for r in house.rooms))
    with pytest.raises(ValueError, match="workload"):
        simulate_night(house, synthetic_weather(hours=1), passive_protocol(), sensor_seed=1)


@pytest.mark.parametrize("night", [n["night_id"] for n in list_weather_nights()])
def test_actual_hh09_forcing_physics_without_inventing_coordinates(night):
    raw = load_weather_night(night)
    temperature, wind = resample_forcing(
        Series.model_validate(raw["outdoor_temperature"]), Series.model_validate(raw["wind_speed"])
    )
    healthy = build_house(19)
    states = integrate_trajectory(healthy, temperature, wind, passive_protocol())
    assert len(states) == 145  # 12-hour source forcing, including endpoints
    lower = min(temperature.values)
    upper = max(*healthy.initial_air, *healthy.initial_mass, max(temperature.values))
    assert all(lower <= x <= upper for row in states for x in row)
    assert all(states[-1][i] < healthy.initial_air[i] for i in range(4))


def test_duplicate_edges_and_self_edges_rejected():
    house = build_house(1)
    with pytest.raises(ValueError):
        replace(house, couplings=((0, 1, 3.0), (0, 1, 3.0)))
    with pytest.raises(ValueError):
        replace(house, couplings=((0, 0, 3.0),))


def test_fan_outside_night_and_heating_on_rejected():
    weather = synthetic_weather(hours=1)
    with pytest.raises(ValueError, match="interval"):
        simulate_night(
            build_house(1), weather, fan_protocol(weather.outdoor_temperature.timestamps[0]), sensor_seed=1
        )
    protocol = passive_protocol()
    protocol.heating_off = False
    with pytest.raises(ValueError, match="heating off"):
        simulate_night(build_house(1), weather, protocol, sensor_seed=1)


def test_fault_and_fan_cool_more_than_same_healthy_house():
    house = build_house(5)
    weather = synthetic_weather(hours=3)
    normal = simulate_night(house, weather, passive_protocol(), sensor_seed=1)
    for kind in (FaultType.DRAFT, FaultType.ENVELOPE_CONDUCTION):
        run = simulate_night(
            inject_fault(house, Fault(kind, "bedroom_1", 2)), weather, passive_protocol(), sensor_seed=1
        )
        assert run.states[-1][2] < normal.states[-1][2]
    fan = simulate_night(
        house, weather, fan_protocol(weather.outdoor_temperature.timestamps[0]), sensor_seed=1
    )
    assert all(fan.states[-1][i] < normal.states[-1][i] for i in range(4))
