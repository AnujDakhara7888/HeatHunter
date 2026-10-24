from __future__ import annotations

import math

import numpy as np
import pytest
from scipy.integrate import solve_ivp

from backend.app.contracts import Provenance, PublicTemplate, RoomTemplate
from backend.engine.model import (
    SENSIBLE_AIR_FACTOR,
    Forcing,
    Multipliers,
    PublicModelError,
    PublicNightInputs,
    TemplateArrays,
    leakage_shares,
    simulate_public,
    simulate_trajectory,
)
from backend.engine.tests.helpers import fan, passive, synthetic_weather, two_room_template


def run(template, weather, protocol, initial, multipliers=None):
    return simulate_public(template, PublicNightInputs(weather, protocol, initial), multipliers)


def test_rooms_cool_toward_colder_outdoors_and_never_overshoot():
    result = run(two_room_template(), synthetic_weather(outdoor=0.0), passive(), {"a": 20.0, "b": 19.0})
    for series in result.values():
        values = series.values
        assert all(later < earlier for earlier, later in zip(values, values[1:], strict=False))
        assert min(values) > 0.0


def test_equilibrium_is_stationary_even_with_wind_and_fan():
    weather = synthetic_weather(outdoor=5.0, wind=8.0)
    result = run(two_room_template(), weather, fan(weather), {"a": 5.0, "b": 5.0})
    assert all(math.isclose(v, 5.0, abs_tol=1e-9) for s in result.values() for v in s.values)


def test_single_room_matches_analytic_exponential():
    template = PublicTemplate(
        template_id="single",
        rooms=[
            RoomTemplate(
                room_id="r",
                room_name="R",
                volume_m3=20,
                nominal_capacitance_j_per_k=2e6,
                nominal_envelope_conductance_w_per_k=30,
                nominal_infiltration_conductance_w_per_k=10,
                wind_sensitivity_s_per_m=0.2,
                nominal_leakage_share=1.0,
            )
        ],
        inter_room_couplings=[],
    )
    result = run(template, synthetic_weather(outdoor=-2.0, wind=3.0), passive(), {"r": 20.0})["r"]
    total = 30 + 10 * (1 + 0.2 * 3.0)
    expected = [-2 + 22 * math.exp(-total * 300 * k / 2e6) for k in range(len(result.values))]
    assert np.allclose(result.values, expected, atol=1e-9)


def test_coupled_solution_matches_independent_ode_solver():
    template = two_room_template()
    weather = synthetic_weather(outdoor=lambda h: 3 - 0.5 * h, wind=lambda h: 1 + 0.8 * h)
    protocol = fan(weather, hours=2)
    arrays = TemplateArrays.from_template(template)
    forcing = Forcing.from_weather(weather, protocol)
    multipliers = {"a": Multipliers(conduction=1.5, leakage=2.0)}
    ours = simulate_trajectory(arrays, forcing, np.array([20.0, 18.0]), multipliers)

    m_c, m_l = np.array([1.5, 1.0]), np.array([2.0, 1.0])
    shares = leakage_shares(arrays.leakage_share, m_l)

    def rhs(t, y):
        outdoor = np.interp(t, forcing.seconds, forcing.outdoor)
        wind = np.interp(t, forcing.seconds, forcing.wind)
        flow = forcing.fan_flow_m3_per_h if forcing.fan_start_s <= t < forcing.fan_end_s else 0.0
        exterior = (
            m_c * arrays.conduction
            + m_l * arrays.infiltration * (1 + arrays.wind_sensitivity * wind)
            + SENSIBLE_AIR_FACTOR * flow * shares
        )
        exchange = arrays.coupling @ y - arrays.coupling.sum(axis=1) * y
        return (-exterior * (y - outdoor) + exchange) / arrays.capacitance

    reference = solve_ivp(
        rhs,
        (0, forcing.seconds[-1]),
        [20.0, 18.0],
        t_eval=forcing.seconds,
        rtol=1e-10,
        atol=1e-10,
        max_step=60,
    )
    assert np.max(np.abs(ours - reference.y)) < 2e-3


def test_internal_exchange_conserves_heat_without_exterior_loss():
    template = two_room_template(coupling=50.0)
    rooms = [
        room.model_copy(
            update={
                "nominal_envelope_conductance_w_per_k": 1e-9,
                "nominal_infiltration_conductance_w_per_k": 1e-9,
            }
        )
        for room in template.rooms
    ]
    template = template.model_copy(update={"rooms": rooms})
    result = run(template, synthetic_weather(outdoor=0.0, wind=0.0), passive(), {"a": 25.0, "b": 15.0})
    heat = [3e6 * a + 2e6 * b for a, b in zip(result["a"].values, result["b"].values, strict=True)]
    assert max(heat) - min(heat) < 1e-2 * 3e6
    # The temperature gap decays analytically with rate H (1/Ca + 1/Cb).
    rate = 50.0 * (1 / 3e6 + 1 / 2e6)
    gap = result["a"].values[-1] - result["b"].values[-1]
    assert gap == pytest.approx(10 * math.exp(-rate * 8 * 3600), rel=1e-4)


