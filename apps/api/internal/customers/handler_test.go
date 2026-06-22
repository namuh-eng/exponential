package customers

import "testing"

func TestAllowCustomerRequests(t *testing.T) {
	for _, role := range []string{"owner", "admin", "member"} {
		if !allowCustomerRequests(role) {
			t.Fatalf("role %s should access customer requests", role)
		}
	}
	for _, role := range []string{"guest", "", "viewer"} {
		if allowCustomerRequests(role) {
			t.Fatalf("role %s should not access customer requests", role)
		}
	}
}

func TestCleanPtr(t *testing.T) {
	blank := "  "
	if cleanPtr(&blank) != nil {
		t.Fatal("blank values should normalize to nil")
	}
	value := "  Acme  "
	cleaned := cleanPtr(&value)
	if cleaned == nil || *cleaned != "Acme" {
		t.Fatalf("cleanPtr = %#v", cleaned)
	}
}
