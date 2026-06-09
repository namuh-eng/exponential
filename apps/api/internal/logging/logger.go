package logging

import "go.uber.org/zap"

// New returns a structured logger suitable for the requested environment.
func New(environment string) (*zap.Logger, error) {
	if environment == "development" {
		return zap.NewDevelopment()
	}
	return zap.NewProduction()
}
