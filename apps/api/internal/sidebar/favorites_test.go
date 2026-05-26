package sidebar

import (
	"encoding/json"
	"testing"
)

func TestReadFavoritesNormalizesDedupesAndLimits(t *testing.T) {
	items := []map[string]any{{"objectType": "project", "objectId": "p1", "createdAt": "2026-01-01T00:00:00Z"}, {"objectType": "project", "objectId": "p1"}, {"objectType": "bad", "objectId": "x"}}
	for i := 0; i < 60; i++ {
		items = append(items, map[string]any{"objectType": "issue", "objectId": string(rune('a'+i%26)) + string(rune('A'+i/26))})
	}
	raw, _ := json.Marshal(map[string]any{"sidebarFavoritesByWorkspace": map[string]any{"w1": items}})

	favorites := readFavorites(raw, "w1")

	if len(favorites) != 50 {
		t.Fatalf("favorites length = %d", len(favorites))
	}
	if favorites[0].ObjectType != "project" || favorites[0].ObjectID != "p1" {
		t.Fatalf("first favorite = %#v", favorites[0])
	}
}

func TestFavoriteHelpers(t *testing.T) {
	if favoriteID("project", "p1") != "project:p1" {
		t.Fatal("favorite id drifted")
	}
	favorites := []StoredFavorite{{ObjectType: "view", ObjectID: "v1"}}
	if !favoriteExists(favorites, "view", "v1") || favoriteExists(favorites, "issue", "i1") {
		t.Fatal("favorite existence helper drifted")
	}
	if !validObjectType("project") || validObjectType("team") {
		t.Fatal("object type validation drifted")
	}
}
