import requests

BASE_URL = "http://localhost:5000"
LOGIN_ENDPOINT = "/api/auth/login"
RENT_GENERATE_ENDPOINT = "/api/rent/generate"
TIMEOUT = 30

owner_credentials = {
    "email": "owner@pgmaster.com",
    "password": "admin123"
}

def test_rent_generate_with_owner_token():
    # Login as owner to get JWT token
    try:
        login_resp = requests.post(
            BASE_URL + LOGIN_ENDPOINT,
            json=owner_credentials,
            timeout=TIMEOUT
        )
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        login_data = login_resp.json()
        assert "token" in login_data and login_data["token"], "JWT token not found in login response"
        owner_token = login_data["token"]

        headers = {"Authorization": f"Bearer {owner_token}"}

        # Call rent generate endpoint
        rent_gen_resp = requests.post(
            BASE_URL + RENT_GENERATE_ENDPOINT,
            headers=headers,
            timeout=TIMEOUT
        )
        assert rent_gen_resp.status_code == 200, f"Rent generate failed with status {rent_gen_resp.status_code}"
        rent_gen_data = rent_gen_resp.json()
        assert isinstance(rent_gen_data, dict), "Response is not a JSON object"
        # Assuming generated bills info is under a key 'generatedBills' or similar, check presence and non-empty
        assert any(isinstance(v, list) and len(v) > 0 for v in rent_gen_data.values()), "No generated bills found in response"
    except requests.RequestException as e:
        assert False, f"Request failed: {str(e)}"

test_rent_generate_with_owner_token()