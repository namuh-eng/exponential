package ratelimit

import (
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

const defaultLimitPerMinute = 600

type limiter struct {
	mu      sync.Mutex
	windows map[string]window
	now     func() time.Time
	limit   int
}

type window struct {
	Start time.Time
	Count int
}

func Middleware() func(http.Handler) http.Handler {
	return New(limitFromEnv(), time.Now).Handler
}

func PublicMiddleware() func(http.Handler) http.Handler {
	return New(limitFromEnv(), time.Now).PublicHandler
}

func New(limit int, now func() time.Time) *limiter {
	if limit <= 0 {
		limit = defaultLimitPerMinute
	}
	if now == nil {
		now = time.Now
	}
	return &limiter{windows: map[string]window{}, now: now, limit: limit}
}

func limitFromEnv() int {
	value := os.Getenv("EXPONENTIAL_API_RATE_LIMIT_PER_MINUTE")
	if value == "" {
		return defaultLimitPerMinute
	}
	limit, err := strconv.Atoi(value)
	if err != nil || limit <= 0 {
		return defaultLimitPerMinute
	}
	return limit
}

func (l *limiter) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth.TestMode() {
			next.ServeHTTP(w, r)
			return
		}
		principal, ok := auth.FromContext(r.Context())
		if !ok {
			next.ServeHTTP(w, r)
			return
		}

		remaining, reset, allowed := l.take(key(principal))
		setHeaders(w, l.limit, remaining, reset)
		if !allowed {
			w.Header().Set("Retry-After", strconv.FormatInt(max(1, int64(time.Until(reset).Seconds())), 10))
			problem.Write(w, http.StatusTooManyRequests, "Rate limit exceeded", "Too many requests for this token. Try again after the reset time.")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (l *limiter) PublicHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth.TestMode() {
			next.ServeHTTP(w, r)
			return
		}
		clientIP := auth.ClientIP(r)
		if clientIP == "" {
			clientIP = "anonymous"
		}

		remaining, reset, allowed := l.take("ip:" + clientIP)
		setHeaders(w, l.limit, remaining, reset)
		if !allowed {
			w.Header().Set("Retry-After", strconv.FormatInt(max(1, int64(time.Until(reset).Seconds())), 10))
			problem.Write(w, http.StatusTooManyRequests, "Rate limit exceeded", "Too many requests from this network. Try again after the reset time.")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (l *limiter) take(key string) (int, time.Time, bool) {
	now := l.now().UTC()
	start := now.Truncate(time.Minute)
	reset := start.Add(time.Minute)

	l.mu.Lock()
	defer l.mu.Unlock()

	current := l.windows[key]
	if current.Start.IsZero() || !current.Start.Equal(start) {
		current = window{Start: start}
	}

	if current.Count >= l.limit {
		l.windows[key] = current
		return 0, reset, false
	}

	current.Count++
	l.windows[key] = current
	return l.limit - current.Count, reset, true
}

func key(principal auth.Principal) string {
	if principal.APIKeyID != "" {
		return "token:" + principal.APIKeyID
	}
	if principal.UserID != "" {
		return "user:" + principal.UserID
	}
	return "anonymous"
}

func setHeaders(w http.ResponseWriter, limit int, remaining int, reset time.Time) {
	w.Header().Set("X-RateLimit-Limit", strconv.Itoa(limit))
	w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
	w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(reset.Unix(), 10))
}

func max(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
