import requests

BASE_URL = "http://localhost:5000"
OWNER_EMAIL = "owner@pgmaster.com"
OWNER_PASSWORD = "admin123"
TENANT_EMAIL = "rahul.patil@example.com"
TENANT_PASSWORD = "tenant123"
TIMEOUT = 30

def get_auth_token(email, password):
    url = f"{BASE_URL}/api/auth/login"
    payload = {"email": email, "password": password}
    try:
        response = requests.post(url, json=payload, timeout=TIMEOUT)
        response.raise_for_status()
        data = response.json()
        token = data.get("token") or data.get("accessToken") or data.get("jwtToken")
        assert token, "JWT token not found in login response"
        return token
    except requests.RequestException as e:
        raise RuntimeError(f"Login request failed: {e}")

def test_notifications_fetch_for_authenticated_user():
    token = get_auth_token(TENANT_EMAIL, TENANT_PASSWORD)
    headers = {
        "Authorization": f"Bearer {token}"
    }
    url = f"{BASE_URL}/api/notifications"
    try:
        response = requests.get(url, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as e:
        raise RuntimeError(f"Notifications fetch request failed: {e}")
    
    assert response.status_code == 200, f"Expected status 200 but got {response.status_code}"
    
    try:
        notifications = response.json()
    except ValueError:
        raise AssertionError("Response is not in JSON format")

    assert isinstance(notifications, (list, dict)), "Notifications response should be list or dict"
    # Optionally check that notifications relate to the user (if any structure known)
    # But schema not defined in detail, so just non-empty or empty list/dict is acceptable

test_notifications_fetch_for_authenticated_user()