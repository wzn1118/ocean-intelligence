import sys
from pathlib import Path

from fastapi.testclient import TestClient


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import main


def test_local_production_keeps_http_usable(monkeypatch) -> None:
    monkeypatch.setattr(main, "IS_PRODUCTION", True)
    monkeypatch.setattr(main, "IS_LOCAL_ONLY", True)
    with TestClient(main.app, base_url="http://127.0.0.1:8000") as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert "strict-transport-security" not in response.headers
    assert "upgrade-insecure-requests" not in response.headers["content-security-policy"]


def test_public_production_retains_https_headers(monkeypatch) -> None:
    monkeypatch.setattr(main, "IS_PRODUCTION", True)
    monkeypatch.setattr(main, "IS_LOCAL_ONLY", False)
    with TestClient(main.app, base_url="https://127.0.0.1:8000") as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.headers["strict-transport-security"].startswith("max-age=")
    assert "upgrade-insecure-requests" in response.headers["content-security-policy"]
