from __future__ import annotations

import pytest

from backend.app.contracts import (
    Diagnosis,
    DiagnosisStatus,
    HypothesisFit,
    HypothesisType,
    Provenance,
)
from backend.engine import (
    MoneyOverrides,
    PublicMoneyEstimator,
    estimate_money,
    load_model_extension,
    load_public_template,
)
from backend.engine.assumptions import load_assumptions
from backend.engine.model import Multipliers
from backend.engine.money import excess_conductance, remeasured_savings_kwh
from backend.engine.tests.helpers import observe, passive, synthetic_weather


def fit(cause: HypothesisType, multiplier: float) -> HypothesisFit:
    return HypothesisFit(
        fault_type=cause, fitted_multiplier=multiplier, sse=1.0, bic=0.0, residual_rmse_deg_c=0.1
    )


def test_conduction_estimate_matches_hand_calculation():
    template = load_public_template()
    economic = load_assumptions()["economic"]
    estimate = estimate_money(template, "bedroom_1", fit(HypothesisType.ENVELOPE_CONDUCTION, 2.0))
    h_cond = next(r.nominal_envelope_conductance_w_per_k for r in template.rooms if r.room_id == "bedroom_1")
    gas = (
        h_cond
        * economic["heating_degree_days"]["value"]
        * 24
        / 1000
        / economic["heating_efficiency"]["value"]
    )
    cost = gas * economic["gas_unit_price"]["value"] / 100 * economic["gbp_to_usd"]["value"]
    assert estimate.excess_conductance_w_per_k == pytest.approx(h_cond)
    assert estimate.annual_energy_estimate_kwh == pytest.approx(gas)
    assert estimate.annual_cost_estimate_usd == pytest.approx(cost)
    assert estimate.simple_payback_years == pytest.approx(estimate.repair_cost_usd / cost)
    assert estimate.provenance == Provenance.MODEL_ESTIMATE


def test_draft_excess_uses_stack_wind_law_and_the_air_layer_in_series():
    template = load_public_template()
    extension = load_model_extension()
    air = extension.air_fabric_conductance_w_per_k["living_room"]
    law = extension.leakage_law
    room = next(r for r in template.rooms if r.room_id == "living_room")
    mean_wind = load_assumptions()["economic"]["heating_season_mean_wind_speed"]["value"]
    factor = (
        (law.reference_delta_t_k + law.stack_wind_ratio * mean_wind**2) / law.reference_delta_t_k
    ) ** 0.5
    nominal = room.nominal_infiltration_conductance_w_per_k * factor

    def series(h):
        return air * h / (air + h)

    expected = series(3 * nominal) - series(nominal)
    estimate = estimate_money(template, "living_room", fit(HypothesisType.DRAFT, 3.0))
    assert estimate.excess_conductance_w_per_k == pytest.approx(expected)
    # Without the extension it reduces to the specification's linear (m - 1) x path conductance.
    plain = excess_conductance(template, "living_room", HypothesisType.DRAFT, 3.0, extension=None)
    assert plain == pytest.approx(
        2 * room.nominal_infiltration_conductance_w_per_k * (1 + room.wind_sensitivity_s_per_m * mean_wind)
    )
    assert estimate.excess_conductance_w_per_k < plain
    names = {a.name for a in estimate.assumptions}
    assert {"heating_season_mean_wind_speed", "repair_cost_seal_leaks", "gas_unit_price"} <= names


def test_unsupported_cases_return_none():
    template = load_public_template()
    assert estimate_money(template, "kitchen", fit(HypothesisType.NORMAL, 1.0)) is None
    assert estimate_money(template, "kitchen", fit(HypothesisType.DRAFT, 0.8)) is None
    assert estimate_money(template, "kitchen", fit(HypothesisType.DRAFT, 1.0)) is None


def test_overrides_and_unverified_repair_costs_are_labelled():
    template = load_public_template()
    base = estimate_money(template, "kitchen", fit(HypothesisType.DRAFT, 2.0))
    adjusted = estimate_money(
        template,
        "kitchen",
        fit(HypothesisType.DRAFT, 2.0),
        overrides=MoneyOverrides(gas_price_pence_per_kwh=15.94, repair_cost_gbp=100.0),
    )
    assert adjusted.annual_cost_estimate_usd == pytest.approx(2 * base.annual_cost_estimate_usd)
    assert adjusted.repair_cost_usd == pytest.approx(
        100.0 * load_assumptions()["economic"]["gbp_to_usd"]["value"]
    )
    repair = next(a for a in base.assumptions if a.name == "repair_cost_seal_leaks")
    assert repair.source.notes.startswith("UNVERIFIED")
    sourced = next(a for a in base.assumptions if a.name == "gas_unit_price")
    assert "ofgem" in str(sourced.source.url)


def test_estimator_protocol_only_prices_confident_diagnoses():
    estimator = PublicMoneyEstimator(load_public_template())
    causes = [fit(HypothesisType.ENVELOPE_CONDUCTION, 2.0), fit(HypothesisType.DRAFT, 1.5)]
    confident = Diagnosis(
        diagnosis_id="d",
        status=DiagnosisStatus.CONFIDENT,
        flagged_room_id="kitchen",
        ranked_causes=causes,
        evidence=[],
        uncertainty=[],
        test_decision=None,
        money_estimate=None,
        assumptions=[],
    )
    ambiguous = confident.model_copy(update={"status": DiagnosisStatus.AMBIGUOUS})
    assert estimator.estimate(confident) is not None
    assert estimator.estimate(ambiguous) is None


def test_remeasured_savings_come_from_refitting_public_observations():
    template = load_public_template()
    weather = synthetic_weather("night", outdoor=2.0, wind=2.0)
    initial = {room.room_id: 20.0 for room in template.rooms}
    faulty = {"kitchen": Multipliers(conduction=2.5)}
    repaired = {"kitchen": Multipliers(conduction=1.0)}
    before = [observe(template, weather, passive(), initial, multipliers=faulty, noise=0.05, seed=3)]
    after = [observe(template, weather, passive(), initial, multipliers=repaired, noise=0.05, seed=3)]
    saved = remeasured_savings_kwh(before, after, "kitchen", template, HypothesisType.ENVELOPE_CONDUCTION)
    full = estimate_money(template, "kitchen", fit(HypothesisType.ENVELOPE_CONDUCTION, 2.5))
    assert saved == pytest.approx(full.annual_energy_estimate_kwh, rel=0.15)
    # A repair of the wrong path yields no fitted saving.
    wrong = remeasured_savings_kwh(before, before, "kitchen", template, HypothesisType.ENVELOPE_CONDUCTION)
    assert wrong == pytest.approx(0.0, abs=1e-6)
