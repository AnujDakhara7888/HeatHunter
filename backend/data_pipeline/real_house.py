"""Reader for the processed SMETER Phase 2 house used by the Real Homes tab."""

from __future__ import annotations

import json
from pathlib import Path

from backend.app.contracts import RealHouse

DEFAULT_REAL_HOUSE_PATH = Path(__file__).resolve().parents[2] / "data" / "processed" / "smeter_hh09.json"


def load_real_house(path: str | Path | None = None) -> RealHouse:
    """Load and validate the selected real-house payload without network access."""

    data_path = Path(path) if path is not None else DEFAULT_REAL_HOUSE_PATH
    if not data_path.is_file():
        raise FileNotFoundError(f"Processed real-house data is missing: {data_path}")
    with data_path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    return RealHouse.model_validate(payload)
