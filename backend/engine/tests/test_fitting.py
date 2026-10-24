from __future__ import annotations

import math

import pytest

from backend.app.contracts import HypothesisType
from backend.diagnosis.controller import validate_fit
from backend.engine.fitting import FitSettings, bic, fit_hypothesis, fit_hypothesis_detailed
from backend.engine.model import Multipliers, PublicModelError
from backend.engine.tests.helpers import fan, observe, passive, synthetic_weather, two_room_template

INITIAL = {"a": 20.0, "b": 19.5}


def nights(multipliers=None, *, noise=0.05, offsets=None, seed=1, drop=None):
    """One calm passive night plus one windy fan-test night, in public-model physics."""

    template = two_room_template()
    calm = synthetic_weather("calm", outdoor=lambda h: 2 - 0.3 * h, wind=1.0)
    windy = synthetic_weather("windy", outdoor=lambda h: 4 - 0.2 * h, wind=lambda h: 5 + 0.3 * h)
    return [
        observe(
            template,
            calm,
            passive(),
            INITIAL,
            multipliers=multipliers,
            noise=noise,
            offsets=offsets,
            seed=seed,
            drop=drop,
        ),
        observe(
            template,
            windy,
            fan(windy),
            INITIAL,
            multipliers=multipliers,
            noise=noise,
            offsets=offsets,
            seed=seed + 1,
            drop=drop,
        ),
    ]


@pytest.mark.parametrize(
    ("cause", "multiplier"),
    [
        (HypothesisType.DRAFT, Multipliers(leakage=3.0)),
        (HypothesisType.ENVELOPE_CONDUCTION, Multipliers(conduction=1.8)),
    ],
)
def test_recovers_known_multiplier_and_ranks_true_cause_first(cause, multiplier):
    data = nights({"a": multiplier})
    template = two_room_template()
    fits = {c: fit_hypothesis(data, "a", template, c) for c in HypothesisType}
    expected = multiplier.leakage if cause == HypothesisType.DRAFT else multiplier.conduction
    assert fits[cause].fitted_multiplier == pytest.approx(expected, rel=0.05)
    assert min(fits, key=lambda c: fits[c].bic) == cause
    assert fits[HypothesisType.NORMAL].bic - fits[cause].bic > 10


def test_healthy_room_is_not_preferred_as_a_fault():
    data = nights()
    template = two_room_template()
    fits = {c: fit_hypothesis(data, "b", template, c) for c in HypothesisType}
    best_fault = min(fits[HypothesisType.DRAFT].bic, fits[HypothesisType.ENVELOPE_CONDUCTION].bic)
    # One extra parameter must not buy a large BIC gain on healthy data.
    assert fits[HypothesisType.NORMAL].bic - best_fault < 6
    for cause in (HypothesisType.DRAFT, HypothesisType.ENVELOPE_CONDUCTION):
        assert fits[cause].fitted_multiplier == pytest.approx(1.0, abs=0.1)


def test_normal_hypothesis_has_exact_unit_multiplier_and_comparable_bic():
    data = nights()
    detail = fit_hypothesis_detailed(data, "a", two_room_template(), HypothesisType.NORMAL)
    draft = fit_hypothesis_detailed(data, "a", two_room_template(), HypothesisType.DRAFT)
    assert detail.fit.fitted_multiplier == 1.0
    assert draft.n_parameters == detail.n_parameters + 1  # nights' T0s + offset (+ multiplier)
    assert detail.n_parameters == len(data) + 1
    assert detail.fit.bic == pytest.approx(bic(detail.fit.sse, detail.n_observations, detail.n_parameters))
    assert detail.fit.residual_rmse_deg_c == pytest.approx(math.sqrt(detail.fit.sse / detail.n_observations))


def test_sensor_offset_is_estimated_not_mistaken_for_a_fault():
    data = nights(offsets={"a": 0.3}, noise=0.02)
    detail = fit_hypothesis_detailed(data, "a", two_room_template(), HypothesisType.NORMAL)
    assert detail.sensor_offset_deg_c == pytest.approx(0.3, abs=0.08)


def test_missing_readings_are_skipped_with_warning():
    data = nights({"a": Multipliers(leakage=2.5)}, drop={"a": {20, 21, 22, 50}})
    detail = fit_hypothesis_detailed(data, "a", two_room_template(), HypothesisType.DRAFT)
    assert detail.fit.fitted_multiplier == pytest.approx(2.5, rel=0.08)
    assert any("missing readings" in w for w in detail.warnings)


def test_neighbour_with_no_readings_is_handled_with_warning():
    data = nights(drop={"b": set(range(200))})
    detail = fit_hypothesis_detailed(data, "a", two_room_template(), HypothesisType.NORMAL)
    assert any("neighbour b has no readings" in w for w in detail.warnings)


def test_transient_skip_excludes_early_readings():
    data = nights()
    short = FitSettings(transient_skip_seconds=0, switch_skip_seconds=0)
    long = FitSettings(transient_skip_seconds=3600, switch_skip_seconds=0)
    n_short = fit_hypothesis_detailed(
        data, "a", two_room_template(), HypothesisType.NORMAL, short
    ).n_observations
    n_long = fit_hypothesis_detailed(
        data, "a", two_room_template(), HypothesisType.NORMAL, long
    ).n_observations
    assert n_short - n_long == 2 * 12  # twelve five-minute readings per night
    settled = FitSettings(transient_skip_seconds=0, switch_skip_seconds=600)
    n_settled = fit_hypothesis_detailed(
        data, "a", two_room_template(), HypothesisType.NORMAL, settled
    ).n_observations
    assert n_short - n_settled == 4  # two readings after each fan switch (on at 0 h, off at 2 h)


def test_output_passes_the_diagnosis_controller_validator():
    data = nights({"a": Multipliers(leakage=3.0)})
    for cause in HypothesisType:
        validate_fit(fit_hypothesis(data, "a", two_room_template(), cause), cause)


def test_multiplier_bound_hit_is_reported():
    data = nights({"a": Multipliers(conduction=9.0)}, noise=0.0)
    detail = fit_hypothesis_detailed(data, "a", two_room_template(), HypothesisType.ENVELOPE_CONDUCTION)
    assert detail.fit.fitted_multiplier == pytest.approx(6.0)
    assert any("bound" in w for w in detail.warnings)


def test_rejects_insufficient_or_mismatched_input():
    data = nights()
    with pytest.raises(PublicModelError):
        fit_hypothesis([], "a", two_room_template(), HypothesisType.NORMAL)
    with pytest.raises(PublicModelError, match="not in the public template"):
        fit_hypothesis(data, "zzz", two_room_template(), HypothesisType.NORMAL)
    sparse = nights(drop={"a": set(range(4, 200))})
    with pytest.raises(PublicModelError, match="readings"):
        fit_hypothesis(sparse, "a", two_room_template(), HypothesisType.DRAFT)
