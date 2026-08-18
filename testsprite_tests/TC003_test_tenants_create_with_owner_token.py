import requests

BASE_URL = "http://localhost:5000"
LOGIN_ENDPOINT = "/api/auth/login"
TENANTS_ENDPOINT = "/api/tenants"
TIMEOUT = 30

OWNER_EMAIL = "owner@pgmaster.com"
OWNER_PASSWORD = "admin123"

tenant_payload = {
    "name": "Rahul Patil",
    "email": "rahul.patil@example.com",
    "phone": "9876543210",
    "address": "123, Example Street",
    "emergencyContact": {
        "name": "Sanjay Patil",
        "phone": "9123456780",
        "relation": "Brother"
    },
    "dateOfBirth": "1995-04-25",
    "gender": "Male",
    "idProof": "Aadhar Card",
    "idNumber": "1234-5678-9012",
    "occupation": "Software Engineer"
}

def test_tenants_create_with_owner_token():
    try:
        # Authenticate as owner to get token
        login_resp = requests.post(
            BASE_URL + LOGIN_ENDPOINT,
            json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
            timeout=TIMEOUT
        )
        assert login_resp.status_code == 200, f"Owner login failed: {login_resp.text}"
        token = login_resp.json().get("token") or login_resp.json().get("accessToken")
        assert token, "Owner token not found in login response"

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

        # Create tenant with owner token
        resp = requests.post(
            BASE_URL + TENANTS_ENDPOINT,
            json=tenant_payload,
            headers=headers,
            timeout=TIMEOUT
        )
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}, response: {resp.text}"
        tenant_data = resp.json()
        assert "id" in tenant_data, "Created tenant response missing 'id'"
        # Additional basic checks on returned tenant info
        assert tenant_data.get("email") == tenant_payload["email"], "Tenant email mismatch"
        assert tenant_data.get("name") == tenant_payload["name"], "Tenant name mismatch"
    finally:
        # Cleanup - delete the created tenant if created
        if 'tenant_data' in locals() and "id" in tenant_data:
            try:
                del_resp = requests.delete(
                    f"{BASE_URL}{TENANTS_ENDPOINT}/{tenant_data['id']}",
                    headers=headers,
                    timeout=TIMEOUT
                )
                # It's ok if delete fails, just log maybe
            except Exception:
                pass

test_tenants_create_with_owner_token()