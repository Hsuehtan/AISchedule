"""Keep ordinary Python tests isolated from live model providers."""

from pydantic_ai import models

models.ALLOW_MODEL_REQUESTS = False
