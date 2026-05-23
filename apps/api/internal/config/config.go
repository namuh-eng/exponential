package config

import "github.com/spf13/viper"

// Config contains runtime settings for the headless API process.
type Config struct {
	Addr        string
	DatabaseURL string
	RedisURL    string
	KratosURL   string
	Environment string
}

// Load reads configuration from environment variables with local-dev defaults.
func Load() Config {
	v := viper.New()
	v.SetEnvPrefix("EXPONENTIAL_API")
	v.AutomaticEnv()

	v.SetDefault("ADDR", ":3016")
	v.SetDefault("DATABASE_URL", "postgresql://postgres:password@localhost:5432/exponential?sslmode=disable")
	v.SetDefault("REDIS_URL", "redis://localhost:6379")
	v.SetDefault("KRATOS_URL", "http://localhost:4433")
	v.SetDefault("ENVIRONMENT", "development")

	return Config{
		Addr:        v.GetString("ADDR"),
		DatabaseURL: v.GetString("DATABASE_URL"),
		RedisURL:    v.GetString("REDIS_URL"),
		KratosURL:   v.GetString("KRATOS_URL"),
		Environment: v.GetString("ENVIRONMENT"),
	}
}
