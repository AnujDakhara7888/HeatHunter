"""Canonical async scenario-service adapter, without changing API routes.

Nikhil instantiates this once and delegates the existing routes. Kailash's real
engine/controller must be injected for diagnosis. Physics works independently.
"""

from __future__ import annotations

import asyncio
import math
import random
import secrets
import threading
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import wraps
from typing import Any, ParamSpec, Protocol, TypeVar
from uuid import uuid4

from backend.app.contracts import (
    DiagnoseRequest,
    Diagnosis,
    DiagnosisStatus,
    ExperimentRequest,
    ExperimentResponse,
    FaultType,
    GroundTruth,
    MoneyEstimate,
    NightObservations,
    ObservationResponse,
    RepairRequest,
    RepairResult,
    ScenarioCreated,
    ScenarioCreateRequest,
    ScenarioMode,
    Split,
    WeatherNight,
)
from backend.data_pipeline import list_weather_nights, load_hh09_twin_inputs
from backend.diagnosis import DiagnosisController, EngineDependencyError

from .observations import (
    SensorSettings,
    fan_protocol,
    nighttime_weather,
    passive_protocol,
    resample_weather,
    simulate_night,
    sub_seed,
)
from .physics import Fault, build_house, checked_seed, finite, inject_fault, repair_house
from .truth_store import PrivateScenario, TruthStore
from .weather_bridge import load_simulation_weather

GUIDED_SCENARIO_ID = "hh09-guided-v1"
P = ParamSpec("P")
T = TypeVar("T")


def _offload(function: Callable[P, T]) -> Callable[P, Coroutine[Any, Any, T]]:
    """Keep CPU work and contended locks outside the ASGI event loop.

    Once dispatched, cancellation of the waiter does not cancel the atomic
    operation; retry experiment/repair with the same diagnosis ID.
    """

    @wraps(function)
    async def call(*args: P.args, **kwargs: P.kwargs) -> T:
        return await asyncio.to_thread(function, *args, **kwargs)

    return call


class ScenarioStateError(ValueError):
    """Invalid/stale action; API owner should map this to an appropriate 4xx."""


class FinancialEstimator(Protocol):
    def estimate(self, diagnosis: Diagnosis) -> MoneyEstimate | None: ...

    def remeasure(
        self, original: list[NightObservations], repaired: list[NightObservations], diagnosis: Diagnosis
    ) -> float | None:
        """Annual kWh from fitted public observations, never private physics."""
        ...


