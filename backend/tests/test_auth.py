import socket
from pathlib import Path
from urllib.error import HTTPError

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth import (
    AuthService,
    _fetch_provider_models,
    _provider_model_ids,
    install_auth,
    validate_provider_url,
)
from app.models import ProviderConnectionTestResult


@pytest.fixture(autouse=True)
def generous_test_rate_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_REGISTER_ATTEMPTS", "1000")
    monkeypatch.setenv("AUTH_LOGIN_ATTEMPTS", "1000")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.setattr("app.auth._Argon2PasswordHasher.memory_cost", 8 * 1024)
    monkeypatch.setattr("app.auth._Argon2PasswordHasher.iterations", 1)
    monkeypatch.setattr("app.auth._Argon2PasswordHasher.lanes", 1)


def _build_app(
    database_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    auth_required: bool = False,
) -> tuple[FastAPI, AuthService]:
    if auth_required:
        monkeypatch.setenv("AUTH_REQUIRED", "true")
    else:
        monkeypatch.delenv("AUTH_REQUIRED", raising=False)
    service = AuthService(
        f"sqlite:///{database_path.as_posix()}",
        encryption_key=Fernet.generate_key().decode("ascii"),
        cookie_secure=False,
    )
    app = FastAPI()

    @app.get("/api/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/api/private")
    def private_read() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/api/private-write")
    def private_write() -> dict[str, bool]:
        return {"ok": True}

    install_auth(app, service=service)
    return app, service


def _register(client: TestClient, email: str) -> dict[str, object]:
    response = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "correct horse battery staple",
            "display_name": "Test User",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _public_dns(*args: object, **kwargs: object) -> list[tuple[object, ...]]:
    del kwargs
    port = args[1] if len(args) > 1 else 443
    return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", port))]


def test_register_session_login_and_logout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app, service = _build_app(tmp_path / "auth.sqlite3", monkeypatch)
    with TestClient(app) as client:
        registered = _register(client, "Person@Example.com")
        assert registered["user"]["email"] == "person@example.com"
        set_cookie = client.post(
            "/api/auth/login",
            json={"email": "person@example.com", "password": "wrong password"},
        )
        assert set_cookie.status_code == 401

        session_response = client.get("/api/auth/session")
        assert session_response.status_code == 200
        session = session_response.json()
        assert session["user"]["id"] == registered["user"]["id"]
        assert session["csrf_token"] != registered["csrf_token"]

        assert client.post("/api/auth/logout").status_code == 403
        logout = client.post(
            "/api/auth/logout",
            headers={"X-CSRF-Token": session["csrf_token"]},
        )
        assert logout.status_code == 204
        signed_out = client.get("/api/auth/session")
        assert signed_out.status_code == 200
        assert signed_out.json() == {
            "user": None,
            "csrf_token": None,
            "expires_at": None,
        }

        login = client.post(
            "/api/auth/login",
            json={
                "email": "PERSON@example.com",
                "password": "correct horse battery staple",
            },
        )
        assert login.status_code == 200
        assert login.json()["user"]["id"] == registered["user"]["id"]
        cookie_header = login.headers["set-cookie"].lower()
        assert "httponly" in cookie_header
        assert "samesite=lax" in cookie_header

    with service.database.transaction() as connection:
        row = service.database.execute(
            connection,
            "SELECT password_hash FROM auth_users WHERE email = ?",
            ("person@example.com",),
        ).fetchone()
    assert row["password_hash"].startswith("$argon2id$")


