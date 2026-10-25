"""House shapes a demo can be simulated on (integration layer).

* ``hh09``: the calibrated HH09 twin (``backend/simulation/physics.build_house``).
* presets: single-storey plans in ``shared/homes/presets/``.
* saved: plans a user drew and saved, as JSON files in ``var/plans`` (git-ignored).

A preset or saved shape is simulated by ``backend/simulation/plan_house.py`` and
monitored with an engine template transferred from the HH09 calibration
(``homes.build_home``), exactly like a real home.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from uuid import uuid4

from .contracts import HomePlan, HouseShape, HouseShapeCreate
from .homes import HomeError, plan_geometry
from .runtime import REPOSITORY_ROOT

HH09_SHAPE = "hh09"
HH09_PLAN_PATH = REPOSITORY_ROOT / "shared" / "homes" / "hh09_plan.json"
PRESETS_DIR = REPOSITORY_ROOT / "shared" / "homes" / "presets"
SAVED_DIR = Path(os.environ.get("HEATHUNTER_PLANS_DIR", REPOSITORY_ROOT / "var" / "plans"))
MAX_SIMULATED_ROOMS = 8  # keeps a simulated night quick enough to watch


def _shape(shape_id: str, kind: str, plan: HomePlan, name: str | None = None) -> HouseShape:
    return HouseShape(
        shape_id=shape_id,
        name=name or plan.name,
        kind=kind,
        sensed_rooms=sum(r.has_sensor for r in plan.rooms),
        plan=plan,
    )


def _twin() -> HouseShape:
    plan = HomePlan.model_validate_json(HH09_PLAN_PATH.read_text(encoding="utf-8"))
    # the twin simulates its four documented sensor rooms, whatever the drawing shows
    return _shape(HH09_SHAPE, "twin", plan, "HH09 bungalow (real UK home's twin)").model_copy(
        update={"sensed_rooms": 4}
    )


def _read(path: Path, kind: str) -> HouseShape:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if kind == "saved":
        return _shape(payload["shape_id"], kind, HomePlan.model_validate(payload["plan"]), payload["name"])
    plan = HomePlan.model_validate(payload)
    return _shape(plan.plan_id, kind, plan)


def list_shapes(saved_dir: Path | None = None) -> list[HouseShape]:
    saved_dir = saved_dir or SAVED_DIR
    presets = [_read(p, "preset") for p in sorted(PRESETS_DIR.glob("*.json"))]
    saved = [_read(p, "saved") for p in sorted(saved_dir.glob("plan-*.json"))] if saved_dir.is_dir() else []
    return [_twin(), *presets, *saved]


def get_shape(shape_id: str, saved_dir: Path | None = None) -> HouseShape:
    for shape in list_shapes(saved_dir):
        if shape.shape_id == shape_id:
            return shape
    raise KeyError(f"unknown house shape {shape_id!r}")


def check_simulable(plan: HomePlan) -> None:
    sensed = sum(r.has_sensor for r in plan.rooms)
    if not 1 <= sensed <= MAX_SIMULATED_ROOMS:
        raise HomeError(f"a simulated house needs 1 to {MAX_SIMULATED_ROOMS} rooms with sensors")
    exterior, _, _ = plan_geometry(plan)  # also rejects overlapping rooms
    if not any(exterior[r.room_id] > 0 for r in plan.rooms if r.has_sensor):
        raise HomeError("at least one sensed room needs an outside wall")


def save_shape(request: HouseShapeCreate, saved_dir: Path | None = None) -> HouseShape:
    saved_dir = saved_dir or SAVED_DIR
    check_simulable(request.plan)
    slug = re.sub(r"[^a-z0-9]+", "-", request.name.lower()).strip("-")[:24] or "house"
    shape_id = f"plan-{slug}-{uuid4().hex[:6]}"
    plan = request.plan.model_copy(update={"plan_id": shape_id, "name": request.name})
    saved_dir.mkdir(parents=True, exist_ok=True)
    payload = {"shape_id": shape_id, "name": request.name, "plan": plan.model_dump(mode="json")}
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=saved_dir, delete=False) as handle:
        json.dump(payload, handle)
        temporary = handle.name
    os.replace(temporary, saved_dir / f"{shape_id}.json")
    return _shape(shape_id, "saved", plan, request.name)


def delete_shape(shape_id: str, saved_dir: Path | None = None) -> None:
    saved_dir = saved_dir or SAVED_DIR
    shape = get_shape(shape_id, saved_dir)
    if shape.kind != "saved":
        raise HomeError("only saved shapes can be deleted")
    (saved_dir / f"{shape_id}.json").unlink(missing_ok=True)
