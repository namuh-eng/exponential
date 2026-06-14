package comments

import "testing"

func TestSlackCommentTextLinksIssueAndTruncatesBody(t *testing.T) {
	t.Setenv("EXPONENTIAL_APP_URL", "https://app.example")
	body := "hello"
	got := slackCommentText("ENG", "ENG-574", "Slack sync", body)
	if got != "New comment on <https://app.example/team/ENG/issue/ENG-574|ENG-574 Slack sync>:\nhello" {
		t.Fatalf("comment text = %q", got)
	}
}

func TestTruncateSlackComment(t *testing.T) {
	if got := truncateSlackComment("abcdef", 5); got != "ab..." {
		t.Fatalf("truncated = %q", got)
	}
	if got := truncateSlackComment("abc", 5); got != "abc" {
		t.Fatalf("short = %q", got)
	}
}

func TestReactionSummaryShape(t *testing.T) {
	summary := ReactionSummary{Emoji: "👍", Count: 2, Reacted: true}
	if summary.Emoji == "" || summary.Count != 2 || !summary.Reacted {
		t.Fatal("reaction summary shape drifted")
	}
}
