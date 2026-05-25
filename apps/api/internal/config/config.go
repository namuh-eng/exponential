package config

import "github.com/spf13/viper"

// Config contains runtime settings for the headless API process.
type Config struct {
	Addr         string
	DatabaseURL  string
	RedisURL     string
	Environment  string
	ServiceName  string
	OTLPEndpoint string
}

// Load reads configuration from environment variables with local-dev defaults.
func Load() Config {
	v := viper.New()
	v.SetEnvPrefix("EXPONENTIAL_API")
	v.AutomaticEnv()

	v.SetDefault("ADDR", ":7016")
	v.SetDefault("DATABASE_URL", "postgresql://postgres:password@localhost:5432/exponential?sslmode=disable")
	v.SetDefault("REDIS_URL", "redis://localhost:6379")
	v.SetDefault("ENVIRONMENT", "development")
	v.SetDefault("SERVICE_NAME", "exponential-api")
	v.SetDefault("OTEL_EXPORTER_OTLP_ENDPOINT", "")

	return Config{
		Addr:         v.GetString("ADDR"),
		DatabaseURL:  v.GetString("DATABASE_URL"),
		RedisURL:     v.GetString("REDIS_URL"),
		Environment:  v.GetString("ENVIRONMENT"),
		ServiceName:  v.GetString("SERVICE_NAME"),
		OTLPEndpoint: v.GetString("OTEL_EXPORTER_OTLP_ENDPOINT"),
	}
}
