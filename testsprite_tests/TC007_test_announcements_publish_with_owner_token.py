import requests

BASE_URL = "http://localhost:5000"
OWNER_EMAIL = "owner@pgmaster.com"
OWNER_PASSWORD = "admin123"
TIMEOUT = 30

def test_announcements_publish_with_owner_token():
    # Authenticate as owner to get the bearer token
    login_url = f"{BASE_URL}/api/auth/login"
    login_payload = {"email": OWNER_EMAIL, "password": OWNER_PASSWORD}
    try:
        login_resp = requests.post(login_url, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}, response: {login_resp.text}"
        token = login_resp.json().get("token")
        assert token, "No token received from login response"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # Prepare announcement data without unsupported 'priority' field
        announcement_data = {
            "title": "Test Announcement",
            "content": "This is a valid announcement content for testing."
        }
        post_url = f"{BASE_URL}/api/announcements"

        # Post announcement
        post_resp = requests.post(post_url, json=announcement_data, headers=headers, timeout=TIMEOUT)
        assert post_resp.status_code == 201, f"Announcement publish failed with status {post_resp.status_code}, response: {post_resp.text}"
        response_json = post_resp.json()
        assert "id" in response_json or "announcement" in response_json, "Response should contain announcement identifier"
        # Optionally verify returned content matches sent data
        if "announcement" in response_json:
            announcement_resp = response_json["announcement"]
        else:
            announcement_resp = response_json
        assert announcement_resp.get("title") == announcement_data["title"], "Announcement title mismatch"
        assert announcement_resp.get("content") == announcement_data["content"], "Announcement content mismatch"
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_announcements_publish_with_owner_token()
