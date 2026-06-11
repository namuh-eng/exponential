package integrations

import "time"

const maxProviderRetryDelay = time.Hour

func nextProviderRetryAt(now time.Time, attempts int) time.Time {
	if attempts < 1 {
		attempts = 1
	}
	delay := time.Minute
	for i := 1; i < attempts && delay < maxProviderRetryDelay; i++ {
		delay *= 2
	}
	if delay > maxProviderRetryDelay {
		delay = maxProviderRetryDelay
	}
	return now.Add(delay)
}

func providerJobFailureStatus(attempts int, maxAttempts int) (status string, nextRunAt *time.Time) {
	if maxAttempts < 1 {
		maxAttempts = 1
	}
	if attempts >= maxAttempts {
		return "dead", nil
	}
	next := nextProviderRetryAt(time.Now().UTC(), attempts)
	return "failed", &next
}