def test_email_alias_logs_into_same_account_and_cannot_be_registered(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, service = _build_app(tmp_path / "alias.sqlite3", monkeypatch)
    with TestClient(app) as client:
        registered = _register(client, "primary@example.com")
        service.add_email_alias(registered["user"]["id"], "Alias@Example.com")

        login = client.post(
            "/api/auth/login",
            json={"email": "alias@example.com", "password": "correct horse battery staple"},
        )
        assert login.status_code == 200
        assert login.json()["user"]["id"] == registered["user"]["id"]
        assert login.json()["user"]["email"] == "primary@example.com"

        duplicate = client.post(
            "/api/auth/register",
            json={
                "email": "alias@example.com",
                "password": "another secure password",
                "display_name": "Duplicate",
            },
        )
        assert duplicate.status_code == 409


def test_csrf_protects_cookie_authenticated_writes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app, _ = _build_app(tmp_path / "csrf.sqlite3", monkeypatch)
    with TestClient(app) as client:
        auth = _register(client, "csrf@example.com")
        assert client.post("/api/private-write").status_code == 403
        accepted = client.post(
            "/api/private-write",
            headers={"X-CSRF-Token": auth["csrf_token"]},
        )
        assert accepted.status_code == 200


def test_api_key_is_encrypted_and_never_returned(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.auth.socket.getaddrinfo", _public_dns)
    app, service = _build_app(tmp_path / "secrets.sqlite3", monkeypatch)
    secret = "test-provider-key-value"
    with TestClient(app) as client:
        auth = _register(client, "secrets@example.com")
        saved = client.put(
            "/api/account/api-config",
            headers={"X-CSRF-Token": auth["csrf_token"]},
            json={
                "provider": "custom",
                "base_url": "https://provider.example/v1/responses",
                "model": "ocean-test-model",
                "api_key": secret,
            },
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["has_api_key"] is True
        assert "api_key" not in saved.json()
        assert secret not in saved.text

        fetched = client.get("/api/account/api-config")
        assert fetched.status_code == 200
        assert "api_key" not in fetched.json()
        assert secret not in fetched.text

    with service.database.transaction() as connection:
        row = service.database.execute(
            connection,
            "SELECT encrypted_api_key FROM user_provider_configs",
        ).fetchone()
    assert row["encrypted_api_key"]
    assert row["encrypted_api_key"] != secret
    credentials = service.get_api_credentials(auth["user"]["id"])
    assert credentials is not None
    assert credentials.api_key is not None
    assert credentials.api_key.get_secret_value() == secret


def test_provider_configs_are_isolated_per_user(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.auth.socket.getaddrinfo", _public_dns)
    app, service = _build_app(tmp_path / "isolation.sqlite3", monkeypatch)
    with TestClient(app) as first_client, TestClient(app) as second_client:
        first = _register(first_client, "first@example.com")
        second = _register(second_client, "second@example.com")
        first_save = first_client.put(
            "/api/account/api-config",
            headers={"X-CSRF-Token": first["csrf_token"]},
            json={
                "provider": "custom",
                "base_url": "https://first.example/v1/responses",
                "model": "first-model",
                "api_key": "first-secret",
            },
        )
        assert first_save.status_code == 200
        assert second_client.get("/api/account/api-config").json() is None

        second_save = second_client.put(
            "/api/account/api-config",
            headers={"X-CSRF-Token": second["csrf_token"]},
            json={
                "provider": "custom",
                "base_url": "https://second.example/v1/chat/completions",
                "model": "second-model",
                "api_key": "second-secret",
            },
        )
        assert second_save.status_code == 200
        assert first_client.get("/api/account/api-config").json()["model"] == "first-model"
        assert second_client.get("/api/account/api-config").json()["model"] == "second-model"

    first_credentials = service.get_api_credentials(first["user"]["id"])
    second_credentials = service.get_api_credentials(second["user"]["id"])
    assert first_credentials is not None and first_credentials.api_key is not None
    assert second_credentials is not None and second_credentials.api_key is not None
    assert first_credentials.api_key.get_secret_value() == "first-secret"
    assert second_credentials.api_key.get_secret_value() == "second-secret"


def test_auth_required_protects_api_in_production_mode(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, _ = _build_app(tmp_path / "required.sqlite3", monkeypatch, auth_required=True)
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/private").status_code == 401
        assert client.post("/api/private-write").status_code == 401

        auth = _register(client, "production@example.com")
        assert client.get("/api/private").status_code == 200
        assert client.post("/api/private-write").status_code == 403
        accepted = client.post(
            "/api/private-write",
            headers={"X-CSRF-Token": auth["csrf_token"]},
        )
        assert accepted.status_code == 200


@pytest.mark.parametrize(
    "api_url",
    [
        "http://provider.example/v1/responses",
        "https://user:password@provider.example/v1/responses",
        "https://127.0.0.1/v1/responses",
        "https://10.0.0.8/v1/chat/completions",
        "https://169.254.169.254/latest/responses",
        "https://metadata.google.internal/v1/responses",
        "https://provider.example:99999/v1/responses",
        "https://provider.example/v1/messages",
    ],
)
def test_provider_url_rejects_unsafe_targets(
    api_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.auth.socket.getaddrinfo", _public_dns)
    with pytest.raises(HTTPException) as caught:
        validate_provider_url(api_url)
    assert caught.value.status_code == 422


def test_provider_url_accepts_public_supported_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.auth.socket.getaddrinfo", _public_dns)
    assert (
        validate_provider_url("https://provider.example/v1/chat/completions/")
        == "https://provider.example/v1/chat/completions"
    )


@pytest.mark.parametrize(
    ("api_url", "api_mode", "expected"),
    [
        (
            "https://relay.example",
            "responses",
            "https://relay.example/v1/responses",
        ),
        (
            "https://relay.example/v1/",
            "chat_completions",
            "https://relay.example/v1/chat/completions",
        ),
        (
            "https://relay.example/openai/v1",
            "responses",
            "https://relay.example/openai/v1/responses",
        ),
    ],
)
def test_provider_url_normalizes_relay_base_address(
    api_url: str,
    api_mode: str,
    expected: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.auth.socket.getaddrinfo", _public_dns)
    assert validate_provider_url(api_url, api_mode) == expected


def test_connection_test_uses_form_values_without_saving(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.auth.socket.getaddrinfo", _public_dns)
    captured: dict[str, str] = {}

    def probe(base_url: str, api_key: str, model: str) -> ProviderConnectionTestResult:
        captured.update(base_url=base_url, api_key=api_key, model=model)
        return ProviderConnectionTestResult(
            base_url=base_url,
            model=model,
            api_mode="chat_completions",
            latency_ms=18,
            message="连接成功",
        )

    monkeypatch.setattr("app.auth._probe_provider_connection", probe)
    app, _ = _build_app(tmp_path / "connection-test.sqlite3", monkeypatch)
    with TestClient(app) as client:
        auth = _register(client, "relay-test@example.com")
        response = client.post(
            "/api/account/api-config/test",
            headers={"X-CSRF-Token": auth["csrf_token"]},
            json={
                "provider": "custom",
                "base_url": "https://relay.example/v1",
                "api_mode": "chat_completions",
                "model": "relay-model",
                "api_key": "relay-secret",
            },
        )

        assert response.status_code == 200, response.text
        assert response.json()["latency_ms"] == 18
        assert captured == {
            "base_url": "https://relay.example/v1/chat/completions",
            "api_key": "relay-secret",
            "model": "relay-model",
        }
        assert client.get("/api/account/api-config").json() is None


def test_connection_test_can_reuse_saved_encrypted_key(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.auth.socket.getaddrinfo", _public_dns)
    captured: dict[str, str] = {}

    def probe(base_url: str, api_key: str, model: str) -> ProviderConnectionTestResult:
        captured.update(base_url=base_url, api_key=api_key, model=model)
        return ProviderConnectionTestResult(
            base_url=base_url,
            model=model,
            api_mode="responses",
            latency_ms=21,
            message="连接成功",
        )

    monkeypatch.setattr("app.auth._probe_provider_connection", probe)
    app, _ = _build_app(tmp_path / "connection-reuse.sqlite3", monkeypatch)
    with TestClient(app) as client:
        auth = _register(client, "relay-reuse@example.com")
        saved = client.put(
            "/api/account/api-config",
            headers={"X-CSRF-Token": auth["csrf_token"]},
            json={
                "provider": "custom",
                "base_url": "https://relay.example/v1",
                "api_mode": "responses",
                "model": "saved-model",
                "api_key": "saved-secret",
            },
        )
        assert saved.status_code == 200, saved.text

        tested = client.post(
            "/api/account/api-config/test",
            headers={"X-CSRF-Token": auth["csrf_token"]},
            json={
                "provider": "custom",
                "base_url": "https://relay.example/v1",
                "api_mode": "responses",
                "model": "new-model",
            },
        )

        assert tested.status_code == 200, tested.text
        assert captured["api_key"] == "saved-secret"
        persisted = client.get("/api/account/api-config").json()
        assert persisted["base_url"] == "https://relay.example/v1/responses"
        assert persisted["model"] == "saved-model"


def test_changed_base_url_cannot_reuse_saved_key(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.auth.socket.getaddrinfo", _public_dns)
    probe_called = False

    def probe(base_url: str, api_key: str, model: str) -> ProviderConnectionTestResult:
        del base_url, api_key, model
        nonlocal probe_called
        probe_called = True
        raise AssertionError("probe must not receive a key scoped to another Base URL")

    monkeypatch.setattr("app.auth._probe_provider_connection", probe)
    app, _ = _build_app(tmp_path / "connection-scope.sqlite3", monkeypatch)
    with TestClient(app) as client:
        auth = _register(client, "relay-scope@example.com")
        saved = client.put(
            "/api/account/api-config",
            headers={"X-CSRF-Token": auth["csrf_token"]},
            json={
                "provider": "custom",
                "base_url": "https://relay.example/v1",
                "api_mode": "responses",
                "model": "saved-model",
                "api_key": "saved-secret",
            },
        )
        assert saved.status_code == 200, saved.text

        tested = client.post(
            "/api/account/api-config/test",
            headers={"X-CSRF-Token": auth["csrf_token"]},
            json={
                "provider": "custom",
                "base_url": "https://new-relay.example/v1",
                "api_mode": "responses",
                "model": "new-model",
            },
        )
        assert tested.status_code == 422
        assert "Base URL" in tested.json()["detail"]
        assert probe_called is False

        discovered = client.post(
            "/api/account/api-config/models",
            headers={"X-CSRF-Token": auth["csrf_token"]},
            json={
                "provider": "custom",
                "base_url": "https://new-relay.example/v1",
                "api_mode": "responses",
            },
        )
        assert discovered.status_code == 422
        assert "Base URL" in discovered.json()["detail"]

        changed = client.put(
            "/api/account/api-config",
            headers={"X-CSRF-Token": auth["csrf_token"]},
            json={
                "provider": "custom",
                "base_url": "https://new-relay.example/v1",
                "api_mode": "responses",
                "model": "new-model",
            },
        )
        assert changed.status_code == 422
        assert client.get("/api/account/api-config").json()["model"] == "saved-model"


def test_model_discovery_uses_form_values_without_saving(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.auth.socket.getaddrinfo", _public_dns)
    captured: dict[str, object] = {}

    def fetch_models(roots: list[str], api_key: str) -> list[str]:
        captured.update(roots=roots, api_key=api_key)
        return ["model-2", "model-10"]

    monkeypatch.setattr("app.auth._fetch_provider_models", fetch_models)
    app, _ = _build_app(tmp_path / "model-discovery.sqlite3", monkeypatch)
    with TestClient(app) as client:
        auth = _register(client, "relay-models@example.com")
        response = client.post(
            "/api/account/api-config/models",
            headers={"X-CSRF-Token": auth["csrf_token"]},
            json={
                "provider": "custom",
                "base_url": "https://relay.example",
                "api_mode": "responses",
                "api_key": "relay-secret",
            },
        )

        assert response.status_code == 200, response.text
        assert response.json()["models"] == ["model-2", "model-10"]
        assert response.json()["base_url"] == "https://relay.example/v1/responses"
        assert "relay-secret" not in response.text
        assert captured == {
            "roots": ["https://relay.example/v1", "https://relay.example"],
            "api_key": "relay-secret",
        }
        assert client.get("/api/account/api-config").json() is None


def test_model_discovery_parses_common_relay_shapes_and_natural_sorts() -> None:
    payload = {
        "result": {
            "models": [
                {"name": "model-10"},
                {"id": "model-2"},
                {"model": "model-1"},
                "model-2",
                {"id": "invalid model"},
            ],
        },
    }
    assert _provider_model_ids(payload) == ["model-1", "model-2", "model-10"]


def test_model_discovery_falls_back_from_v1_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[object] = []

    class FakeResponse:
        def __enter__(self) -> "FakeResponse":
            return self

        def __exit__(self, *args: object) -> None:
            del args

        def read(self, limit: int) -> bytes:
            assert limit == 2_000_000
            return b'{"data":[{"id":"relay-model"}]}'

    def fake_urlopen(request: object, timeout: int) -> FakeResponse:
        requests.append(request)
        assert timeout == 15
        if len(requests) == 1:
            raise HTTPError("https://relay.example/v1/models", 404, "Not Found", None, None)
        return FakeResponse()

    monkeypatch.setattr("app.auth.urlopen", fake_urlopen)
    models = _fetch_provider_models(
        ["https://relay.example/v1", "https://relay.example"],
        "relay-secret",
    )

    assert models == ["relay-model"]
    assert [request.full_url for request in requests] == [
        "https://relay.example/v1/models",
        "https://relay.example/models",
    ]
    assert all(request.get_header("Authorization") == "Bearer relay-secret" for request in requests)
    assert all(
        request.get_header("User-agent") == "Ocean-Intelligence/1.0 (OpenAI-Compatible Client)"
        for request in requests
    )
