"""The public engine must never depend on simulator truth or diagnosis orchestration."""

from __future__ import annotations

import ast
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]
FORBIDDEN = ("backend.simulation", "backend.diagnosis", "truth_store")


def test_engine_package_imports_only_public_modules():
    offenders = []
    for path in ENGINE_DIR.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            offenders += [f"{path.name}: {n}" for n in names if any(n.startswith(f) for f in FORBIDDEN)]
    assert offenders == []


def test_engine_reads_no_private_simulator_symbols():
    text = "\n".join(p.read_text(encoding="utf-8") for p in ENGINE_DIR.glob("*.py"))
    for private in ("PrivateScenario", "TruthStore", "GroundTruth", "wall_h", "sensor_seed", "build_house"):
        assert private not in text
