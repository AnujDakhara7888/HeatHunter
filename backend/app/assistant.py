"""Claude-backed assistant: plain-language chat and floor-plan reading (Nikhil).

The chat sees only what the UI has already shown the user (the ``context``
object it sends). The API layer never adds simulator truth to it. Replies use
structured output so the UI can also move the 3D camera.
"""

from __future__ import annotations

import base64
import json
import os
import re

from .contracts import ChatAction, ChatReply, ChatRequest, FloorPlanDraft, HomePlan

MODEL = os.environ.get("HEATHUNTER_ASSISTANT_MODEL", "claude-opus-5-5")
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AssistantUnavailable(RuntimeError):
    """No Anthropic credentials or SDK; the UI falls back to offline answers."""


def _client():
    try:
        import anthropic
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise AssistantUnavailable("the anthropic package is not installed") from exc
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        raise AssistantUnavailable("set ANTHROPIC_API_KEY to enable the assistant")
    return anthropic.Anthropic(timeout=60.0, max_retries=1)


def _create(**kwargs):
    import anthropic

    client = _client()
    try:
        response = client.beta.messages.create(
            model=MODEL, betas=[FALLBACK_BETA], fallbacks="default", **kwargs
        )
    except anthropic.APIConnectionError as exc:
        raise AssistantUnavailable("could not reach the Claude API") from exc
    except anthropic.AuthenticationError as exc:
        raise AssistantUnavailable("the Claude API key was rejected") from exc
    if response.stop_reason == "refusal":
        raise AssistantUnavailable("the assistant declined this request")
    text = "".join(block.text for block in response.content if block.type == "text")
    return json.loads(text), response.model


CHAT_SYSTEM = """You are HeatHunter's guide inside a 3D home-heat-loss app.
HeatHunter fits three explanations to how each room cools overnight with the heating off:
normal behaviour, an air leak (draft), or weak insulation (envelope conduction). It compares them by
fit quality (BIC; lower is better, a gap above ~10 is a strong preference) and, when two explanations
tie, recommends a controlled exhaust-fan test: a fan depressurises the house, which speeds cooling
a lot if the room leaks air but barely changes cooling through walls.

Rules:
- Answer in plain, friendly language for a homeowner. 1-4 short sentences. No markdown headings.
- Use ONLY numbers present in the context. Never invent measurements, prices or results.
- Fault Lab results are on a simulated twin of a real UK home (HH09); never claim the real house has a fault.
- Money figures are screening estimates with stated assumptions, not quotes.
- If the hidden answer has not been revealed in the context, you do not know it; say so if asked.
- When it helps, add actions to steer the 3D view: focus_room (target = a room_id from the context),
  set_view (target = exterior | thermal | open | inside | fan), set_time (target = ISO time in the night).
"""

CHAT_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "actions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["focus_room", "set_view", "set_time"]},
                    "target": {"type": "string"},
                },
                "required": ["type", "target"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["reply", "actions"],
    "additionalProperties": False,
}


def chat(request: ChatRequest) -> ChatReply:
    context = json.dumps(request.context, default=str, sort_keys=True)[:60000]
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    messages[-1] = {
        "role": "user",
        "content": f"<app_state>{context}</app_state>\n\n{messages[-1]['content']}",
    }
    data, model = _create(
        max_tokens=2000,
        system=CHAT_SYSTEM,
        messages=messages,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": CHAT_SCHEMA}},
    )
    actions = [ChatAction.model_validate(a) for a in data.get("actions", [])[:3]]
    return ChatReply(reply=data["reply"], actions=actions, model=model)


PLAN_PROMPT = """Read this floor plan and return its rooms as axis-aligned rectangles in metres.
Use printed dimensions when present (e.g. "3.11 x 3.80"). x grows to the right, z grows downward,
the top-left outer corner of the building is (0, 0). Rooms must tile the plan without overlapping;
snap shared walls to identical coordinates. Approximate L-shaped rooms by their largest rectangle.
Use short snake_case room_id values (living_room, kitchen, bedroom_1, hall, bathroom, ...).
Set has_sensor false for cupboards/closets under 1.5 m2. Add windows and external doors on outer walls,
and internal doors between rooms, as segments (x0,z0)-(x1,z1) lying on the wall line.
Put any uncertainty (missing scale, guessed sizes) in notes."""

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "rooms": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "room_id": {"type": "string"},
                    "name": {"type": "string"},
                    "x": {"type": "number"},
                    "z": {"type": "number"},
                    "width": {"type": "number"},
                    "depth": {"type": "number"},
                    "has_sensor": {"type": "boolean"},
                },
                "required": ["room_id", "name", "x", "z", "width", "depth", "has_sensor"],
                "additionalProperties": False,
            },
        },
        "openings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["window", "door"]},
                    "x0": {"type": "number"},
                    "z0": {"type": "number"},
                    "x1": {"type": "number"},
                    "z1": {"type": "number"},
                },
                "required": ["kind", "x0", "z0", "x1", "z1"],
                "additionalProperties": False,
            },
        },
        "notes": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["name", "rooms", "openings", "notes"],
    "additionalProperties": False,
}

IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


def read_floor_plan(content: bytes, media_type: str) -> FloorPlanDraft:
    if media_type == "application/pdf":
        block = {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": base64.standard_b64encode(content).decode(),
            },
        }
    elif media_type in IMAGE_TYPES:
        block = {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": base64.standard_b64encode(content).decode(),
            },
        }
    else:
        raise ValueError("upload a PNG, JPEG, WebP or PDF floor plan")
    data, model = _create(
        max_tokens=16000,
        messages=[{"role": "user", "content": [block, {"type": "text", "text": PLAN_PROMPT}]}],
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": PLAN_SCHEMA}},
    )
    seen: set[str] = set()
    rooms = []
    for room in data["rooms"][:16]:
        rid = re.sub(r"[^a-z0-9_]", "_", room["room_id"].lower())[:40] or "room"
        while rid in seen:
            rid = f"{rid[:36]}_{len(seen)}"
        seen.add(rid)
        if room["width"] <= 0 or room["depth"] <= 0:
            continue
        rooms.append({**room, "room_id": rid, "name": room["name"][:60] or rid})
    if not rooms:
        raise ValueError("no rooms could be read from this plan")
    plan = HomePlan(
        plan_id="upload",
        name=(data.get("name") or "My home")[:80],
        rooms=rooms,
        openings=data.get("openings", [])[:60],
    )
    return FloorPlanDraft(plan=plan, notes=data.get("notes", [])[:8], model=model)
