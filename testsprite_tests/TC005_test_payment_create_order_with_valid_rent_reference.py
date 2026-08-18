import requests

BASE_URL = "http://localhost:5000"
OWNER_CREDENTIALS = {"email": "owner@pgmaster.com", "password": "admin123"}
TENANT_CREDENTIALS = {"email": "rahul.patil@example.com", "password": "tenant123"}


def login(credentials):
    url = f"{BASE_URL}/api/auth/login"
    try:
        resp = requests.post(url, json=credentials, timeout=30)
        resp.raise_for_status()
        return resp.json().get("token") or resp.json().get("accessToken")
    except Exception as e:
        raise RuntimeError(f"Login failed for {credentials['email']}: {e}")


def get_rent_records(token):
    url = f"{BASE_URL}/api/rent/records"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        raise RuntimeError(f"Failed to get rent records: {e}")


def test_payment_create_order_with_valid_rent_reference():
    tenant_token = login(TENANT_CREDENTIALS)
    assert tenant_token, "Tenant login failed, no token received"

    # Get rent records to find a valid rent reference (rent ID)
    rent_data = get_rent_records(tenant_token)
    assert isinstance(rent_data, dict), "Rent records response is not a JSON object"
    rent_records = rent_data.get("data") or rent_data.get("rentRecords") or rent_data.get("records") or rent_data.get("rents")
    if not rent_records or not isinstance(rent_records, list):
        raise AssertionError("No rent records found to use as rent reference")

    valid_rent = None
    for rent in rent_records:
        rent_id = rent.get("id") or rent.get("rentId") or rent.get("rent_id")
        if rent_id:
            valid_rent = rent_id
            break

    if not valid_rent:
        raise AssertionError("No valid rent ID found in rent records")

    url = f"{BASE_URL}/api/payment/create-order"
    headers = {"Authorization": f"Bearer {tenant_token}", "Content-Type": "application/json"}
    payload = {"rentId": valid_rent}

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=30)
    except Exception as e:
        raise RuntimeError(f"Request to create payment order failed: {e}")

    assert resp.status_code == 200, f"Expected status 200 but got {resp.status_code}"
    try:
        resp_json = resp.json()
    except Exception:
        raise AssertionError("Response is not valid JSON")

    # Validate expected Razorpay order details keys presence in response
    # Since PRD doesn't specify exact Razorpay order schema, check for typical fields
    assert "id" in resp_json, "Response JSON missing 'id' field (Razorpay order id)"
    assert "entity" in resp_json and resp_json["entity"] == "order", "Response JSON missing or incorrect 'entity' field"
    assert "amount" in resp_json, "Response JSON missing 'amount' field"
    assert "currency" in resp_json, "Response JSON missing 'currency' field"
    assert "status" in resp_json, "Response JSON missing 'status' field"


test_payment_create_order_with_valid_rent_reference()