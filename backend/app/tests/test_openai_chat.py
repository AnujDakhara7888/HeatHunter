"""OpenAI chat contract, error handling and public-context boundary (no paid calls)."""

from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import httpx2
import openai
import pytest
from fastapi.testclient import TestClient

from backend.app import assistant
from backend.app.contracts import ChatMessage
from backend.app.main import app

REPLY = {"on_topic": True, "reply": "We need more nights before naming a cause.", "actions": []}


@pytest.fixture(autouse=True)
def isolated_config(monkeypatch, tmp_path):
    monkeypatch.setattr(assistant, "ENV_FILE", tmp_path / "missing.env")
    monkeypatch.setenv("HEATHUNTER_CHAT_PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("HEATHUNTER_OPENAI_MODEL", raising=False)


def fake_provider(monkeypatch, *, data=REPLY, status="completed", error=None, raw=None):
    seen = {}

    def create(**kwargs):
        seen["request"] = kwargs
        if error:
            raise error
        return SimpleNamespace(
            status=status, output_text=raw if raw is not None else json.dumps(data), model="test-openai"
        )

    class Client:
        def __init__(self, **kwargs):
            seen["client"] = kwargs
            self.responses = SimpleNamespace(create=create)

        def __enter__(self):
            return self

        def __exit__(self, *_):
            seen["closed"] = True

    monkeypatch.setattr(openai, "OpenAI", Client)
    monkeypatch.setenv("OPENAI_API_KEY", "test-credential-do-not-return")
    return seen


def ask(client, home=None):
    if home is None:
        response = client.post("/api/demo/homes", json={"seed": 31337})
        assert response.status_code == 201, response.text
        home = response.json()["home_id"]
    return client.post(
        f"/api/homes/{home}/assistant",
        json={"messages": [{"role": "user", "content": "How is this house doing?"}]},
    )


def test_openai_success_uses_server_context_without_truth(monkeypatch):
    seen = fake_provider(monkeypatch)
    response = ask(TestClient(app))
    assert response.status_code == 200, response.text
    assert response.json() == {"reply": REPLY["reply"], "actions": [], "model": "test-openai"}
    assert "test-credential" not in response.text
    request = seen["request"]
    assert request["store"] is False and request["max_output_tokens"] == 1200
    assert request["text"]["format"]["strict"] is True
    assert request["model"] == "gpt-5-nano"
    assert request["reasoning"] == {"effort": "minimal"}
    assert "Project guide:" in request["instructions"]
    assert "no live physical" in request["instructions"]
    content = request["input"][-1]["content"]
    assert '"hidden_answer": "not revealed"' in content
    assert "severity" not in content and "sensor_seed" not in content
    assert seen["closed"] is True


def test_general_help_reaches_ai_without_creating_or_selecting_home(monkeypatch):
    from backend.app import main

    seen = fake_provider(monkeypatch, data={**REPLY, "reply": "Hi! Open Fault Lab to start a demo."})

    def forbidden():
        pytest.fail("general help must not access a home or simulator")

    monkeypatch.setattr(main, "_homes", forbidden)
    response = TestClient(app).post(
        "/api/assistant/help", json={"messages": [{"role": "user", "content": "hey"}]}
    )
    assert response.status_code == 200, response.text
    assert response.json()["reply"].startswith("Hi!")
    assert '"status": "no_home_selected"' in seen["request"]["input"][-1]["content"]


def test_general_help_does_not_accept_client_scientific_context(monkeypatch):
    fake_provider(monkeypatch)
    response = TestClient(app).post("/api/assistant/help", json={
        "messages": [{"role": "user", "content": "Explain this"}],
        "context": {"hidden_answer": {"fault_type": "draft"}},
    })
    assert response.status_code == 422


def test_missing_home_returns_404_without_calling_ai(monkeypatch):
    seen = fake_provider(monkeypatch)
    assert ask(TestClient(app), home="expired-demo-id").status_code == 404
    assert "request" not in seen


@pytest.mark.parametrize("page", ["overview", "fault_lab", "real_home", "your_home"])
def test_current_page_and_view_reach_ai(monkeypatch, page):
    seen = fake_provider(monkeypatch)
    response = TestClient(app).post("/api/assistant/help", json={
        "messages": [{"role": "user", "content": "Explain this screen"}],
        "screen": {"page": page, "view": "thermal", "infrared": True},
    })
    assert response.status_code == 200, response.text
    prompt = seen["request"]["input"][-1]["content"]
    assert f'"page": "{page}"' in prompt
    assert "not a thermal-camera measurement" in prompt
    if page == "real_home":
        assert '"real_measurements"' in prompt and '"reading_count"' in prompt
        assert "not monitored for faults" in prompt
        payload = json.loads(prompt.split("<home>", 1)[1].split("</home>", 1)[0])
        assert "Next night" not in payload["screen_context"]["available_controls"]


def test_selected_room_uses_server_report_and_cannot_supply_its_own(monkeypatch):
    seen = fake_provider(monkeypatch)
    client = TestClient(app)
    home = client.post("/api/demo/homes", json={"seed": 21}).json()["home_id"]
    response = client.post(f"/api/homes/{home}/assistant", json={
        "messages": [{"role": "user", "content": "Explain the room I selected"}],
        "screen": {"page": "fault_lab", "selected_room_id": "kitchen", "view": "inside"},
    })
    assert response.status_code == 200, response.text
    prompt = seen["request"]["input"][-1]["content"]
    payload = json.loads(prompt.split("<home>", 1)[1].split("</home>", 1)[0])
    assert payload["selected_room"]["room_id"] == "kitchen"
    assert payload["selected_room"]["status"] == "not_enough_data"
    assert payload["hidden_answer"] == "not revealed"
    response = client.post("/api/assistant/help", json={
        "messages": [{"role": "user", "content": "Explain"}],
        "screen": {"page": "fault_lab", "diagnosis": "confirmed draft"},
    })
    assert response.status_code == 422


def test_real_page_summaries_match_the_selected_night(monkeypatch):
    seen = fake_provider(monkeypatch)
    response = TestClient(app).post("/api/assistant/help", json={
        "messages": [{"role": "user", "content": "Explain these readings"}],
        "screen": {"page": "real_home", "window_start": "2021-02-18T22:00:00Z",
                   "window_end": "2021-02-19T06:00:00Z"},
    })
    assert response.status_code == 200, response.text
    prompt = seen["request"]["input"][-1]["content"]
    payload = json.loads(prompt.split("<home>", 1)[1].split("</home>", 1)[0])
    measured = payload["screen_context"]["real_measurements"]
    assert measured["house_id"] == "smeter-hh09"
    assert all(r["reading_count"] == 17 for r in measured["rooms"].values())
    assert "not the current playback instant" in measured["note"]


@pytest.mark.parametrize("screen", [
    {"page": "unknown"},
    {"page": "real_home", "window_start": "2020-01-01T22:00:00Z", "window_end": "2020-01-02T06:00:00Z"},
    {"page": "real_home", "window_start": "2021-02-18T22:00:00"},
    {"page": "real_home", "window_start": "2021-02-18T22:00:00", "window_end": "2021-02-19T06:00:00"},
])
def test_invalid_screen_state_is_rejected_before_ai(monkeypatch, screen):
    seen = fake_provider(monkeypatch)
    response = TestClient(app).post("/api/assistant/help", json={
        "messages": [{"role": "user", "content": "Explain"}], "screen": screen,
    })
    assert response.status_code == 422
    assert "request" not in seen


def test_real_sdk_serializes_the_responses_request(monkeypatch):
    seen = {}
    original = openai.OpenAI

    def transport(request):
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx2.Response(200, json={
            "id": "resp_test", "object": "response", "created_at": 0,
            "status": "completed", "model": "test-openai",
            "output": [{"id": "msg_test", "type": "message", "role": "assistant",
                        "status": "completed", "content": [
                            {"type": "output_text", "text": json.dumps(REPLY), "annotations": []}
                        ]}],
        })

    monkeypatch.setenv("OPENAI_API_KEY", "sdk-transport-test")
    monkeypatch.setattr(openai, "OpenAI", lambda **kwargs: original(
        **kwargs, http_client=httpx2.Client(transport=httpx2.MockTransport(transport))
    ))
    result = ask(TestClient(app))
    assert result.status_code == 200, result.text
    assert result.json()["reply"] == REPLY["reply"]
    assert seen["url"] == "https://api.openai.com/v1/responses"
    assert seen["body"]["store"] is False
    assert seen["body"]["text"]["format"]["schema"] == assistant.CHAT_SCHEMA


def test_key_and_model_can_be_loaded_from_private_env_file(monkeypatch, tmp_path):
    seen = fake_provider(monkeypatch)
    monkeypatch.delenv("OPENAI_API_KEY")
    env = tmp_path / ".env"
    env.write_text("OPENAI_API_KEY='private-file-test'\nHEATHUNTER_OPENAI_MODEL=my-selected-model\n")
    monkeypatch.setattr(assistant, "ENV_FILE", env)
    monkeypatch.setenv("HEATHUNTER_OPENAI_MODEL", "shell-model-wins")
    response = ask(TestClient(app))
    assert response.status_code == 200
    assert seen["client"]["api_key"] == "private-file-test"
    assert seen["request"]["model"] == "shell-model-wins"


def test_missing_key_is_explicit_and_does_not_call_provider(monkeypatch):
    def forbidden(**_):
        pytest.fail("provider must not be called without a key")

    monkeypatch.setattr(openai, "OpenAI", forbidden)
    response = ask(TestClient(app))
    assert response.status_code == 503
    assert response.json()["code"] == "ASSISTANT_UNAVAILABLE"
    assert "OPENAI_API_KEY" in response.json()["detail"]


@pytest.mark.parametrize("status", [401, 403, 404, 429, 500])
def test_provider_status_errors_are_safe_503s(monkeypatch, status):
    request = httpx.Request("POST", "https://api.openai.com/v1/responses")
    response = httpx.Response(status, request=request)
    error_type = {401: openai.AuthenticationError, 429: openai.RateLimitError}.get(
        status, openai.APIStatusError
    )
    error = error_type("secret-provider-body", response=response, body={"private": "test-credential"})
    fake_provider(monkeypatch, error=error)
    result = ask(TestClient(app))
    assert result.status_code == 503
    assert result.json()["code"] == "ASSISTANT_UNAVAILABLE"
    assert "secret-provider-body" not in result.text and "test-credential" not in result.text


@pytest.mark.parametrize("error_type", [openai.APITimeoutError, openai.APIConnectionError])
def test_connection_errors_are_safe_503s(monkeypatch, error_type):
    fake_provider(monkeypatch, error=error_type(request=httpx.Request("POST", "https://api.openai.com")))
    assert ask(TestClient(app)).status_code == 503


@pytest.mark.parametrize("status,raw", [("incomplete", "{}"), ("completed", ""), ("completed", "bad json")])
def test_incomplete_or_unreadable_replies_are_rejected(monkeypatch, status, raw):
    fake_provider(monkeypatch, status=status, raw=raw)
    assert ask(TestClient(app)).status_code == 503


@pytest.mark.parametrize("data", [[], {"on_topic": "false", "reply": "x", "actions": []},
                                  {"on_topic": True, "reply": None, "actions": []}])
def test_schema_invalid_replies_do_not_crash_api(monkeypatch, data):
    fake_provider(monkeypatch, data=data)
    assert ask(TestClient(app)).status_code == 503


def test_off_topic_text_and_unknown_room_actions_are_filtered(monkeypatch):
    fake_provider(monkeypatch, data={"on_topic": False, "reply": "off topic", "actions": []})
    assert ask(TestClient(app)).json()["reply"] == assistant.OFF_TOPIC_REPLY
    fake_provider(monkeypatch, data={**REPLY, "actions": [
        {"type": "focus_room", "target": "nonexistent-room"},
        {"type": "focus_room", "target": "kitchen"},
        {"type": "set_view", "target": "fan"},
    ]})
    response = ask(TestClient(app))
    assert response.json()["actions"] == [{"type": "focus_room", "target": "kitchen"}]


def test_invalid_provider_is_an_explicit_error(monkeypatch):
    monkeypatch.setenv("HEATHUNTER_CHAT_PROVIDER", "typo")
    assert ask(TestClient(app)).status_code == 503


def test_hidden_truth_is_available_only_after_reveal(monkeypatch):
    seen = fake_provider(monkeypatch)
    context = {"home": {"rooms": []}, "hidden_answer": "not revealed"}
    assistant.home_chat([ChatMessage(role="user", content="What is the hidden fault?")], context)
    assert '"hidden_answer": "not revealed"' in seen["request"]["input"][-1]["content"]
    # This context represents the public reveal already performed by the caller, not a truth-store read.
    context["hidden_answer"] = {"fault_type": "draft", "room_id": "kitchen"}
    assistant.home_chat([ChatMessage(role="user", content="Explain the revealed answer")], context)
    assert '"fault_type": "draft"' in seen["request"]["input"][-1]["content"]
