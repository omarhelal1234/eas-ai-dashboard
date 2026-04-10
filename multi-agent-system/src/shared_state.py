"""
Shared CR workspace: where artefacts live while a Change Request is in flight.

Every CR gets its own folder under docs/cr/<CR-ID>/ containing the draft BRD,
SOW, HLD, patch summary, QA report, test plan, bugs and run log. The registry
below is a light in-memory index so the supervisor can tell at a glance what
stage the CR is in and which agent last wrote to it.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

from .config import CR_WORKSPACE


class Stage(str, Enum):
    DRAFT_BRD = "DRAFT_BRD"
    SOW = "SOW"
    HLD = "HLD"
    DEV = "DEV"
    QA = "QA"
    TEST = "TEST"
    DONE = "DONE"
    BLOCKED = "BLOCKED"


@dataclass
class Artefact:
    agent: str
    path: str
    created_at: str
    note: str = ""


@dataclass
class CRWorkspace:
    cr_id: str
    title: str
    stage: Stage = Stage.DRAFT_BRD
    artefacts: list[Artefact] = field(default_factory=list)
    history: list[dict] = field(default_factory=list)

    @property
    def folder(self) -> Path:
        return CR_WORKSPACE / self.cr_id

    def ensure(self) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)

    def record(self, agent: str, filename: str, note: str = "") -> Path:
        """Register an artefact written by an agent and return its path."""
        self.ensure()
        path = self.folder / filename
        self.artefacts.append(
            Artefact(
                agent=agent,
                path=str(path),
                created_at=datetime.now(timezone.utc).isoformat(),
                note=note,
            )
        )
        return path

    def transition(self, to: Stage, by: str, reason: str) -> None:
        self.history.append(
            {
                "at": datetime.now(timezone.utc).isoformat(),
                "from": self.stage.value,
                "to": to.value,
                "by": by,
                "reason": reason,
            }
        )
        self.stage = to

    def dump_run_log(self) -> Path:
        self.ensure()
        log_path = self.folder / "RUN-LOG.md"
        lines = [f"# Run Log — {self.cr_id}: {self.title}", ""]
        lines.append(f"**Final stage:** `{self.stage.value}`")
        lines.append("")
        lines.append("## Transitions")
        for h in self.history:
            lines.append(
                f"- {h['at']} — **{h['by']}** moved `{h['from']}` → `{h['to']}` ({h['reason']})"
            )
        lines.append("")
        lines.append("## Artefacts")
        for a in self.artefacts:
            lines.append(f"- `{a.path}` — {a.agent} — {a.note}")
        log_path.write_text("\n".join(lines), encoding="utf-8")
        return log_path

    def to_json(self) -> str:
        return json.dumps(
            {
                "cr_id": self.cr_id,
                "title": self.title,
                "stage": self.stage.value,
                "artefacts": [asdict(a) for a in self.artefacts],
                "history": self.history,
            },
            indent=2,
        )


_SLUG_RE = re.compile(r"[^a-zA-Z0-9]+")


def make_cr_id(title: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d")
    slug = _SLUG_RE.sub("-", title.lower()).strip("-")[:40]
    return f"CR-{ts}-{slug}"
