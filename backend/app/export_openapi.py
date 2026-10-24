"""Export the canonical FastAPI OpenAPI document for TypeScript generation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .main import app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("frontend/openapi.json"))
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
