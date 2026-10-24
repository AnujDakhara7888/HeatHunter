"""Versioned, offline decision settings. No simulator or truth-store imports."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import asdict
from pathlib import Path

from .controller import DecisionProfiles, Thresholds

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SETTINGS_PATH = Path(__file__).resolve().with_name("decision_settings.json")
PUBLIC_ASSETS = (
    "backend/engine/adapter.py",
    "backend/engine/model.py",
    "backend/engine/fitting.py",
    "backend/engine/prediction.py",
    "backend/engine/templates/hh09_public_template.json",
    "backend/engine/templates/hh09_model_extension.json",
    "backend/diagnosis/controller.py",
)


class DecisionSettingsError(ValueError):
    """Uncalibrated, stale or malformed settings must not silently drive diagnosis."""


def fingerprints(paths: tuple[str, ...] = PUBLIC_ASSETS) -> dict[str, str]:
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in paths}


def write_settings(payload: dict, path: Path = DEFAULT_SETTINGS_PATH) -> None:
    """Atomic JSON write; no executable/pickled calibration objects."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(payload, indent=2, allow_nan=False) + "\n"
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as f:
            temporary = f.name
            f.write(data)
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def profile_payload(profiles: DecisionProfiles) -> dict:
    return {"passive": asdict(profiles.passive), "post_fan": asdict(profiles.post_fan)}


def load_settings(
    path: Path | str | None = None, *, template_id: str, verify_assets: bool = True
) -> tuple[DecisionProfiles, dict]:
    path = Path(path or DEFAULT_SETTINGS_PATH)
    if not path.is_file():
        raise DecisionSettingsError("Decision settings missing; run the training-only calibration first")
    if path.stat().st_size > 2_000_000:
        raise DecisionSettingsError("Decision settings file is unexpectedly large")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if type(payload["schema_version"]) is not int or payload["schema_version"] != 1:
            raise DecisionSettingsError("Decision settings version/template mismatch")
        if payload["template_id"] != template_id:
            raise DecisionSettingsError("Decision settings version/template mismatch")
        profiles = DecisionProfiles(
            **{name: Thresholds(**payload["profiles"][name]) for name in ("passive", "post_fan")}
        )
        if any(
            not isinstance(profile.calibration_note, str) or not profile.calibration_note.strip()
            for profile in (profiles.passive, profiles.post_fan)
        ):
            raise DecisionSettingsError("Decision settings require nonempty calibration notes")
        if payload["training"]["training_only"] is not True:
            raise DecisionSettingsError("Settings do not declare training-only calibration")
        if verify_assets and payload["public_assets"] != fingerprints():
            raise DecisionSettingsError(
                "Public model changed after threshold calibration; recalibrate settings"
            )
    except (KeyError, TypeError, json.JSONDecodeError, ValueError) as exc:
        if isinstance(exc, DecisionSettingsError):
            raise
        raise DecisionSettingsError(f"Malformed decision settings: {exc}") from exc
    return profiles, payload
