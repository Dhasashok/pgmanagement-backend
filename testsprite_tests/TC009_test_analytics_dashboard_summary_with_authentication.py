import requests

BASE_URL = "http://localhost:5000"
LOGIN_URL = f"{BASE_URL}/api/auth/login"
DASHBOARD_SUMMARY_URL = f"{BASE_URL}/api/analytics/dashboard-summary"
TIMEOUT = 30


def get_token(email: str, password: str) -> str:
    try:
        response = requests.post(
            LOGIN_URL,
            json={"email": email, "password": password},
            timeout=TIMEOUT
        )
        response.raise_for_status()
        data = response.json()
        token = data.get("token") or data.get("accessToken") or data.get("jwt")
        assert token, "Login response does not contain a token"
        return token
    except requests.RequestException as e:
        raise RuntimeError(f"Failed to login for {email}: {e}")
    except AssertionError as e:
        raise RuntimeError(f"Token missing: {e}")


def test_analytics_dashboard_summary_with_authentication():
    # Use owner credentials as per instructions
    email = "owner@pgmaster.com"
    password = "admin123"
    token = get_token(email, password)
    headers = {"Authorization": f"Bearer {token}"}

    try:
        response = requests.get(DASHBOARD_SUMMARY_URL, headers=headers, timeout=TIMEOUT)
        assert response.status_code == 200, f"Expected status 200, got {response.status_code}"
        json_data = response.json()
        # Verify presence of dashboard KPIs keys (tenant, occupancy, rent, complaints)
        expected_keys = ["tenantKpis", "occupancyKpis", "rentKpis", "complaintKpis"]
        # The exact key naming is inferred from PRD user flows: "tenant, occupancy, rent, and complaint KPIs"
        # We'll allow keys in any case or use lowercase versions if not found
        keys_found = {k.lower(): k for k in json_data.keys()}
        for key in expected_keys:
            lower_key = key.lower()
            assert lower_key in keys_found, f"Missing KPI key in response: {key}"
            # Optionally check the KPI object is non-empty dict
            kpi_data = json_data[keys_found[lower_key]]
            assert isinstance(kpi_data, dict) and kpi_data, f"KPI data {key} should be a non-empty dict"

    except requests.RequestException as e:
        assert False, f"Request failed: {e}"


test_analytics_dashboard_summary_with_authentication()