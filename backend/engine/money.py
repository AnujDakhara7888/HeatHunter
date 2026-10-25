"""Screening money estimates from fitted public-model hypotheses (Kailash).

    excess_H   = seasonal heat-loss conductance with the fitted multiplier
                 minus the same conductance with multiplier 1          [W/K]
    heat_kWh   = excess_H x heating_degree_days x 24 / 1000
    gas_kWh    = heat_kWh / boiler_efficiency
    cost_GBP   = gas_kWh x marginal gas unit price
    cost_USD   = cost_GBP x GBP->USD rate
    payback    = repair_cost_USD / cost_USD

For envelope conduction, excess_H = (m - 1) x H_cond, exactly as in the
specification. A draft's leakage path runs through the room-air layer in
series, alongside the windows, so excess_H = H_ser(H_win + m H_inf) -
H_ser(H_win + H_inf), evaluated at the seasonal mean wind and the leakage
law's reference indoor-outdoor difference. Without an air layer this reduces
to (m - 1) x H_inf at those conditions.
These are screening estimates resting on explicit, sourced assumptions, not
audited savings. Unsupported cases return ``None`` and never a fabricated
number.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from backend.app.contracts import (
    Assumption,
    Diagnosis,
    DiagnosisStatus,
    HypothesisFit,
    HypothesisType,
    MoneyEstimate,
    NightObservations,
    PublicTemplate,
)
from backend.data_pipeline import load_hh09_twin_inputs

from .assumptions import entry, load_assumptions, to_contract, value
from .fitting import FitSettings, fit_hypothesis
from .model import AUTO, ModelExtension, TemplateArrays, leakage_factor, resolve_extension, series_conductance

REPAIR_FOR_CAUSE = {HypothesisType.DRAFT: "seal_leaks", HypothesisType.ENVELOPE_CONDUCTION: "add_insulation"}


def excess_conductance(
    template: PublicTemplate,
    room_id: str,
    cause: HypothesisType,
    multiplier: float,
    *,
    assumptions: dict[str, Any] | None = None,
    extension: ModelExtension | None = AUTO,
) -> float:
    """Extra seasonal heat-loss conductance (W/K) implied by a hypothesis multiplier.

    It can be negative when the multiplier is below 1.
    """

    assumptions = assumptions or load_assumptions()
    arrays = TemplateArrays.from_template(template, resolve_extension(template, extension))
    i = arrays.index(room_id)
    cause = HypothesisType(cause)
    if cause == HypothesisType.ENVELOPE_CONDUCTION:
        return float((multiplier - 1.0) * arrays.conduction[i])
    if cause == HypothesisType.DRAFT:
        mean_wind = value(assumptions, "economic", "heating_season_mean_wind_speed")
        law = arrays.leakage_law
        delta_t = law.reference_delta_t_k if law is not None else 0.0
        nominal = arrays.infiltration[i] * float(
            leakage_factor(arrays.wind_sensitivity[i], law, mean_wind, delta_t)
        )
        after = series_conductance(arrays.air_fabric[i], arrays.window[i] + multiplier * nominal)
        before = series_conductance(arrays.air_fabric[i], arrays.window[i] + nominal)
        return float(after - before)
    raise ValueError("only fault hypotheses have an excess heat-loss path")


def annual_gas_kwh(excess_conductance_w_per_k: float, assumptions: dict[str, Any] | None = None) -> float:
    assumptions = assumptions or load_assumptions()
    degree_days = value(assumptions, "economic", "heating_degree_days")
    efficiency = value(assumptions, "economic", "heating_efficiency")
    return excess_conductance_w_per_k * degree_days * 24 / 1000 / efficiency


def repair_cost_gbp(room_id: str, cause: HypothesisType, assumptions: dict[str, Any] | None = None) -> float:
    """Illustrative, unverified repair cost (GBP); user-adjustable by design."""

    assumptions = assumptions or load_assumptions()
    repair = REPAIR_FOR_CAUSE[HypothesisType(cause)]
    rate = float(assumptions["economic"]["repair_costs"][repair]["value"])
    if repair == "seal_leaks":
        return rate
    walls = assumptions["economic"]["room_exterior_walls"]
    length = float(walls["rooms"][room_id])
    windows = next(
        sum(w["area_m2"] for w in room["windows"]["value"])
        for room in load_hh09_twin_inputs()["rooms"]
        if room["simulator_room_id"] == room_id
    )
    return rate * max(length * float(walls["ceiling_height_m"]) - windows, 0.0)


@dataclass(frozen=True)
class MoneyOverrides:
    """Optional user adjustments (the UI tariff and repair-price controls)."""

    gas_price_pence_per_kwh: float | None = None
    repair_cost_gbp: float | None = None


def estimate_money(
    template: PublicTemplate,
    room_id: str,
    fit: HypothesisFit,
    *,
    assumptions: dict[str, Any] | None = None,
    overrides: MoneyOverrides | None = None,
    extension: ModelExtension | None = AUTO,
) -> MoneyEstimate | None:
    """Annual screening cost of a fitted excess heat-loss path; ``None`` if unsupported."""

    fit = HypothesisFit.model_validate(fit.model_dump())
    if fit.fault_type == HypothesisType.NORMAL or fit.fitted_multiplier <= 1:
        return None
    assumptions = assumptions or load_assumptions()
    overrides = overrides or MoneyOverrides()
    cause = fit.fault_type
    excess = excess_conductance(
        template, room_id, cause, fit.fitted_multiplier, assumptions=assumptions, extension=extension
    )
    gas_kwh = annual_gas_kwh(excess, assumptions)
    price_overridden = overrides.gas_price_pence_per_kwh is not None
    price_pence = (
        overrides.gas_price_pence_per_kwh
        if price_overridden
        else value(assumptions, "economic", "gas_unit_price")
    )
    fx = value(assumptions, "economic", "gbp_to_usd")
    annual_cost_usd = gas_kwh * price_pence / 100 * fx
    repair_gbp = (
        overrides.repair_cost_gbp
        if overrides.repair_cost_gbp is not None
        else repair_cost_gbp(room_id, cause, assumptions)
    )
    repair_usd = repair_gbp * fx
    payback = repair_usd / annual_cost_usd if annual_cost_usd > 0 else None

    economic = assumptions["economic"]
    repair_name = REPAIR_FOR_CAUSE[cause]
    used: list[Assumption] = [
        to_contract("heating_degree_days", entry(assumptions, "economic", "heating_degree_days")),
        to_contract("heating_efficiency", entry(assumptions, "economic", "heating_efficiency")),
        to_contract(
            "gas_unit_price",
            entry(assumptions, "economic", "gas_unit_price"),
            value_override=price_pence if price_overridden else None,
        ),
        to_contract("gbp_to_usd", entry(assumptions, "economic", "gbp_to_usd")),
        to_contract(f"repair_cost_{repair_name}", economic["repair_costs"][repair_name]),
        to_contract("thermal_mass_parameter", entry(assumptions, "physical", "thermal_mass_parameter")),
        Assumption(
            name="annual_energy_basis",
            value="gas energy = excess heat loss / boiler efficiency; standing charge excluded",
        ),
    ]
    if overrides.repair_cost_gbp is not None:
        used.append(Assumption(name="repair_cost_user_override", value=repair_gbp, unit="GBP"))
    if cause == HypothesisType.DRAFT:
        used.append(
            to_contract(
                "heating_season_mean_wind_speed",
                entry(assumptions, "economic", "heating_season_mean_wind_speed"),
            )
        )
    return MoneyEstimate(
        excess_conductance_w_per_k=excess,
        annual_energy_estimate_kwh=gas_kwh,
        annual_cost_estimate_usd=annual_cost_usd,
        repair_cost_usd=repair_usd,
        simple_payback_years=payback,
        assumptions=used,
    )


def remeasured_savings_kwh(
    original: Sequence[NightObservations],
    repaired: Sequence[NightObservations],
    room_id: str,
    template: PublicTemplate,
    cause: HypothesisType,
    *,
    assumptions: dict[str, Any] | None = None,
    settings: FitSettings | None = None,
    extension: ModelExtension | None = AUTO,
) -> float | None:
    """Annual gas kWh saved, inferred only by refitting public before/after observations.

    It refits the diagnosed hypothesis on both observation sets and prices the
    drop in fitted excess conductance. A fitted worsening is reported as 0,
    because the contract field is non-negative. The paired temperature
    comparison stays visible in the repair result.
    """

    cause = HypothesisType(cause)
    if cause == HypothesisType.NORMAL:
        return None
    layer = resolve_extension(template, extension)
    before = fit_hypothesis(original, room_id, template, cause, settings, layer).fitted_multiplier
    after = fit_hypothesis(repaired, room_id, template, cause, settings, layer).fitted_multiplier
    saved = excess_conductance(
        template, room_id, cause, before, assumptions=assumptions, extension=layer
    ) - excess_conductance(template, room_id, cause, after, assumptions=assumptions, extension=layer)
    return max(annual_gas_kwh(saved, assumptions), 0.0)


class PublicMoneyEstimator:
    """Implements the diagnosis service's ``FinancialEstimator`` protocol."""

    def __init__(
        self,
        template: PublicTemplate,
        *,
        assumptions: dict[str, Any] | None = None,
        overrides: MoneyOverrides | None = None,
        settings: FitSettings | None = None,
        extension: ModelExtension | None = AUTO,
    ) -> None:
        self.template = PublicTemplate.model_validate(template.model_dump())
        self.assumptions = assumptions or load_assumptions()
        self.overrides = overrides
        self.settings = settings
        self.extension = resolve_extension(self.template, extension)

    def estimate(self, diagnosis: Diagnosis) -> MoneyEstimate | None:
        if diagnosis.status != DiagnosisStatus.CONFIDENT or not diagnosis.ranked_causes:
            return None
        return estimate_money(
            self.template,
            diagnosis.flagged_room_id,
            diagnosis.ranked_causes[0],
            assumptions=self.assumptions,
            overrides=self.overrides,
            extension=self.extension,
        )

    def remeasure(
        self, original: list[NightObservations], repaired: list[NightObservations], diagnosis: Diagnosis
    ) -> float | None:
        if not diagnosis.ranked_causes or diagnosis.flagged_room_id is None:
            return None
        return remeasured_savings_kwh(
            original,
            repaired,
            diagnosis.flagged_room_id,
            self.template,
            diagnosis.ranked_causes[0].fault_type,
            assumptions=self.assumptions,
            settings=self.settings,
            extension=self.extension,
        )
