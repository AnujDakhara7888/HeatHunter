"""Multi-night room-health monitoring rule (public inputs only).

One night cannot tell an air leak from an envelope (wall/roof/floor) loss: both
make a room cool faster. Leak heat loss rises with wind and wall loss does not,
so nights of varying weather separate them. This rule therefore judges each
room on ALL nights recorded so far:

* for the room, the public engine fits normal, draft and envelope conduction;
* the leading fault is the one with the lower BIC; its *excess heat loss* is
  the extra seasonal conductance it implies, as a fraction of the room's
  nominal seasonal heat loss;
* the room is a candidate when the excess exceeds ``a + b / sqrt(nights)`` for
  its leading cause (strict while evidence is thin) and the fault fits better
  than "normal";
* it is flagged once it has been a candidate, with the same leading cause, for
  ``persistence_nights`` consecutive nights. The cause is named only when the
  draft/envelope BIC gap exceeds ``cause_gap_bic``.

Settings are tuned on TRAINING-season simulated houses only
(``backend/simulation/tune_monitoring.py``) and fingerprint the engine assets they
were tuned against, so a changed engine cannot silently use stale thresholds.
No simulator or truth-store imports.
"""

from __future__ import annotations

import json
import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from backend.app.contracts import HypothesisFit, HypothesisType, NightObservations, PublicTemplate
from backend.engine import PublicModelEngine, excess_fraction
from backend.engine.model import AUTO, ModelExtension, resolve_extension

from .settings import DecisionSettingsError, fingerprints

DEFAULT_MONITORING_PATH = Path(__file__).resolve().with_name("monitoring_settings.json")
MONITORING_ASSETS = (
    "backend/engine/model.py",
    "backend/engine/fitting.py",
    "backend/engine/money.py",
    "backend/engine/templates/hh09_public_template.json",
    "backend/engine/templates/hh09_model_extension.json",
    "backend/diagnosis/monitoring.py",
)
FAULTS = (HypothesisType.DRAFT, HypothesisType.ENVELOPE_CONDUCTION)
RoomStatus = Literal["healthy", "watching", "issue", "issue_cause_unclear"]


@dataclass(frozen=True)
class MonitoringSettings:
    template_id: str
    draft_a: float
    draft_b: float
    envelope_a: float
    envelope_b: float
    persistence_nights: int
    cause_gap_bic: float
    provenance: str = ""

    def __post_init__(self) -> None:
        for name in ("draft_a", "draft_b", "envelope_a", "envelope_b", "cause_gap_bic"):
            number = getattr(self, name)
            if isinstance(number, bool) or not math.isfinite(number) or number < 0:
                raise DecisionSettingsError(f"monitoring setting {name} must be finite and non-negative")
        if isinstance(self.persistence_nights, bool) or self.persistence_nights < 1:
            raise DecisionSettingsError("persistence_nights must be a positive integer")

    def threshold(self, cause: HypothesisType, nights: int) -> float:
        a, b = (
            (self.draft_a, self.draft_b)
            if cause == HypothesisType.DRAFT
            else (self.envelope_a, self.envelope_b)
        )
        return a + b / math.sqrt(nights)


def load_monitoring_settings(
    path: Path | str | None = None, *, template_id: str, verify_assets: bool = True
) -> MonitoringSettings:
    path = Path(path or DEFAULT_MONITORING_PATH)
    if not path.is_file():
        raise DecisionSettingsError(
            "Monitoring settings missing; run backend.simulation.tune_monitoring first"
        )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload["schema_version"] != 1:
            raise DecisionSettingsError("unsupported monitoring settings version")
        if payload["template_id"] != template_id:
            raise DecisionSettingsError("monitoring settings were tuned for a different public template")
        if verify_assets and payload["public_assets"] != fingerprints(MONITORING_ASSETS):
            raise DecisionSettingsError(
                "public engine changed after the monitoring rule was tuned; retune it"
            )
        threshold = payload["excess_threshold"]
        return MonitoringSettings(
            template_id=payload["template_id"],
            draft_a=float(threshold["draft"]["a"]),
            draft_b=float(threshold["draft"]["b"]),
            envelope_a=float(threshold["envelope_conduction"]["a"]),
            envelope_b=float(threshold["envelope_conduction"]["b"]),
            persistence_nights=int(payload["persistence_nights"]),
            cause_gap_bic=float(payload["cause_gap_bic"]),
            provenance=str(payload.get("provenance", "")),
        )
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, DecisionSettingsError):
            raise
        raise DecisionSettingsError(f"malformed monitoring settings: {exc}") from exc


