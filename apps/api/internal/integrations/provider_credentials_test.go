package integrations

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

const testProviderCredentialKey = "0123456789abcdef0123456789abcdef"

func setProviderCredentialTestKey(t *testing.T) {
	t.Helper()
	t.Setenv(providerCredentialKeyEnv, base64.StdEncoding.EncodeToString([]byte(testProviderCredentialKey)))
	t.Setenv(providerCredentialKeyIDEnv, "test:v1")
}

func TestProviderCredentialEncryptDecryptRoundTrip(t *testing.T) {
	setProviderCredentialTestKey(t)
	stored, err := encryptedProviderCredentialJSON(map[string]string{"accessToken": "secret-access-token", "refreshToken": "secret-refresh-token"})
	if err != nil {
		t.Fatalf("encrypt credential: %v", err)
	}
	if strings.Contains(string(stored), "secret-access-token") || strings.Contains(string(stored), "refreshToken") {
		t.Fatalf("stored payload leaked plaintext: %s", stored)
	}
	var envelope providerCredentialEnvelope
	if err := json.Unmarshal(stored, &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if envelope.Version != providerCredentialEnvelopeV1 || envelope.Algorithm != providerCredentialEnvelopeAlg || envelope.KeyID != "test:v1" || envelope.Nonce == "" || envelope.Ciphertext == "" {
		t.Fatalf("unexpected envelope: %#v", envelope)
	}
	var got map[string]string
	if err := decryptProviderCredentialJSON(context.Background(), nil, "", "", stored, &got); err != nil {
		t.Fatalf("decrypt credential: %v", err)
	}
	if got["accessToken"] != "secret-access-token" || got["refreshToken"] != "secret-refresh-token" {
		t.Fatalf("credential = %#v", got)
	}
}

func TestProviderCredentialDecryptRejectsWrongKey(t *testing.T) {
	setProviderCredentialTestKey(t)
	stored, err := encryptedProviderCredentialJSON(map[string]string{"accessToken": "secret-access-token"})
	if err != nil {
		t.Fatalf("encrypt credential: %v", err)
	}
	t.Setenv(providerCredentialKeyEnv, base64.StdEncoding.EncodeToString([]byte("abcdef0123456789abcdef0123456789")))
	var got map[string]string
	if err := decryptProviderCredentialJSON(context.Background(), nil, "", "", stored, &got); err == nil {
		t.Fatal("decrypt with wrong key succeeded")
	}
}

func TestProviderCredentialDecryptRejectsTamperedCiphertext(t *testing.T) {
	setProviderCredentialTestKey(t)
	stored, err := encryptedProviderCredentialJSON(map[string]string{"accessToken": "secret-access-token"})
	if err != nil {
		t.Fatalf("encrypt credential: %v", err)
	}
	var envelope providerCredentialEnvelope
	if err := json.Unmarshal(stored, &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(envelope.Ciphertext)
	if err != nil {
		t.Fatalf("decode ciphertext: %v", err)
	}
	ciphertext[0] ^= 0xff
	envelope.Ciphertext = base64.RawURLEncoding.EncodeToString(ciphertext)
	tampered, err := json.Marshal(envelope)
	if err != nil {
		t.Fatalf("encode tampered envelope: %v", err)
	}
	var got map[string]string
	if err := decryptProviderCredentialJSON(context.Background(), nil, "", "", tampered, &got); err == nil {
		t.Fatal("decrypt tampered payload succeeded")
	}
}

func TestProviderCredentialRequiresValidKey(t *testing.T) {
	t.Setenv(providerCredentialKeyEnv, "")
	if _, err := encryptedProviderCredentialJSON(map[string]string{"accessToken": "secret"}); !errors.Is(err, errProviderCredentialKeyMissing) {
		t.Fatalf("missing key error = %v", err)
	}
	t.Setenv(providerCredentialKeyEnv, "not-a-32-byte-key")
	if _, err := encryptedProviderCredentialJSON(map[string]string{"accessToken": "secret"}); !errors.Is(err, errProviderCredentialKeyInvalid) {
		t.Fatalf("invalid key error = %v", err)
	}
}

func TestProviderCredentialDecryptBackfillsLegacyPlaintext(t *testing.T) {
	setProviderCredentialTestKey(t)
	store := &fakeProviderCredentialStore{}
	legacy := []byte(`{"accessToken":"legacy-secret","botToken":"legacy-bot"}`)
	var got map[string]string
	if err := decryptProviderCredentialJSON(context.Background(), store, "00000000-0000-0000-0000-000000000001", "slack", legacy, &got); err != nil {
		t.Fatalf("decrypt legacy credential: %v", err)
	}
	if got["accessToken"] != "legacy-secret" || got["botToken"] != "legacy-bot" {
		t.Fatalf("legacy credential = %#v", got)
	}
	if len(store.updatedPayload) == 0 {
		t.Fatal("legacy credential was not backfilled")
	}
	if strings.Contains(string(store.updatedPayload), "legacy-secret") || strings.Contains(string(store.updatedPayload), "botToken") {
		t.Fatalf("backfilled payload leaked plaintext: %s", store.updatedPayload)
	}
	var roundTrip map[string]string
	if err := decryptProviderCredentialJSON(context.Background(), nil, "", "", store.updatedPayload, &roundTrip); err != nil {
		t.Fatalf("decrypt backfilled credential: %v", err)
	}
	if roundTrip["accessToken"] != "legacy-secret" || roundTrip["botToken"] != "legacy-bot" {
		t.Fatalf("backfilled credential = %#v", roundTrip)
	}
}

type fakeProviderCredentialStore struct {
	updatedPayload []byte
}

func (f *fakeProviderCredentialStore) Exec(_ context.Context, _ string, arguments ...any) (pgconn.CommandTag, error) {
	if len(arguments) >= 3 {
		if payload, ok := arguments[2].([]byte); ok {
			f.updatedPayload = append([]byte(nil), payload...)
		}
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}
