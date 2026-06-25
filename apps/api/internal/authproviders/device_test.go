package authproviders

import (
	"strings"
	"testing"
)

func TestNewUserCodeIsSixNumericDigits(t *testing.T) {
	for range 100 {
		code, err := newUserCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != 6 || !numericUserCodePattern.MatchString(code) {
			t.Fatalf("user code = %q, want six numeric digits", code)
		}
	}
}

func TestNormalizeUserCodeAllowsSpacesAndDashes(t *testing.T) {
	if got := normalizeUserCode(" 123-456 "); got != "123456" {
		t.Fatalf("normalized user code = %q", got)
	}
	if got := normalizeUserCode("H7K-4QM-92T"); got != "" {
		t.Fatalf("alphanumeric device code should be rejected, got %q", got)
	}
}

func TestNewDeviceCodeIsOpaqueURLSafeSecret(t *testing.T) {
	code, err := newDeviceCode()
	if err != nil {
		t.Fatal(err)
	}
	if len(code) < 40 || strings.ContainsAny(code, "+/=") {
		t.Fatalf("device code shape = %q", code)
	}
}
