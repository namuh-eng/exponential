package comments

import "testing"

func TestReactionSummaryShape(t *testing.T) {
	summary := ReactionSummary{Emoji: "👍", Count: 2, Reacted: true}
	if summary.Emoji == "" || summary.Count != 2 || !summary.Reacted {
		t.Fatal("reaction summary shape drifted")
	}
}
