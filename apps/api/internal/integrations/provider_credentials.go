package integrations

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

const (
	providerCredentialKeyEnv      = "EXPONENTIAL_PROVIDER_CREDENTIAL_ENCRYPTION_KEY"
	providerCredentialKeyIDEnv    = "EXPONENTIAL_PROVIDER_CREDENTIAL_ENCRYPTION_KEY_ID"
	providerCredentialEnvelopeAlg = "AES-256-GCM"
	providerCredentialEnvelopeV1  = 1
	providerCredentialEnvelopeAAD = "exponential.provider_credential.v1"
)

var (
	errProviderCredentialKeyMissing = errors.New("provider credential encryption key is not configured")
	errProviderCredentialKeyInvalid = errors.New("provider credential encryption key must be 32 bytes encoded as base64 or hex")
)

type providerCredentialDB interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

type providerCredentialEnvelope struct {
	Version    int    `json:"v"`
	Algorithm  string `json:"alg"`
	KeyID      string `json:"kid"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

func encryptedProviderCredentialJSON(value any) ([]byte, error) {
	plaintext, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return encryptProviderCredentialPayload(plaintext)
}

func encryptProviderCredentialPayload(plaintext []byte) ([]byte, error) {
	key, keyID, err := loadProviderCredentialKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("initialize provider credential cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("initialize provider credential aead: %w", err)
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate provider credential nonce: %w", err)
	}
	envelope := providerCredentialEnvelope{
		Version:    providerCredentialEnvelopeV1,
		Algorithm:  providerCredentialEnvelopeAlg,
		KeyID:      keyID,
		Nonce:      base64.RawURLEncoding.EncodeToString(nonce),
		Ciphertext: base64.RawURLEncoding.EncodeToString(aead.Seal(nil, nonce, plaintext, []byte(providerCredentialEnvelopeAAD))),
	}
	out, err := json.Marshal(envelope)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func decryptProviderCredentialJSON(ctx context.Context, db providerCredentialDB, integrationID string, provider string, stored []byte, out any) error {
	plaintext, legacy, err := decryptProviderCredentialPayload(stored)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(plaintext, out); err != nil {
		return fmt.Errorf("decode provider credential payload: %w", err)
	}
	if legacy && db != nil && integrationID != "" && provider != "" && !emptyJSONPayload(plaintext) {
		encrypted, err := encryptProviderCredentialPayload(plaintext)
		if err != nil {
			return err
		}
		if _, err := db.Exec(ctx, `update provider_credential set encrypted_payload=$3, updated_at=now() where workspace_integration_id=$1::uuid and provider=$2 and active and encrypted_payload=$4`, integrationID, provider, encrypted, stored); err != nil {
			return fmt.Errorf("backfill provider credential encryption: %w", err)
		}
	}
	return nil
}

func decryptProviderCredentialPayload(stored []byte) ([]byte, bool, error) {
	trimmed := strings.TrimSpace(string(stored))
	if trimmed == "" {
		return nil, false, errors.New("provider credential payload is empty")
	}
	var envelope providerCredentialEnvelope
	if err := json.Unmarshal([]byte(trimmed), &envelope); err == nil && envelope.Version != 0 {
		plaintext, err := decryptProviderCredentialEnvelope(envelope)
		return plaintext, false, err
	}
	if json.Valid([]byte(trimmed)) {
		return []byte(trimmed), true, nil
	}
	return nil, false, errors.New("provider credential payload is not encrypted")
}

func decryptProviderCredentialEnvelope(envelope providerCredentialEnvelope) ([]byte, error) {
	if envelope.Version != providerCredentialEnvelopeV1 || envelope.Algorithm != providerCredentialEnvelopeAlg || envelope.Nonce == "" || envelope.Ciphertext == "" {
		return nil, errors.New("provider credential envelope is invalid")
	}
	key, _, err := loadProviderCredentialKey()
	if err != nil {
		return nil, err
	}
	nonce, err := base64.RawURLEncoding.DecodeString(envelope.Nonce)
	if err != nil {
		return nil, errors.New("provider credential nonce is invalid")
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(envelope.Ciphertext)
	if err != nil {
		return nil, errors.New("provider credential ciphertext is invalid")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("initialize provider credential cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("initialize provider credential aead: %w", err)
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, []byte(providerCredentialEnvelopeAAD))
	if err != nil {
		return nil, errors.New("provider credential payload could not be decrypted")
	}
	return plaintext, nil
}

func loadProviderCredentialKey() ([]byte, string, error) {
	raw := strings.TrimSpace(os.Getenv(providerCredentialKeyEnv))
	if raw == "" {
		return nil, "", errProviderCredentialKeyMissing
	}
	key, err := decodeProviderCredentialKey(raw)
	if err != nil {
		return nil, "", err
	}
	keyID := strings.TrimSpace(os.Getenv(providerCredentialKeyIDEnv))
	if keyID == "" {
		keyID = "env:v1"
	}
	return key, keyID, nil
}

func decodeProviderCredentialKey(raw string) ([]byte, error) {
	if decoded, err := hex.DecodeString(raw); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	encodings := []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding}
	for _, encoding := range encodings {
		decoded, err := encoding.DecodeString(raw)
		if err == nil && len(decoded) == 32 {
			return decoded, nil
		}
	}
	return nil, errProviderCredentialKeyInvalid
}

func emptyJSONPayload(plaintext []byte) bool {
	trimmed := strings.TrimSpace(string(plaintext))
	return trimmed == "{}" || trimmed == "null"
}
