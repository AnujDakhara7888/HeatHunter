"""On-site assistant: Claude, restricted to questions about HeatHunter.

Guardrails, in layers:

1. Scope: the system prompt limits answers to HeatHunter, the visitor's check
   and home heat loss as the site covers it; anything else is declined.
2. Hard limits enforced here, not by the model: message size, conversation
   length, per-visitor and whole-site rate limits, short answers, text only.
3. No hidden answers: the assistant only receives public facts and the
   visitor's on-screen summary. It never sees simulator truth.
4. Optional by design: without credentials or network the endpoint returns
   503, and the rest of the site (and the offline demo) is unaffected.
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .contracts import ChatRequest, ChatResponse

# Kept in a text file so the rules can be edited without touching code.
SYSTEM_PROMPT = (Path(__file__).with_name("chat_system_prompt.md")).read_text(encoding="utf-8").strip()

OFF_TOPIC_REFUSAL = (
    "Sorry, I can't help with that. I can answer questions about HeatHunter and your home check — "
    "for example, what a draft is or why a room was flagged."
)


class ChatUnavailableError(RuntimeError):
    """The assistant cannot run here (no credentials, SDK or network)."""


class ChatRateLimitedError(RuntimeError):
    """A visitor or the whole site has used up its chat allowance."""


class ChatRequestError(ValueError):
    """The conversation breaks the input limits."""


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class ChatSettings:
    model: str = "claude-opus-5-5"
    max_user_chars: int = 600
    max_turns: int = 12
    max_tokens: int = 700
    per_visitor_limit: int = 15
    per_visitor_window_s: int = 600
    daily_limit: int = 300
    timeout_s: float = 45.0

    @classmethod
    def from_env(cls) -> ChatSettings:
        return cls(
            model=os.environ.get("HEATHUNTER_CHAT_MODEL", cls.model),
            per_visitor_limit=_env_int("HEATHUNTER_CHAT_PER_VISITOR", cls.per_visitor_limit),
            per_visitor_window_s=_env_int("HEATHUNTER_CHAT_WINDOW_SECONDS", cls.per_visitor_window_s),
            daily_limit=_env_int("HEATHUNTER_CHAT_DAILY_LIMIT", cls.daily_limit),
        )


class RateLimiter:
    """In-memory sliding window per visitor plus a whole-site daily cap."""

    def __init__(self, per_visitor: int, window_s: int, daily: int) -> None:
        self.per_visitor, self.window_s, self.daily = per_visitor, window_s, daily
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._day = time.strftime("%Y-%m-%d", time.gmtime())
        self._today = 0
        self._lock = threading.Lock()

    def check(self, visitor: str, now: float | None = None) -> None:
        now = time.time() if now is None else now
        with self._lock:
            day = time.strftime("%Y-%m-%d", time.gmtime(now))
            if day != self._day:
                self._day, self._today = day, 0
            if self._today >= self.daily:
                raise ChatRateLimitedError(
                    "The assistant has reached its limit for today. Please try again tomorrow."
                )
            hits = self._hits[visitor]
            while hits and now - hits[0] > self.window_s:
                hits.popleft()
            if len(hits) >= self.per_visitor:
                wait = int(self.window_s - (now - hits[0])) + 1
                raise ChatRateLimitedError(
                    f"You've sent a lot of messages. Please wait about {max(1, wait // 60)} minute(s)."
                )
            hits.append(now)
            self._today += 1


def _has_credentials() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


class ChatService:
    def __init__(self, settings: ChatSettings | None = None, client: Any | None = None) -> None:
        self.settings = settings or ChatSettings.from_env()
        self.limiter = RateLimiter(
            self.settings.per_visitor_limit, self.settings.per_visitor_window_s, self.settings.daily_limit
        )
        self._client = client

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        if not _has_credentials():
            raise ChatUnavailableError("The assistant isn't set up on this server (no API key).")
        try:
            import anthropic
        except ImportError as exc:  # pragma: no cover - dependency is declared
            raise ChatUnavailableError("The assistant isn't installed on this server.") from exc
        self._client = anthropic.Anthropic(timeout=self.settings.timeout_s, max_retries=1)
        return self._client

    def _messages(self, request: ChatRequest) -> list[dict[str, Any]]:
        turns = request.messages[-self.settings.max_turns :]
        if turns[0].role != "user":
            turns = turns[1:]
        if not turns or turns[-1].role != "user":
            raise ChatRequestError("The last message must come from the visitor.")
        for a, b in zip(turns, turns[1:], strict=False):
            if a.role == b.role:
                raise ChatRequestError("Messages must alternate between visitor and assistant.")
        latest = turns[-1].content.strip()
        if not latest:
            raise ChatRequestError("Please type a question.")
        if len(latest) > self.settings.max_user_chars:
            raise ChatRequestError(f"Please keep questions under {self.settings.max_user_chars} characters.")
        messages = [{"role": t.role, "content": t.content[:4000]} for t in turns[:-1]]
        content: list[dict[str, str]] = []
        if request.page_context:
            content.append(
                {
                    "type": "text",
                    "text": "<page_summary>\n" + request.page_context.strip()[:4000] + "\n</page_summary>",
                }
            )
        content.append({"type": "text", "text": latest})
        messages.append({"role": "user", "content": content})
        return messages

    def reply(self, request: ChatRequest, visitor: str) -> ChatResponse:
        messages = self._messages(request)
        client = self._get_client()
        self.limiter.check(visitor)
        import anthropic

        try:
            response = client.beta.messages.create(
                model=self.settings.model,
                max_tokens=self.settings.max_tokens,
                system=SYSTEM_PROMPT,
                messages=messages,
                output_config={"effort": "low"},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as exc:
            raise ChatUnavailableError("The assistant's API key was rejected.") from exc
        except anthropic.RateLimitError as exc:
            raise ChatRateLimitedError(
                "The assistant is busy right now. Please try again in a minute."
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise ChatUnavailableError("The assistant can't reach the internet right now.") from exc
        except anthropic.APIStatusError as exc:
            raise ChatUnavailableError("The assistant had a problem answering. Please try again.") from exc

        if response.stop_reason == "refusal":
            return ChatResponse(reply=OFF_TOPIC_REFUSAL, model=response.model)
        text = "\n\n".join(block.text for block in response.content if block.type == "text").strip()
        if not text:
            text = "Sorry, I couldn't put an answer together. Could you rephrase your question?"
        return ChatResponse(reply=text, model=response.model)


_service: ChatService | None = None
_service_lock = threading.Lock()


def get_chat_service() -> ChatService:
    global _service
    with _service_lock:
        if _service is None:
            _service = ChatService()
        return _service


def set_chat_service(service: ChatService | None) -> None:
    """Testing hook."""

    global _service
    with _service_lock:
        _service = service