def test_leakage_share_matches_specification_formula():
    nominal = np.array([0.5, 0.3, 0.2])
    for multiplier in (0.5, 1.0, 2.0, 4.0):
        shares = leakage_shares(nominal, np.array([multiplier, 1.0, 1.0]))
        expected = multiplier * 0.5 / (nominal.sum() + (multiplier - 1) * 0.5)
        assert shares[0] == pytest.approx(expected)
        assert shares.sum() == pytest.approx(1.0)


def test_fan_and_fault_multipliers_increase_cooling():
    template = two_room_template()
    weather = synthetic_weather(outdoor=0.0)
    initial = {"a": 20.0, "b": 20.0}
    base = run(template, weather, passive(), initial)["a"].values[-1]
    with_fan = run(template, weather, fan(weather), initial)["a"].values[-1]
    draft = run(template, weather, fan(weather), initial, {"a": Multipliers(leakage=3)})["a"].values[-1]
    conduction = run(template, weather, passive(), initial, {"a": Multipliers(conduction=2)})["a"].values[-1]
    assert with_fan < base
    assert draft < with_fan
    assert conduction < base


def test_outputs_are_model_estimates_on_weather_timestamps():
    weather = synthetic_weather()
    result = run(two_room_template(), weather, passive(), {"a": 20.0, "b": 20.0})
    for series in result.values():
        assert series.provenance == Provenance.MODEL_ESTIMATE
        assert series.timestamps == weather.outdoor_temperature.timestamps


def test_invalid_inputs_are_rejected():
    template = two_room_template()
    weather = synthetic_weather()
    with pytest.raises(PublicModelError, match="exactly the template rooms"):
        run(template, weather, passive(), {"a": 20.0})
    with pytest.raises(PublicModelError, match="positive"):
        Multipliers(conduction=0)
    with pytest.raises(PublicModelError, match="not in the public template"):
        run(template, weather, passive(), {"a": 20.0, "b": 20.0}, {"zzz": Multipliers()})


def _air_layer(template, value=60.0):
    from backend.engine.model import ModelExtension

    return ModelExtension(template.template_id, {room.room_id: value for room in template.rooms})


def test_air_layer_shows_fast_fan_dip_and_rebound():
    template = two_room_template()
    weather = synthetic_weather(outdoor=0.0, wind=1.0)
    initial = {"a": 20.0, "b": 20.0}
    layer = _air_layer(template)
    with_fan = simulate_public(template, PublicNightInputs(weather, fan(weather), initial), extension=layer)[
        "a"
    ]
    without = simulate_public(template, PublicNightInputs(weather, passive(), initial), extension=layer)["a"]
    gap = [f - p for f, p in zip(with_fan.values, without.values, strict=True)]
    # Readings every 5 minutes; fan runs 0-2 h. First reading is pre-fan (air lags the switch).
    assert gap[0] == pytest.approx(0.0, abs=1e-9)
    assert gap[1] < -0.5  # immediate air dip five minutes after switch-on
    assert gap[25] - gap[24] > 0.3  # rebound right after switch-off at 2 h
    assert gap[-1] < 0  # lasting fabric cooling remains


def test_air_layer_converges_to_single_node_model():
    template = two_room_template()
    weather = synthetic_weather(outdoor=lambda h: 2 - 0.3 * h, wind=3.0)
    initial = {"a": 20.0, "b": 19.0}
    single = run(template, weather, fan(weather), initial)
    stiff = simulate_public(
        template, PublicNightInputs(weather, fan(weather), initial), extension=_air_layer(template, 1e9)
    )
    for room in ("a", "b"):
        assert np.allclose(single[room].values, stiff[room].values, atol=1e-5)


def test_air_layer_must_match_template():
    from backend.engine.model import ModelExtension

    template = two_room_template()
    with pytest.raises(PublicModelError, match="different public template"):
        TemplateArrays.from_template(template, ModelExtension("other-template", {"a": 50.0, "b": 50.0}))
    with pytest.raises(PublicModelError, match="exactly the template rooms"):
        TemplateArrays.from_template(template, ModelExtension(template.template_id, {"a": 50.0}))