@dataclass(frozen=True)
class NightScore:
    """The rule's view of one room after a given number of nights."""

    nights: int
    leading_cause: HypothesisType
    excess_fraction: float
    threshold: float
    cause_gap_bic: float
    candidate: bool
    fits: dict[HypothesisType, HypothesisFit]


@dataclass(frozen=True)
class RoomHealth:
    room_id: str
    status: RoomStatus
    nights: int
    consecutive_candidate_nights: int
    leading_cause: HypothesisType
    excess_fraction: float  # extra seasonal heat loss / the room's nominal seasonal heat loss
    threshold: float
    cause_gap_bic: float
    fits: dict[HypothesisType, HypothesisFit] = field(default_factory=dict)

    @property
    def named_cause(self) -> HypothesisType | None:
        return self.leading_cause if self.status == "issue" else None


def score_room(
    nights: Sequence[NightObservations],
    room_id: str,
    template: PublicTemplate,
    settings: MonitoringSettings,
    engine: PublicModelEngine,
    extension: ModelExtension | None,
) -> NightScore:
    fits = {
        cause: engine.fit_hypothesis(list(nights), room_id, template, cause)
        for cause in (HypothesisType.NORMAL, *FAULTS)
    }
    cause = min(FAULTS, key=lambda c: (fits[c].bic, c.value))
    other = next(c for c in FAULTS if c != cause)
    excess = excess_fraction(template, room_id, cause, fits[cause].fitted_multiplier, extension=extension)
    threshold = settings.threshold(cause, len(nights))
    return NightScore(
        nights=len(nights),
        leading_cause=cause,
        excess_fraction=excess,
        threshold=threshold,
        cause_gap_bic=fits[other].bic - fits[cause].bic,
        candidate=excess > threshold and fits[HypothesisType.NORMAL].bic > fits[cause].bic,
        fits=fits,
    )


def room_status(history: Sequence[NightScore], settings: MonitoringSettings) -> tuple[RoomStatus, int]:
    """Status from a room's scores after 1, 2, ... nights (oldest first) and its candidate streak.

    Only the last ``persistence_nights`` scores matter, so callers that score
    night by night can keep a running history instead of refitting old prefixes.
    """

    if not history:
        raise ValueError("at least one scored night is required")
    latest = history[-1]
    streak = 0
    for score in reversed(history[-settings.persistence_nights :]):
        if not (score.candidate and score.leading_cause == latest.leading_cause):
            break
        streak += 1
    if streak >= settings.persistence_nights:
        status: RoomStatus = (
            "issue" if latest.cause_gap_bic > settings.cause_gap_bic else "issue_cause_unclear"
        )
    elif streak:
        status = "watching"
    else:
        status = "healthy"
    return status, streak


def assess_rooms(
    nights: Sequence[NightObservations],
    template: PublicTemplate,
    settings: MonitoringSettings,
    *,
    engine: PublicModelEngine | None = None,
    extension: ModelExtension | None = AUTO,
) -> list[RoomHealth]:
    """Health of every template room after all ``nights`` (oldest first).

    Persistence is checked by re-scoring the same room on the earlier prefixes
    of the night list, exactly as the rule was tuned.
    """

    if not nights:
        raise ValueError("at least one night is required")
    if settings.template_id != template.template_id:
        raise DecisionSettingsError("monitoring settings were tuned for a different public template")
    engine = engine or PublicModelEngine(extension=extension)
    layer = resolve_extension(template, extension)
    nights = list(nights)
    out = []
    for room in template.rooms:
        first = max(len(nights) - settings.persistence_nights + 1, 1)
        history = [
            score_room(nights[:count], room.room_id, template, settings, engine, layer)
            for count in range(first, len(nights) + 1)
        ]
        status, streak = room_status(history, settings)
        latest = history[-1]
        out.append(
            RoomHealth(
                room_id=room.room_id,
                status=status,
                nights=len(nights),
                consecutive_candidate_nights=streak,
                leading_cause=latest.leading_cause,
                excess_fraction=latest.excess_fraction,
                threshold=latest.threshold,
                cause_gap_bic=latest.cause_gap_bic,
                fits=latest.fits,
            )
        )
    return out
