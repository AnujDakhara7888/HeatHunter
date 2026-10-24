"""Scan TRAINING-split seeds for the guided scenario and record every outcome.

The guided demo seed is *selected* to illustrate the complete workflow. This
scan makes that selection reproducible and discloses how often each outcome
occurs, so the demo is never presented as typical performance.

    .venv/bin/python -m backend.app.demo_seed_scan --seeds 120
"""

from __future__ import annotations

import argparse
import asyncio
import json
from collections import Counter
from pathlib import Path

from .contracts import (
    DiagnoseRequest,
    DiagnosisStatus,
    ExperimentRequest,
    RepairRequest,
    ScenarioCreateRequest,
)
from .runtime import REPOSITORY_ROOT, get_runtime

OUTPUT = REPOSITORY_ROOT / "shared" / "fixtures" / "guided_seed_scan.json"


async def investigate(seed: int) -> dict:
    service = get_runtime().scenarios
    created = await service.create_scenario(
        ScenarioCreateRequest(mode="guided", guided_scenario_id="hh09-guided-v1", seed=seed)
    )
    sid = created.scenario_id
    diagnosis = await service.diagnose(sid, DiagnoseRequest())
    arc = [diagnosis.status.value]
    recommended = bool(diagnosis.test_decision and diagnosis.test_decision.recommended)
    arc.append("test" if recommended else "no_test")
    if recommended:
        experiment = await service.run_experiment(
            sid,
            ExperimentRequest(
                diagnosis_id=diagnosis.diagnosis_id, experiment_type="exhaust_fan_depressurization"
            ),
        )
        diagnosis = experiment.updated_diagnosis
        arc.append(diagnosis.status.value)
    leading = diagnosis.ranked_causes[0].fault_type.value if diagnosis.ranked_causes else None
    if diagnosis.status == DiagnosisStatus.CONFIDENT:
        await service.apply_repair(sid, RepairRequest(diagnosis_id=diagnosis.diagnosis_id))
    truth = await service.reveal(sid)
    service.discard(sid)
    return {
        "seed": seed,
        "arc": " > ".join(arc),
        "final_leading_cause": leading,
        "final_flagged_room": diagnosis.flagged_room_id,
        "diagnosis_matched": truth.diagnosis_matched,
        "repair_addressed_cause": truth.repair_addressed_cause,
    }


async def scan(seeds: int) -> dict:
    rows = [await investigate(seed) for seed in range(1, seeds + 1)]
    return {
        "title": "Guided scenario seed scan (TRAINING split; workflow illustration, not a benchmark)",
        "guided_fault": "draft in bedroom_1 (HH09 Bedroom), excess multiplier 2.0",
        "seeds": seeds,
        "arc_counts": dict(Counter(r["arc"] for r in rows)),
        "diagnosis_matched": sum(r["diagnosis_matched"] for r in rows),
        "full_correct_arc_seeds": [
            r["seed"] for r in rows if r["arc"] == "ambiguous > test > confident" and r["diagnosis_matched"]
        ],
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=int, default=120)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    result = asyncio.run(scan(args.seeds))
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "rows"}, indent=2))


if __name__ == "__main__":
    main()
