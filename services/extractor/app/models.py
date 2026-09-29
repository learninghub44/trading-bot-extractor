from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

@dataclass
class BotVariable:
    name: str
    value: Any = None

@dataclass
class BotBlock:
    type: str
    attributes: dict[str, Any] = field(default_factory=dict)
    children: list["BotBlock"] = field(default_factory=list)

@dataclass
class CanonicalBot:
    name: str = "trading-bot"
    description: str | None = None
    variables: list[BotVariable] = field(default_factory=list)
    blocks: list[BotBlock] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
