"""Diagnosis sees public models/observations only; no simulator dependency.

Kailash supplies the fitter and forward predictor through PublicEngine. Test
doubles exercise orchestration, never substantiate scientific accuracy claims.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Protocol as TypingProtocol
from uuid import uuid4

from backend.app.contracts import (
    Assumption,
    Diagnosis,
    DiagnosisStatus,
    Evidence,
    HypothesisFit,
    HypothesisType,
    NightObservations,
    Protocol,
    Provenance,
    PublicTemplate,
    Series,
    Split,
    TestDecision,
    WeatherNight,
)

SAFETY_WARNING = (
    "Depressurization can backdraft some natural-draft combustion appliances. "
    "This demonstration is simulated; real-world testing requires appropriate safety assessment."
)


class EngineDependencyError(RuntimeError):
    """A real public fitter/template/calibration is required; never fake a result."""


class PublicEngine(TypingProtocol):
    def fit_hypothesis(
        self, nights: list[NightObservations], room_id: str, template: PublicTemplate, cause: HypothesisType
    ) -> HypothesisFit: ...

    def predict_experiment(
        self,
        template: PublicTemplate,
        room_id: str,
        hypothesis_fits: tuple[HypothesisFit, HypothesisFit],
        weather_night: WeatherNight,
        protocol: Protocol,
        initial_temperatures: dict[str, float],
    ) -> tuple[Series, Series]:
        """Coupled forward prediction; no future indoor observations are provided."""
        ...


@dataclass(frozen=True)
class Thresholds:
    detection_bic: float
    ambiguity_bic: float
    adequacy_rmse: float
    separation: float = 2.0
    measurement_noise: float = 0.15
    calibration_note: str = "User-supplied thresholds; not independently validated"
    confidence_enabled: bool = True

    def __post_init__(self) -> None:
        for name in ("detection_bic", "ambiguity_bic", "adequacy_rmse", "separation", "measurement_noise"):
            value = getattr(self, name)
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or value < 0
            ):
                raise ValueError(f"{name} must be finite and nonnegative")
        if self.measurement_noise == 0 or self.adequacy_rmse == 0:
            raise ValueError("noise and adequacy threshold must be positive")
        if not isinstance(self.confidence_enabled, bool):
            raise ValueError("confidence_enabled must be boolean")


@dataclass(frozen=True)
class DecisionProfiles:
    passive: Thresholds
    post_fan: Thresholds

    def for_nights(self, nights: list[NightObservations]) -> Thresholds:
        passive_count = sum(n.kind == "passive" for n in nights)
        fan_count = sum(n.kind == "fan_test" for n in nights)
        if passive_count != 1 or fan_count not in (0, 1):
            raise ValueError("Calibrated profiles require one passive night and at most one fan night")
        return self.post_fan if fan_count else self.passive


def validate_fit(fit: HypothesisFit, cause: HypothesisType) -> HypothesisFit:
    fit = HypothesisFit.model_validate(fit.model_dump())
    if fit.fault_type != cause or not all(
        math.isfinite(v)
        for v in (
            fit.sse,
            fit.bic,
            fit.residual_rmse_deg_c,
            fit.fitted_multiplier,
        )
    ):
        raise ValueError("engine returned a mismatched or non-finite fit")
    if cause != HypothesisType.NORMAL and not 0.3 <= fit.fitted_multiplier <= 6:
        raise ValueError("engine multiplier is outside agreed fitting bounds")
    if cause == HypothesisType.NORMAL and fit.fitted_multiplier != 1:
        raise ValueError("normal hypothesis must have multiplier one")
    return fit


def separation_score(predictions: tuple[Series, Series], expected_timestamps: list, noise: float) -> float:
    if len(predictions) != 2:
        raise ValueError("two competing predictions are required")
    a, b = predictions
    if a.timestamps != expected_timestamps or b.timestamps != expected_timestamps:
        raise ValueError("predictions must align with the proposed experiment weather")
    if a.unit != "degC" or b.unit != "degC":
        raise ValueError("predictions must be temperatures in degC")
    if a.provenance != Provenance.MODEL_ESTIMATE or b.provenance != Provenance.MODEL_ESTIMATE:
        raise ValueError("experiment predictions must be MODEL_ESTIMATE")
    pairs = list(zip(a.values, b.values, strict=True))
    if not pairs or any(
        x is None or y is None or not math.isfinite(x) or not math.isfinite(y) for x, y in pairs
    ):
        raise ValueError("experiment predictions must be complete and finite")
    return math.sqrt(sum((x - y) ** 2 for x, y in pairs) / len(pairs)) / noise


class DiagnosisController:
    def __init__(
        self, engine: PublicEngine, template: PublicTemplate, thresholds: Thresholds | DecisionProfiles
    ):
        self.engine = engine
        self.template = PublicTemplate.model_validate(template.model_dump()).model_copy(deep=True)
        self.thresholds = thresholds
        ids = {r.room_id for r in self.template.rooms}
        for room in self.template.rooms:
            if any(
                isinstance(value, (int, float)) and not math.isfinite(value)
                for value in room.model_dump().values()
            ):
                raise ValueError("public template contains non-finite parameters")
        edges = set()
        for edge in self.template.inter_room_couplings:
            key = tuple(sorted((edge.room_a_id, edge.room_b_id)))
            if (
                edge.room_a_id not in ids
                or edge.room_b_id not in ids
                or edge.room_a_id == edge.room_b_id
                or key in edges
                or not math.isfinite(edge.conductance_w_per_k)
            ):
                raise ValueError("public template has invalid or duplicate coupling")
            edges.add(key)

    def analyze(
        self,
        nights: list[NightObservations],
        *,
        next_weather: WeatherNight | None = None,
        next_protocol: Protocol | None = None,
    ) -> Diagnosis:
        nights = [NightObservations.model_validate(n.model_dump()) for n in nights]
        thresholds = (
            self.thresholds.for_nights(nights)
            if isinstance(self.thresholds, DecisionProfiles)
            else self.thresholds
        )
        ids = {r.room_id for r in self.template.rooms}
        if not nights or len({n.night_id for n in nights}) != len(nights):
            raise ValueError("provide nonempty, unique observation nights")
        if any(set(n.room_temperature_series) != ids for n in nights):
            raise ValueError("observed rooms must match the public template")
        if any(
            s.provenance != Provenance.SIMULATED_MEASUREMENT
            for n in nights
            for s in n.room_temperature_series.values()
        ):
            raise ValueError("Fault Lab diagnosis accepts synthetic observations only")
        assumptions = [
            Assumption(name="diagnostic_threshold_calibration", value=thresholds.calibration_note),
            Assumption(
                name="decision_phase",
                value="post_fan" if any(n.kind == "fan_test" for n in nights) else "passive",
            ),
        ]
        uncertainty = [
            "Screening on an approximate HH09-inspired twin; not real-home fault validation.",
            "Thermal mass, sensor offsets and model mismatch can affect ranking.",
            "BIC and noise-normalized separation are heuristics, not probabilities.",
            "Conservative decisions can miss faults; no_fault is not proof of a healthy house.",
        ]
        base = dict(
            diagnosis_id=str(uuid4()),
            evidence=[],
            uncertainty=uncertainty,
            test_decision=None,
            money_estimate=None,
            assumptions=assumptions,
        )
        if any(
            v is not None and not math.isfinite(v)
            for n in nights
            for s in n.room_temperature_series.values()
            for v in s.values
        ):
            raise ValueError("non-finite indoor observations")
        # Sparse inputs cannot establish either health or a fault.
        if any(
            sum(
                v is not None and math.isfinite(v)
                for n in nights
                for v in n.room_temperature_series[r].values
            )
            < 8
            for r in ids
        ):
            return Diagnosis(
                status=DiagnosisStatus.UNEXPLAINED,
                flagged_room_id=None,
                ranked_causes=[],
                **{**base, "uncertainty": uncertainty + ["Insufficient readings."]},
            )
        room_fits = {}
        for room_id in sorted(ids):
            fits = {}
            for cause in HypothesisType:
                result = self.engine.fit_hypothesis(
                    [n.model_copy(deep=True) for n in nights],
                    room_id,
                    self.template.model_copy(deep=True),
                    cause,
                )
                fits[cause] = validate_fit(result, cause)
            room_fits[room_id] = fits
        ranked = {
            room: sorted(
                (fits[HypothesisType.DRAFT], fits[HypothesisType.ENVELOPE_CONDUCTION]),
                key=lambda fit: (fit.bic, fit.fault_type.value),
            )
            for room, fits in room_fits.items()
        }
        scores = {r: fits[HypothesisType.NORMAL].bic - ranked[r][0].bic for r, fits in room_fits.items()}
        flagged = max(sorted(ids), key=lambda r: scores[r])
        # Check adequacy before declaring health; a bad normal model isn't no_fault.
        inadequate = [
            r
            for r in ids
            if min(f.residual_rmse_deg_c for f in room_fits[r].values()) > thresholds.adequacy_rmse
        ]
        if inadequate:
            return Diagnosis(
                status=DiagnosisStatus.UNEXPLAINED,
                flagged_room_id=None,
                ranked_causes=[],
                **{
                    **base,
                    "uncertainty": uncertainty
                    + ["No available model adequately explains rooms: " + ", ".join(sorted(inadequate))],
                },
            )
        if scores[flagged] <= thresholds.detection_bic:
            # A larger post-test threshold is not evidence that an earlier
            # anomaly disappeared. Recheck passive observations, never hidden
            # truth or a previously cached answer. Repaired passive readings
            # are re-evaluated independently and may legitimately be normal.
            passive = [n for n in nights if n.kind == "passive"]
            if isinstance(self.thresholds, DecisionProfiles) and passive and len(passive) < len(nights):
                earlier = self.analyze(passive)
                if earlier.status in {DiagnosisStatus.AMBIGUOUS, DiagnosisStatus.CONFIDENT}:
                    return Diagnosis(
                        status=DiagnosisStatus.UNEXPLAINED,
                        flagged_room_id=earlier.flagged_room_id,
                        ranked_causes=ranked[earlier.flagged_room_id],
                        **{
                            **base,
                            "uncertainty": uncertainty
                            + [
                                "Passive anomaly remains unresolved; combined evidence does not clear "
                                "the conservative post-fan threshold. This does not verify a repair."
                            ],
                        },
                    )
            return Diagnosis(status=DiagnosisStatus.NO_FAULT, flagged_room_id=None, ranked_causes=[], **base)
        causes = ranked[flagged]
        if causes[0].residual_rmse_deg_c > thresholds.adequacy_rmse:
            return Diagnosis(
                status=DiagnosisStatus.UNEXPLAINED, flagged_room_id=flagged, ranked_causes=causes, **base
            )
        # Cooler-than-expected/low-loss fits must not produce a positive-loss repair.
        if causes[0].fitted_multiplier <= 1:
            return Diagnosis(
                status=DiagnosisStatus.UNEXPLAINED,
                flagged_room_id=flagged,
                ranked_causes=causes,
                **{**base, "uncertainty": uncertainty + ["Best fit does not indicate excess heat loss."]},
            )
        ambiguous = (
            not thresholds.confidence_enabled or causes[1].bic - causes[0].bic < thresholds.ambiguity_bic
        )
        status = DiagnosisStatus.AMBIGUOUS if ambiguous else DiagnosisStatus.CONFIDENT
        decision = TestDecision(
            recommended=False, explanation="No additional test is indicated by this ranking."
        )
        if ambiguous:
            decision = TestDecision(
                recommended=False, explanation="No unused experiment weather/protocol supplied."
            )
            if next_weather is not None and next_protocol is not None:
                if next_weather.train_or_heldout_split != nights[0].weather.train_or_heldout_split:
                    raise ValueError("experiment and passive weather must use the same split")
                initial = {r: nights[0].room_temperature_series[r].values[0] for r in ids}
                if any(v is None for v in initial.values()):
                    base["test_decision"] = TestDecision(
                        recommended=False,
                        explanation="Initial readings are missing; test prediction cannot be initialized.",
                    )
                    return Diagnosis(status=status, flagged_room_id=flagged, ranked_causes=causes, **base)
                predictions = self.engine.predict_experiment(
                    self.template.model_copy(deep=True),
                    flagged,
                    tuple(f.model_copy(deep=True) for f in causes),
                    next_weather.model_copy(deep=True),
                    next_protocol.model_copy(deep=True),
                    initial,
                )
                score = separation_score(
                    predictions,
                    next_weather.outdoor_temperature.timestamps,
                    thresholds.measurement_noise,
                )
                recommend = score >= thresholds.separation
                decision = TestDecision(
                    recommended=recommend,
                    experiment_type="exhaust_fan_depressurization",
                    separation_score=score,
                    safety_warning=SAFETY_WARNING,
                    explanation=(
                        "Predicted responses differ enough to justify this simulated test."
                        if recommend
                        else "Predicted responses are too similar; seek additional evidence."
                    ),
                )
        base["test_decision"] = decision
        base["evidence"] = [
            Evidence(
                statement=f"Best fault improves BIC over normal by {scores[flagged]:.2f}; "
                f"leading cause gap is {causes[1].bic - causes[0].bic:.2f}.",
                relationship="supports",
                provenance=Provenance.MODEL_ESTIMATE,
            )
        ]
        return Diagnosis(status=status, flagged_room_id=flagged, ranked_causes=causes, **base)


def calibrate_healthy_thresholds(
    engine: PublicEngine,
    template: PublicTemplate,
    training_cases: list[list[NightObservations]],
    *,
    ambiguity_bic: float,
    separation: float = 2,
) -> Thresholds:
    """Conservative healthy fit quantiles, not a claim of diagnostic accuracy.

    Caller must provide known-healthy TRAINING cases. Diagnosis never inspects
    labels to verify this. Ambiguity remains supplied/tuned on faulty training.
    """
    if len(training_cases) < 20:
        raise ValueError("at least twenty healthy training cases are required")
    scores, errors = [], []
    for nights in training_cases:
        if not nights or any(n.weather.train_or_heldout_split != Split.TRAINING for n in nights):
            raise ValueError("threshold calibration accepts training nights only")
        case_scores, case_errors = [], []
        for room in template.rooms:
            fits = {
                cause: validate_fit(engine.fit_hypothesis(nights, room.room_id, template, cause), cause)
                for cause in HypothesisType
            }
            case_scores.append(
                fits[HypothesisType.NORMAL].bic
                - min(fits[c].bic for c in (HypothesisType.DRAFT, HypothesisType.ENVELOPE_CONDUCTION))
            )
            case_errors.append(min(f.residual_rmse_deg_c for f in fits.values()))
        scores.append(max(case_scores))
        errors.append(max(case_errors))

    def quantile(values: list[float]) -> float:
        return sorted(values)[math.ceil(0.95 * len(values)) - 1]

    return Thresholds(
        max(0, quantile(scores)),
        ambiguity_bic,
        max(1e-6, quantile(errors)),
        separation,
        calibration_note="95th-percentile healthy TRAINING house maxima; "
        "ambiguity/separation require independent training verification",
    )
