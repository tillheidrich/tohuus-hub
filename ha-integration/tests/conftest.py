"""Fixtures: a fake ToHuus Hub served through aioclient_mock."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from homeassistant.const import CONF_TOKEN, CONF_URL, CONF_VERIFY_SSL
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.tohuus_hub.const import CONF_LIVE_UPDATES, DOMAIN

URL = "http://tohuus.local:8080"
API = f"{URL}/api/ha/v1"
FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Load custom_components/ in every test."""
    return


@pytest.fixture
def state() -> dict[str, Any]:
    return load("state.json")


@pytest.fixture
def mock_api(aioclient_mock: AiohttpClientMocker, state: dict[str, Any]) -> AiohttpClientMocker:
    aioclient_mock.get(f"{API}/info", json=load("info.json"))
    aioclient_mock.get(f"{API}/state", json=state)
    aioclient_mock.get(f"{API}/calendar/meals", json={"events": [{"uid": "meal-1", "date": "2026-10-10", "summary": "Lasagne", "description": "Dinner"}]})
    aioclient_mock.get(f"{API}/calendar/care", json={"events": []})
    # two-way bridge: nothing to watch, nothing to do (tests/test_bridge.py covers it)
    aioclient_mock.post(f"{API}/bridge/sync", json={"config": {"todo": [], "calendar": [], "persons": False, "tags": True, "want_capabilities": False}, "ops": []})
    return aioclient_mock


@pytest.fixture
def entry() -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        title="Test home",
        unique_id="test-instance",
        data={CONF_URL: URL, CONF_TOKEN: "sw_test", CONF_VERIFY_SSL: True},
        # the event stream is tested separately; keep setups deterministic
        options={CONF_LIVE_UPDATES: False},
    )
