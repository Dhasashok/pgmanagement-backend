import requests

BASE_URL = "http://localhost:5000"
OWNER_EMAIL = "owner@pgmaster.com"
OWNER_PASSWORD = "admin123"
TIMEOUT = 30

def test_pg_property_update_with_owner_token():
    # Login as owner to get JWT token
    login_url = f"{BASE_URL}/api/auth/login"
    login_payload = {
        "email": OWNER_EMAIL,
        "password": OWNER_PASSWORD
    }
    try:
        login_resp = requests.post(login_url, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        login_data = login_resp.json()
        token = login_data.get("token") or login_data.get("accessToken")
        assert token and isinstance(token, str), "No valid token received from login"
    except Exception as e:
        raise AssertionError(f"Owner login request failed: {e}")

    # Get current property details (optional, to prepare for update)
    property_get_url = f"{BASE_URL}/api/pg/property"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        get_resp = requests.get(property_get_url, timeout=TIMEOUT)
        assert get_resp.status_code == 200, f"Failed to get property details, status {get_resp.status_code}"
        current_property = get_resp.json()
    except Exception as e:
        raise AssertionError(f"Fetching property details failed: {e}")

    # Prepare updated property data, modifying some fields or adding test keys
    # We'll toggle name or add field to verify update
    updated_property = current_property.copy() if isinstance(current_property, dict) else {}
    if "name" in updated_property and isinstance(updated_property["name"], str):
        updated_property["name"] = updated_property["name"] + " Updated"
    else:
        updated_property["name"] = "Updated Property Name Test"
    # Add/overwrite some more sample fields if needed
    updated_property["description"] = updated_property.get("description", "") + " Updated for test"

    # PUT request to update property info with owner token
    property_put_url = f"{BASE_URL}/api/pg/property"
    put_headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    try:
        put_resp = requests.put(property_put_url, json=updated_property, headers=put_headers, timeout=TIMEOUT)
        assert put_resp.status_code == 200, f"Property update failed with status {put_resp.status_code}"
        response_data = put_resp.json()
        # Validate returned data reflects updated info
        assert isinstance(response_data, dict), "Response data is not a JSON object"
        # Check that the updated fields are present and match
        assert response_data.get("name") == updated_property["name"], "Property name not updated correctly"
        # Optionally check description as well
        assert response_data.get("description") == updated_property["description"], "Property description not updated correctly"
    except Exception as e:
        raise AssertionError(f"Property update request failed: {e}")

test_pg_property_update_with_owner_token()