@dataclass
class _PublicScenario:
    mode: ScenarioMode
    nights: list[NightObservations]
    latest_diagnosis: Diagnosis | None = None
    diagnosis_nights: tuple[str, ...] = ()
    experiment_result: ExperimentResponse | None = None
    experiment_diagnosis_id: str | None = None
    repair_result: RepairResult | None = None
    repair_diagnosis_id: str | None = None
    repaired_prediction: tuple[FaultType, str] | None = None
    # Separate repaired observations: never fit before/after as the same fault.
    repaired_diagnosis: Diagnosis | None = None
    recorded_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class HH09ScenarioService:
    def __init__(
        self,
        controller: DiagnosisController | None = None,
        *,
        financial_estimator: FinancialEstimator | None = None,
        split: Split = Split.TRAINING,
        sensors: SensorSettings | None = None,
        max_scenarios: int = 128,
    ):
        if not isinstance(split, Split):
            raise ValueError("split must be a canonical Split")
        if isinstance(max_scenarios, bool) or not isinstance(max_scenarios, int) or max_scenarios < 1:
            raise ValueError("max_scenarios must be a positive integer")
        self._controller = controller
        if controller is not None:
            expected = {r["simulator_room_id"]: r for r in load_hh09_twin_inputs()["rooms"]}
            supplied = {r.room_id: r for r in controller.template.rooms}
            if set(expected) != set(supplied) or any(
                supplied[key].room_name != entry["display_name"]
                or abs(supplied[key].volume_m3 - entry["geometry"]["volume"]["value"]) > 1e-6
                for key, entry in expected.items()
            ):
                raise EngineDependencyError("public template must use HH09 room mapping, names and volumes")
        self._financial = financial_estimator
        self._split = split
        self._sensors = sensors or SensorSettings()
        self._limit = max_scenarios
        self._public: dict[str, _PublicScenario] = {}
        self.__truth = TruthStore()
        self._lock = threading.RLock()

    def _get(self, scenario_id: str) -> _PublicScenario:
        try:
            return self._public[scenario_id]
        except KeyError:
            raise KeyError("unknown scenario") from None

    def _weather(self, night_id: str) -> WeatherNight:
        if not night_id.startswith("smeter-hh09-"):
            raise ValueError("new scenarios require HH09-region weather")
        weather = load_simulation_weather(night_id)
        if weather.train_or_heldout_split != self._split:
            raise ValueError("weather split does not match scenario service split")
        return nighttime_weather(weather)

    @_offload
    def create_scenario(
        self,
        request: ScenarioCreateRequest,
        *,
        weather_night_id: str | None = None,
        experiment_night_id: str | None = None,
    ) -> ScenarioCreated:
        """Optional weather overrides are internal benchmark inputs, not API changes."""
        request = ScenarioCreateRequest.model_validate(request.model_dump())
        seed = (
            request.seed
            if request.seed is not None
            else (20261024 if request.mode == ScenarioMode.GUIDED else secrets.randbelow(2**63))
        )
        checked_seed(seed)
        with self._lock:
            if len(self._public) >= self._limit:
                raise ScenarioStateError("scenario capacity reached; discard old scenarios explicitly")
            catalog = list_weather_nights(self._split.value)
            if len(catalog) < 2:
                raise ScenarioStateError("at least two weather nights are required per split")
            rng = random.Random(sub_seed(seed, "scenario-selection"))
            calm = [n for n in catalog if n.get("selection_metadata", {}).get("weather_regime") == "calm"]
            # Catalog entries may expose regime at top level (reader-owned shape).
            if not calm:
                calm = [n for n in catalog if n.get("weather_regime") == "calm"]
            passive_id = weather_night_id or rng.choice(calm or catalog)["night_id"]
            candidates = [n["night_id"] for n in catalog if n["night_id"] != passive_id]
            test_id = experiment_night_id or rng.choice(candidates)
            if passive_id == test_id:
                raise ValueError("experiment must use a different weather night")
            weather, _ = self._weather(passive_id), self._weather(test_id)
            healthy = build_house(sub_seed(seed, "house") % 2**63)
            ids = [r.room_id for r in healthy.rooms]
            if request.mode == ScenarioMode.GUIDED:
                if request.guided_scenario_id not in {GUIDED_SCENARIO_ID, "synthetic-guided-draft-01"}:
                    raise ValueError(f"unknown guided scenario; supported ID is {GUIDED_SCENARIO_ID}")
                fault = Fault(FaultType.DRAFT, "bedroom_1", 2.0)
            elif request.mode == ScenarioMode.JUDGE:
                if request.judge_room_id not in ids:
                    raise ValueError("unknown judge room ID")
                fault = (
                    Fault(FaultType.NONE)
                    if request.judge_fault_type == FaultType.NONE
                    else Fault(request.judge_fault_type, request.judge_room_id, request.severity)
                )
            else:
                fault_type = rng.choice(list(FaultType))
                fault = (
                    Fault(FaultType.NONE)
                    if fault_type == FaultType.NONE
                    else Fault(fault_type, rng.choice(ids), rng.choice((0.6, 1.2, 2.0, 3.0)))
                )
            faulty = inject_fault(healthy, fault)
            sensor_seed = sub_seed(seed, "sensors") % 2**63
            observations = simulate_night(
                faulty, weather, passive_protocol(), sensor_seed=sensor_seed, sensors=self._sensors
            ).observations
            scenario_id = str(uuid4())  # opaque; never encodes seed, room, fault or severity
            public = _PublicScenario(request.mode, [observations])
            self.__truth.put(scenario_id, PrivateScenario(healthy, faulty, fault, sensor_seed, test_id))
            self._public[scenario_id] = public
            return ScenarioCreated(
                scenario_id=scenario_id,
                mode=request.mode,
                created_at=public.recorded_at,
                available_actions=["observations", "diagnose"],
            )

    @_offload
    def get_observations(self, scenario_id: str) -> ObservationResponse:
        with self._lock:
            state = self._get(scenario_id)
            return ObservationResponse(
                scenario_id=scenario_id, nights=[n.model_copy(deep=True) for n in state.nights]
            )

    def _analyze(
        self, scenario_id: str, nights: list[NightObservations], *, offer_test: bool = True
    ) -> Diagnosis:
        if self._controller is None:
            raise EngineDependencyError(
                "Kailash's public fitter, template and trained thresholds are not integrated"
            )
        kwargs = {}
        if offer_test:
            weather = resample_weather(self._weather(self.__truth.get(scenario_id).experiment_night_id))
            kwargs = {
                "next_weather": weather,
                "next_protocol": fan_protocol(weather.outdoor_temperature.timestamps[0]),
            }
        # Controller receives only public inputs. No service, truth, seed or House.
        result = self._controller.analyze([n.model_copy(deep=True) for n in nights], **kwargs)
        result = Diagnosis.model_validate(result.model_dump())
        if self._financial is not None and result.status == DiagnosisStatus.CONFIDENT:
            estimate = self._financial.estimate(result.model_copy(deep=True))
            result.money_estimate = MoneyEstimate.model_validate(estimate.model_dump()) if estimate else None
            if result.money_estimate is not None and any(
                isinstance(value, (float, int)) and not math.isfinite(value)
                for value in result.money_estimate.model_dump().values()
            ):
                raise ValueError("financial estimator returned non-finite money")
        return result

    @_offload
    def diagnose(self, scenario_id: str, request: DiagnoseRequest) -> Diagnosis:
        request = DiagnoseRequest.model_validate(request.model_dump())
        with self._lock:
            state = self._get(scenario_id)
            if state.repair_result is not None:
                raise ScenarioStateError(
                    "scenario repaired; use its recorded comparison or create a new scenario"
                )
            available = {n.night_id: n for n in state.nights}
            selected = request.observation_night_ids
            if selected is not None and (
                not selected or len(set(selected)) != len(selected) or not set(selected) <= available.keys()
            ):
                raise ValueError("observation selection must be nonempty, unique and belong to this scenario")
            # Canonical chronological scenario order, independent of request ordering.
            nights = [n for n in state.nights if selected is None or n.night_id in selected]
            result = self._analyze(scenario_id, nights, offer_test=state.experiment_result is None)
            state.latest_diagnosis = result.model_copy(deep=True)
            state.diagnosis_nights = tuple(n.night_id for n in nights)
            return result.model_copy(deep=True)

    def _require_diagnosis(self, state: _PublicScenario, diagnosis_id: str) -> Diagnosis:
        result = state.latest_diagnosis
        if result is None or result.diagnosis_id != diagnosis_id:
            raise ScenarioStateError("diagnosis is missing, stale, or belongs to another scenario")
        if state.diagnosis_nights != tuple(n.night_id for n in state.nights):
            raise ScenarioStateError("action requires a diagnosis using all current observations")
        return result

    @_offload
    def run_experiment(
        self, scenario_id: str, request: ExperimentRequest, *, force_for_evaluation: bool = False
    ) -> ExperimentResponse:
        request = ExperimentRequest.model_validate(request.model_dump())
        if not isinstance(force_for_evaluation, bool):
            raise ValueError("force_for_evaluation must be boolean")
        with self._lock:
            state = self._get(scenario_id)
            if state.experiment_result is not None:
                if request.diagnosis_id == state.experiment_diagnosis_id:
                    return state.experiment_result.model_copy(deep=True)
                raise ScenarioStateError("experiment already recorded")
            diagnosis = self._require_diagnosis(state, request.diagnosis_id)
            if state.repair_result is not None or (
                not force_for_evaluation
                and (not diagnosis.test_decision or not diagnosis.test_decision.recommended)
            ):
                raise ScenarioStateError("no executable recommended experiment")
            truth = self.__truth.get(scenario_id)
            weather = self._weather(truth.experiment_night_id)
            protocol = fan_protocol(weather.outdoor_temperature.timestamps[0])
            observations = simulate_night(
                truth.faulty, weather, protocol, sensor_seed=truth.sensor_seed, sensors=self._sensors
            ).observations
            # Commit only after refitting succeeds; failures cannot partially append a night.
            updated = self._analyze(scenario_id, [*state.nights, observations], offer_test=False)
            response = ExperimentResponse(
                scenario_id=scenario_id, observations=observations, updated_diagnosis=updated
            )
            state.nights.append(observations)
            state.latest_diagnosis = updated.model_copy(deep=True)
            state.diagnosis_nights = tuple(n.night_id for n in state.nights)
            state.experiment_result = response.model_copy(deep=True)
            state.experiment_diagnosis_id = request.diagnosis_id
            return response.model_copy(deep=True)

    @_offload
    def apply_repair(
        self, scenario_id: str, request: RepairRequest, *, effectiveness: float = 1.0
    ) -> RepairResult:
        request = RepairRequest.model_validate(request.model_dump())
        finite(effectiveness, "effectiveness", 0, 1)
        with self._lock:
            state = self._get(scenario_id)
            if state.repair_result is not None:
                if (
                    request.diagnosis_id == state.repair_diagnosis_id
                    and effectiveness == state.repair_result.effectiveness
                ):
                    return state.repair_result.model_copy(deep=True)
                raise ScenarioStateError("repair already applied")
            diagnosis = self._require_diagnosis(state, request.diagnosis_id)
            if diagnosis.status != DiagnosisStatus.CONFIDENT or not diagnosis.ranked_causes:
                raise ScenarioStateError("repair requires a supported confident diagnosis")
            repair_type = FaultType(diagnosis.ranked_causes[0].fault_type.value)
            truth = self.__truth.get(scenario_id)
            repaired_house = repair_house(
                truth.faulty, truth.healthy, diagnosis.flagged_room_id, repair_type, effectiveness
            )
            repaired = [
                simulate_night(
                    repaired_house,
                    self._weather(n.weather.night_id),
                    n.protocol,
                    sensor_seed=truth.sensor_seed,
                    sensors=self._sensors,
                ).observations
                for n in state.nights
            ]
            remeasured = self._analyze(scenario_id, repaired, offer_test=False)
            kwh = None
            if self._financial is not None:
                kwh = self._financial.remeasure(
                    [n.model_copy(deep=True) for n in state.nights],
                    [n.model_copy(deep=True) for n in repaired],
                    diagnosis.model_copy(deep=True),
                )
                if kwh is not None and (
                    not isinstance(kwh, (float, int)) or kwh < 0 or not math.isfinite(kwh)
                ):
                    raise ValueError("financial remeasurement returned invalid annual energy")
            room_id = diagnosis.flagged_room_id
            deltas = [
                b - a
                for before, after in zip(state.nights, repaired, strict=True)
                for a, b in zip(
                    before.room_temperature_series[room_id].values,
                    after.room_temperature_series[room_id].values,
                    strict=True,
                )
                if a is not None and b is not None
            ]
            mean_delta = sum(deltas) / len(deltas) if deltas else 0.0
            response = RepairResult(
                repair_type=repair_type,
                effectiveness=effectiveness,
                original_observations=[n.model_copy(deep=True) for n in state.nights],
                repaired_observations=repaired,
                diagnosed_improvement=f"Paired synthetic mean temperature change {mean_delta:+.3f} degC; "
                f"post-repair public-model status: {remeasured.status.value}. "
                "This is not measured annual energy savings.",
                estimated_savings=diagnosis.money_estimate,
                remeasured_savings_kwh=kwh,
            )
            state.repaired_diagnosis = remeasured.model_copy(deep=True)
            state.repair_result = response.model_copy(deep=True)
            state.repair_diagnosis_id = request.diagnosis_id
            state.repaired_prediction = (repair_type, room_id)
            return response.model_copy(deep=True)

    @_offload
    def reveal(self, scenario_id: str) -> GroundTruth:
        with self._lock:
            state = self._get(scenario_id)
            truth = self.__truth.get(scenario_id)
            result = state.latest_diagnosis
            prediction = None
            if result and result.status == DiagnosisStatus.CONFIDENT and result.ranked_causes:
                prediction = (FaultType(result.ranked_causes[0].fault_type.value), result.flagged_room_id)
            actual = (truth.fault.fault_type, truth.fault.room_id)
            matched = (
                result is not None and result.status == DiagnosisStatus.NO_FAULT
                if truth.fault.fault_type == FaultType.NONE
                else prediction == actual
            )
            return GroundTruth(
                fault_type=truth.fault.fault_type,
                actual_room_id=truth.fault.room_id,
                severity=truth.fault.severity,
                diagnosis_matched=bool(matched),
                repair_addressed_cause=(
                    state.repaired_prediction == actual and state.repair_result.effectiveness > 0
                )
                if state.repair_result is not None
                else None,
            )

    def discard(self, scenario_id: str) -> None:
        """Explicit in-memory lifecycle hook for benchmark runners/demo reset."""
        with self._lock:
            self._public.pop(scenario_id, None)
            self.__truth.discard(scenario_id)
