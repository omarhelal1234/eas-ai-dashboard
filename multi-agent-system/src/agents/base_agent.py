"""
BaseAgent — thin wrapper around the Claude Agent SDK.

All seven agents inherit from this class. The base handles:
- Client creation with the correct model / system prompt / tool allow-list
- A `run(task)` method that streams a single turn and returns the final text
- Uniform result payload the Supervisor can reason over

The SDK import is done lazily so that the unit tests and design-doc
generation don't require `ANTHROPIC_API_KEY` or the SDK to be installed.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

from ..config import AgentSpec


@dataclass
class AgentResult:
    agent: str
    ok: bool
    summary: str
    artefacts: list[str] = field(default_factory=list)
    raw: Any = None


class BaseAgent:
    def __init__(self, spec: AgentSpec, cwd: str | None = None) -> None:
        self.spec = spec
        self.cwd = cwd or os.getcwd()

    # ------------------------------------------------------------------
    # SDK integration
    # ------------------------------------------------------------------
    def _make_client(self):
        """Create the Claude Agent SDK client.

        Imported lazily so this module is safe to import without the SDK.
        """
        try:
            from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "claude-agent-sdk is not installed. Run `pip install claude-agent-sdk`."
            ) from exc

        options = ClaudeAgentOptions(
            model=self.spec.model,
            system_prompt=self.spec.system_prompt,
            allowed_tools=list(self.spec.allowed_tools),
            cwd=self.cwd,
            permission_mode="acceptEdits",
        )
        return ClaudeSDKClient(options=options)

    async def run(self, task: str) -> AgentResult:
        """Run a single task. Returns a structured AgentResult."""
        client = self._make_client()
        transcript: list[str] = []
        try:
            async with client:
                await client.query(task)
                async for msg in client.receive_response():
                    # The SDK emits AssistantMessage / ToolResultBlock / etc.
                    text = getattr(msg, "text", None)
                    if text:
                        transcript.append(text)
        except Exception as exc:  # pragma: no cover
            return AgentResult(
                agent=self.spec.name,
                ok=False,
                summary=f"Agent {self.spec.name} crashed: {exc}",
            )

        summary = "\n".join(transcript).strip() or "(no textual output)"
        return AgentResult(
            agent=self.spec.name,
            ok=True,
            summary=summary,
            raw=transcript,
        )

    # ------------------------------------------------------------------
    # Hook points — individual agents override these
    # ------------------------------------------------------------------
    def build_task(self, **kwargs: Any) -> str:
        """Each subclass constructs the user-turn prompt from workspace state."""
        raise NotImplementedError
