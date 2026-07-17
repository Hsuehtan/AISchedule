from __future__ import annotations

from agent_service.app import create_app
from agent_service.config import Settings

app = create_app(Settings.from_environment())
