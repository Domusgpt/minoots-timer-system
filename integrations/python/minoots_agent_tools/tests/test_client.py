import pathlib
import sys
import types
import unittest
from typing import Any, Dict

PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

try:
    import httpx  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - fallback for test environment
    stub = types.SimpleNamespace()

    class _Client:  # minimal shim used by MinootsClient
        def __init__(self, *args, **kwargs) -> None:  # noqa: D401 - simple shim
            self.args = args
            self.kwargs = kwargs

        def post(self, *args, **kwargs):  # pragma: no cover - not exercised
            raise NotImplementedError

    class _AsyncClient(_Client):
        async def __aenter__(self):  # pragma: no cover - not exercised
            return self

        async def __aexit__(self, exc_type, exc, tb):  # pragma: no cover - not exercised
            return False

        async def post(self, *args, **kwargs):  # pragma: no cover - not exercised
            raise NotImplementedError

    stub.Client = _Client
    stub.AsyncClient = _AsyncClient
    sys.modules["httpx"] = stub

from minoots_agent_tools.client import MinootsClient, REGION_LABEL_KEY


class _StubResponse:
    def __init__(self, *, status_code: int, json_payload: Dict[str, Any]):
        self.status_code = status_code
        self._json_payload = json_payload

    def raise_for_status(self) -> None:
        if not 200 <= self.status_code < 300:
            raise RuntimeError(f"status {self.status_code}")

    def json(self) -> Dict[str, Any]:
        return self._json_payload


class _StubClient:
    def __init__(self) -> None:
        self.last_request = None

    def post(self, url: str, *, json: Dict[str, Any], headers: Dict[str, str], timeout: float) -> _StubResponse:  # type: ignore[override]
        self.last_request = {
            "url": url,
            "json": json,
            "headers": headers,
            "timeout": timeout,
        }
        return _StubResponse(status_code=200, json_payload={"ok": True, "json": json})


class MinootsClientTest(unittest.TestCase):
    def setUp(self) -> None:
        self.stub_sync = _StubClient()
        self.client = MinootsClient(
            base_url="https://api.minoots.test",
            api_key="test-key",
            tenant_id="tenant-123",
            default_region="us-west1",
            sync_client=self.stub_sync,
        )

    def test_build_payload_requires_duration_or_fire_at(self) -> None:
        with self.assertRaises(ValueError):
            self.client._build_payload(  # type: ignore[attr-defined]
                name="missing",
                requested_by=None,
                duration=None,
                fire_at=None,
                metadata=None,
                labels=None,
                action_bundle=None,
                agent_binding=None,
                region=None,
            )

    def test_region_header_and_label_propagate(self) -> None:
        payload, header_region = self.client._build_payload(  # type: ignore[attr-defined]
            name="demo",
            requested_by=None,
            duration="5m",
            fire_at=None,
            metadata=None,
            labels={"foo": "bar"},
            action_bundle=None,
            agent_binding=None,
            region="europe-west1",
        )

        self.assertEqual(header_region, "europe-west1")
        self.assertEqual(payload["labels"][REGION_LABEL_KEY], "europe-west1")
        self.assertEqual(payload["labels"]["foo"], "bar")

    def test_schedule_timer_uses_stub_client(self) -> None:
        result = self.client.schedule_timer(
            name="demo",
            duration=30,
            metadata={"source": "unit-test"},
            labels={"priority": "p0"},
            region="asia-east1",
            ecosystem={"parserator": {"datasetId": "ds-42"}},
        )

        self.assertTrue(result["ok"])
        self.assertEqual(self.stub_sync.last_request["url"], "https://api.minoots.test/timers")
        headers = self.stub_sync.last_request["headers"]
        self.assertEqual(headers["x-api-key"], "test-key")
        self.assertEqual(headers["x-minoots-region"], "asia-east1")
        payload = self.stub_sync.last_request["json"]
        self.assertEqual(payload["labels"][REGION_LABEL_KEY], "asia-east1")
        self.assertEqual(payload["labels"]["priority"], "p0")
        self.assertEqual(payload["tenantId"], "tenant-123")
        self.assertEqual(payload["requestedBy"], "agent:minoots")
        self.assertEqual(payload["ecosystem"]["parserator"]["datasetId"], "ds-42")


if __name__ == "__main__":
    unittest.main()
