import requests

BASE_URL = "http://localhost:5000"
OWNER_EMAIL = "owner@pgmaster.com"
OWNER_PASSWORD = "admin123"
TENANT_EMAIL = "rahul.patil@example.com"
TENANT_PASSWORD = "tenant123"
TIMEOUT = 30


def authenticate(email: str, password: str) -> str:
    url = f"{BASE_URL}/api/auth/login"
    payload = {"email": email, "password": password}
    response = requests.post(url, json=payload, timeout=TIMEOUT)
    response.raise_for_status()
    data = response.json()
    token = data.get("token") or data.get("accessToken") or data.get("jwt") or data.get("data", {}).get("token")
    assert token, "Authentication token not found in response"
    return token


def test_complaints_file_new_complaint():
    tenant_token = authenticate(TENANT_EMAIL, TENANT_PASSWORD)
    headers = {
        "Authorization": f"Bearer {tenant_token}",
        "Content-Type": "application/json"
    }
    complaint_payload = {
        "issueCategory": "Maintenance",
        "description": "The water tap in the kitchen is leaking."
    }
    url = f"{BASE_URL}/api/complaints"
    response = requests.post(url, json=complaint_payload, headers=headers, timeout=TIMEOUT)
    try:
        assert response.status_code == 201, f"Expected status code 201, got {response.status_code}"
        resp_json = response.json()
        # Validate response contains complaint id or relevant data
        assert isinstance(resp_json, dict), "Response JSON is not a dictionary"
        assert "id" in resp_json or "complaintId" in resp_json or "_id" in resp_json, "Complaint ID missing in response"
    finally:
        # Try to delete the created complaint if possible using owner token
        complaint_id = response.json().get("id") or response.json().get("complaintId") or response.json().get("_id")
        if complaint_id:
            # Owner auth to delete the complaint after test cleanup if deletion endpoint exists
            try:
                owner_token = authenticate(OWNER_EMAIL, OWNER_PASSWORD)
                del_headers = {"Authorization": f"Bearer {owner_token}"}
                delete_url = f"{BASE_URL}/api/complaints/{complaint_id}"
                requests.delete(delete_url, headers=del_headers, timeout=TIMEOUT)
            except Exception:
                # Ignore exceptions during cleanup
                pass


test_complaints_file_new_complaint()