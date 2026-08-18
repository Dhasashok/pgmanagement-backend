import requests

BASE_URL = "http://localhost:5000"
LOGIN_ENDPOINT = "/api/auth/login"
TIMEOUT = 30

def test_auth_login_with_valid_credentials():
    owner_credentials = {
        "email": "owner@pgmaster.com",
        "password": "admin123"
    }
    tenant_credentials = {
        "email": "rahul.patil@example.com",
        "password": "tenant123"
    }

    headers = {"Content-Type": "application/json"}

    # Test owner login
    try:
        response_owner = requests.post(
            BASE_URL + LOGIN_ENDPOINT,
            json=owner_credentials,
            headers=headers,
            timeout=TIMEOUT
        )
    except requests.RequestException as e:
        assert False, f"Owner login request failed: {e}"

    assert response_owner.status_code == 200, f"Owner login failed with status code {response_owner.status_code}"
    json_owner = response_owner.json()
    assert "token" in json_owner and isinstance(json_owner["token"], str) and len(json_owner["token"]) > 0, "Owner login did not return a valid JWT token"

    # Test tenant login
    try:
        response_tenant = requests.post(
            BASE_URL + LOGIN_ENDPOINT,
            json=tenant_credentials,
            headers=headers,
            timeout=TIMEOUT
        )
    except requests.RequestException as e:
        assert False, f"Tenant login request failed: {e}"

    assert response_tenant.status_code == 200, f"Tenant login failed with status code {response_tenant.status_code}"
    json_tenant = response_tenant.json()
    assert "token" in json_tenant and isinstance(json_tenant["token"], str) and len(json_tenant["token"]) > 0, "Tenant login did not return a valid JWT token"

test_auth_login_with_valid_credentials()