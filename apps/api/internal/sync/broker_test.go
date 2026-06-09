package sync

import "testing"

func TestRedisURLFromEnvPrefersAPIConfig(t *testing.T) {
	t.Setenv("EXPONENTIAL_API_REDIS_URL", "redis://api-redis:6379")
	t.Setenv("REDIS_URL", "redis://legacy-redis:6379")

	if got := redisURLFromEnv(); got != "redis://api-redis:6379" {
		t.Fatalf("redisURLFromEnv() = %q", got)
	}
}

func TestRedisURLFromEnvFallsBackToLegacyAndDefault(t *testing.T) {
	t.Setenv("EXPONENTIAL_API_REDIS_URL", "")
	t.Setenv("REDIS_URL", "redis://legacy-redis:6379")
	if got := redisURLFromEnv(); got != "redis://legacy-redis:6379" {
		t.Fatalf("legacy redis URL = %q", got)
	}

	t.Setenv("REDIS_URL", "")
	if got := redisURLFromEnv(); got != "redis://localhost:6379" {
		t.Fatalf("default redis URL = %q", got)
	}
}
