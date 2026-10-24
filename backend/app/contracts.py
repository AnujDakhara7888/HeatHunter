"""Canonical API contracts for all HeatHunter modules.

These Pydantic models are the source of truth for OpenAPI and generated
TypeScript types. Internal physics implementations may use richer private types,
but all integration boundaries must convert to these public contracts.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

NonNegativeFloat = Annotated[float, Field(ge=0)]
PositiveFloat = Annotated[float, Field(gt=0)]
Probability = Annotated[float, Field(ge=0, le=1)]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Provenance(StrEnum):
    REAL_MEASUREMENT = "REAL_MEASUREMENT"
    SIMULATED_MEASUREMENT = "SIMULATED_MEASUREMENT"
    SIMULATED_GROUND_TRUTH = "SIMULATED_GROUND_TRUTH"
    MODEL_ESTIMATE = "MODEL_ESTIMATE"
    ASSUMPTION = "ASSUMPTION"


class FaultType(StrEnum):
    DRAFT = "draft"
    ENVELOPE_CONDUCTION = "envelope_conduction"
    NONE = "none"


class HypothesisType(StrEnum):
    NORMAL = "normal"
    DRAFT = "draft"
    ENVELOPE_CONDUCTION = "envelope_conduction"


class DiagnosisStatus(StrEnum):
    NO_FAULT = "no_fault"
    UNEXPLAINED = "unexplained"
    AMBIGUOUS = "ambiguous"
    CONFIDENT = "confident"


class ScenarioMode(StrEnum):
    GUIDED = "guided"
    JUDGE = "judge"
    SURPRISE = "surprise"


class Split(StrEnum):
    TRAINING = "training"
    HELDOUT = "heldout"


class Series(ContractModel):
    timestamps: list[datetime] = Field(min_length=1)
    values: list[float | None] = Field(min_length=1)
    unit: str = Field(min_length=1)
    provenance: Provenance

    @model_validator(mode="after")
    def validate_alignment(self) -> Series:
        if len(self.timestamps) != len(self.values):
            raise ValueError("timestamps and values must have equal lengths")
        if any(timestamp.tzinfo is None for timestamp in self.timestamps):
            raise ValueError("all timestamps must include a UTC offset")
        if self.timestamps != sorted(self.timestamps) or len(set(self.timestamps)) != len(self.timestamps):
            raise ValueError("timestamps must be unique and increasing")
        return self


class SourceMetadata(ContractModel):
    provider: str
    dataset: str
    url: HttpUrl | None = None
    citation: str | None = None
    license: str | None = None
    notes: str | None = None
    station_id: str | None = None
    station_call_sign: str | None = None
    station_name: str | None = None


class Location(ContractModel):
    name: str
    # Null when the source does not publish coordinates (e.g. the SMETER Phase 2
    # station); unpublished coordinates must never be approximated.
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    timezone: str
    elevation_m: float | None = None
    distance_to_stony_brook_km_approx: NonNegativeFloat | None = None


class UtcWindow(ContractModel):
    start: datetime
    end: datetime
    note: str | None = None

    @model_validator(mode="after")
    def validate_order(self) -> UtcWindow:
        if self.start.tzinfo is None or self.end.tzinfo is None:
            raise ValueError("UTC window timestamps must include offsets")
        if self.end <= self.start:
            raise ValueError("UTC window end must be after start")
        return self


class WeatherSelectionMetadata(ContractModel):
    weather_regime: Literal["calm", "moderate", "windy"]
    mean_temperature_deg_c: float
    mean_wind_speed_m_s: NonNegativeFloat
    observation_count: int = Field(ge=1)
    temperature_quality_flags: list[str]
    wind_quality_flags: list[str]


class WeatherNight(ContractModel):
    schema_version: Literal[1] = 1
    night_id: str
    source: SourceMetadata
    location: Location
    outdoor_temperature: Series
    wind_speed: Series
    train_or_heldout_split: Split
    local_night_date: date | None = None
    utc_window: UtcWindow | None = None
    selection_metadata: WeatherSelectionMetadata | None = None

    @model_validator(mode="after")
    def validate_weather_series(self) -> WeatherNight:
        if self.outdoor_temperature.unit != "degC":
            raise ValueError("outdoor temperature unit must be degC")
        if self.wind_speed.unit != "m/s":
            raise ValueError("wind speed unit must be m/s")
        if self.outdoor_temperature.timestamps != self.wind_speed.timestamps:
            raise ValueError("weather series must share timestamps")
        return self


class RoomTemplate(ContractModel):
    room_id: str
    room_name: str
    volume_m3: PositiveFloat
    nominal_capacitance_j_per_k: PositiveFloat
    nominal_envelope_conductance_w_per_k: PositiveFloat
    nominal_infiltration_conductance_w_per_k: PositiveFloat
    wind_sensitivity_s_per_m: NonNegativeFloat
    nominal_leakage_share: Probability


class InterRoomCoupling(ContractModel):
    room_a_id: str
    room_b_id: str
    conductance_w_per_k: PositiveFloat


class PublicTemplate(ContractModel):
    template_id: str
    rooms: list[RoomTemplate] = Field(min_length=1)
    inter_room_couplings: list[InterRoomCoupling]
    calibrated_from_split: Literal[Split.TRAINING] = Split.TRAINING
    provenance: Literal[Provenance.MODEL_ESTIMATE] = Provenance.MODEL_ESTIMATE

    @model_validator(mode="after")
    def validate_room_ids_and_shares(self) -> PublicTemplate:
        room_ids = [room.room_id for room in self.rooms]
        if len(room_ids) != len(set(room_ids)):
            raise ValueError("public template room IDs must be unique")
        if abs(sum(room.nominal_leakage_share for room in self.rooms) - 1.0) > 1e-6:
            raise ValueError("nominal leakage shares must sum to 1")
        return self


class Protocol(ContractModel):
    heating_off: bool
    doors_closed: bool
    fan_on: bool
    fan_airflow_m3_per_h: NonNegativeFloat | None = None
    fan_start: datetime | None = None
    fan_end: datetime | None = None

    @model_validator(mode="after")
    def validate_fan_fields(self) -> Protocol:
        fan_fields = (self.fan_airflow_m3_per_h, self.fan_start, self.fan_end)
        if self.fan_on and any(value is None for value in fan_fields):
            raise ValueError("fan protocol requires airflow, start, and end")
        if not self.fan_on and any(value is not None for value in fan_fields):
            raise ValueError("fan fields must be null when fan_on is false")
        if self.fan_start and self.fan_end and self.fan_end <= self.fan_start:
            raise ValueError("fan_end must be after fan_start")
        return self


class NightObservations(ContractModel):
    night_id: str
    kind: Literal["passive", "fan_test"]
    room_temperature_series: dict[str, Series]
    weather: WeatherNight
    protocol: Protocol

    @model_validator(mode="after")
    def validate_observation_timestamps(self) -> NightObservations:
        if not self.room_temperature_series:
            raise ValueError("at least one room temperature series is required")
        for room_id, series in self.room_temperature_series.items():
            if series.unit != "degC":
                raise ValueError(f"room {room_id} temperature unit must be degC")
            if series.timestamps != self.weather.outdoor_temperature.timestamps:
                raise ValueError(f"room {room_id} and weather timestamps must align")
        if (self.kind == "fan_test") != self.protocol.fan_on:
            raise ValueError("fan_test kind and protocol.fan_on must agree")
        return self


class HypothesisFit(ContractModel):
    fault_type: HypothesisType
    fitted_multiplier: PositiveFloat
    sse: NonNegativeFloat
    bic: float
    residual_rmse_deg_c: NonNegativeFloat
    provenance: Literal[Provenance.MODEL_ESTIMATE] = Provenance.MODEL_ESTIMATE


class Evidence(ContractModel):
    statement: str
    relationship: Literal["supports", "contradicts", "limits"]
    provenance: Provenance


class TestDecision(ContractModel):
    recommended: bool
    experiment_type: Literal["exhaust_fan_depressurization"] | None = None
    separation_score: NonNegativeFloat | None = None
    explanation: str
    safety_warning: str | None = None
    provenance: Literal[Provenance.MODEL_ESTIMATE] = Provenance.MODEL_ESTIMATE

    @model_validator(mode="after")
    def validate_recommendation(self) -> TestDecision:
        if self.recommended and self.experiment_type is None:
            raise ValueError("recommended tests require an experiment_type")
        return self


class Assumption(ContractModel):
    name: str
    value: float | str | bool
    unit: str | None = None
    source: SourceMetadata | None = None
    provenance: Literal[Provenance.ASSUMPTION] = Provenance.ASSUMPTION


class MoneyEstimate(ContractModel):
    excess_conductance_w_per_k: NonNegativeFloat
    annual_energy_estimate_kwh: NonNegativeFloat
    annual_cost_estimate_usd: NonNegativeFloat
    repair_cost_usd: NonNegativeFloat
    simple_payback_years: NonNegativeFloat | None
    assumptions: list[Assumption]
    provenance: Literal[Provenance.MODEL_ESTIMATE] = Provenance.MODEL_ESTIMATE


class Diagnosis(ContractModel):
    diagnosis_id: str
    status: DiagnosisStatus
    flagged_room_id: str | None
    ranked_causes: list[HypothesisFit]
    evidence: list[Evidence]
    uncertainty: list[str]
    test_decision: TestDecision | None
    money_estimate: MoneyEstimate | None
    assumptions: list[Assumption]

    @model_validator(mode="after")
    def validate_status(self) -> Diagnosis:
        if self.status == DiagnosisStatus.NO_FAULT and self.flagged_room_id is not None:
            raise ValueError("no_fault diagnosis cannot flag a room")
        if self.status in {DiagnosisStatus.AMBIGUOUS, DiagnosisStatus.CONFIDENT} and not self.flagged_room_id:
            raise ValueError("ambiguous or confident diagnosis must flag a room")
        return self


class ScenarioCreateRequest(ContractModel):
    mode: ScenarioMode
    guided_scenario_id: str | None = None
    judge_fault_type: FaultType | None = None
    judge_room_id: str | None = None
    severity: Annotated[float, Field(gt=0, le=3)] | None = None
    seed: int | None = None

    @model_validator(mode="after")
    def validate_mode_fields(self) -> ScenarioCreateRequest:
        if self.mode == ScenarioMode.GUIDED and self.guided_scenario_id is None:
            raise ValueError("guided mode requires guided_scenario_id")
        judge_fields = (self.judge_fault_type, self.judge_room_id, self.severity)
        if self.mode == ScenarioMode.JUDGE and any(value is None for value in judge_fields):
            raise ValueError("judge mode requires fault type, room, and severity")
        if self.mode != ScenarioMode.JUDGE and any(value is not None for value in judge_fields):
            raise ValueError("judge-only fields are not accepted for this mode")
        return self


class ScenarioCreated(ContractModel):
    scenario_id: str
    mode: ScenarioMode
    created_at: datetime
    available_actions: list[Literal["observations", "diagnose"]]


class ObservationResponse(ContractModel):
    scenario_id: str
    nights: list[NightObservations] = Field(min_length=1)


class DiagnoseRequest(ContractModel):
    observation_night_ids: list[str] | None = None


class ExperimentRequest(ContractModel):
    diagnosis_id: str
    experiment_type: Literal["exhaust_fan_depressurization"]


class ExperimentResponse(ContractModel):
    scenario_id: str
    observations: NightObservations
    updated_diagnosis: Diagnosis


class RepairRequest(ContractModel):
    diagnosis_id: str


class RepairResult(ContractModel):
    repair_type: FaultType
    effectiveness: Probability
    original_observations: list[NightObservations] = Field(min_length=1)
    repaired_observations: list[NightObservations] = Field(min_length=1)
    diagnosed_improvement: str
    estimated_savings: MoneyEstimate | None
    remeasured_savings_kwh: NonNegativeFloat | None
    provenance: Literal[Provenance.SIMULATED_MEASUREMENT] = Provenance.SIMULATED_MEASUREMENT


class GroundTruth(ContractModel):
    fault_type: FaultType
    actual_room_id: str | None
    severity: NonNegativeFloat
    diagnosis_matched: bool
    repair_addressed_cause: bool | None
    provenance: Literal[Provenance.SIMULATED_GROUND_TRUTH] = Provenance.SIMULATED_GROUND_TRUTH


class BuildingCharacteristic(ContractModel):
    name: str
    value: float | str | bool
    unit: str | None = None
    provenance: Literal[Provenance.REAL_MEASUREMENT, Provenance.ASSUMPTION]


class MeasuredMetric(ContractModel):
    value: float
    unit: str
    method: str | None = None
    provenance: Literal[Provenance.REAL_MEASUREMENT]


class RealHouse(ContractModel):
    house_id: str
    display_name: str
    source: SourceMetadata
    floor_plan_asset_path: str
    room_temperature_series: dict[str, Series]
    outdoor_temperature: Series
    wind_speed: Series
    characteristics: list[BuildingCharacteristic]
    reference_htc: MeasuredMetric | None
    airtightness: MeasuredMetric | None
    measurement_start: datetime
    measurement_end: datetime
    timestamp_notes: str
    scientific_disclaimer: str


class ConfusionMatrix(ContractModel):
    actual_labels: list[str]
    predicted_labels: list[str]
    counts: dict[str, dict[str, int]]


class EvaluationSummary(ContractModel):
    benchmark_id: str
    generated_at: datetime
    heldout_scenario_count: int = Field(ge=1)
    fault_detection_accuracy: Probability
    room_identification_accuracy: Probability
    pre_experiment_cause_classification_accuracy: Probability
    post_experiment_cause_classification_accuracy: Probability | None
    baseline_strategy_accuracy: Probability | None
    false_positive_rate: Probability
    ambiguity_rate: Probability
    unexplained_rate: Probability
    pre_experiment_confusion_matrix: ConfusionMatrix
    post_experiment_confusion_matrix: ConfusionMatrix | None
    disclaimer: str
    provenance: Literal[Provenance.MODEL_ESTIMATE] = Provenance.MODEL_ESTIMATE


class HealthResponse(ContractModel):
    status: Literal["ok"] = "ok"
    service: Literal["heat-hunter-api"] = "heat-hunter-api"


class ApiError(ContractModel):
    detail: str
    code: str


def public_contract_models() -> dict[str, type[BaseModel]]:
    """Named model registry used by fixture validation and integration tooling."""

    return {
        model.__name__: model
        for model in (
            Series,
            WeatherNight,
            PublicTemplate,
            Protocol,
            NightObservations,
            HypothesisFit,
            Diagnosis,
            MoneyEstimate,
            RepairResult,
            GroundTruth,
            RealHouse,
            EvaluationSummary,
        )
    }
