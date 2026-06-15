package figma

import (
	"context"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type Link struct {
	Kind          string
	FileKey       string
	NodeID        string
	URL           string
	NormalizedURL string
}

type Source struct {
	ID            string  `json:"id"`
	URL           string  `json:"url"`
	NormalizedURL string  `json:"normalizedUrl"`
	FileKey       string  `json:"fileKey"`
	NodeID        *string `json:"nodeId"`
	Kind          string  `json:"kind"`
	Name          *string `json:"name"`
	ThumbnailURL  *string `json:"thumbnailUrl"`
	ContainerType string  `json:"containerType"`
	CapturedAt    string  `json:"capturedAt"`
	RefreshedAt   *string `json:"refreshedAt"`
	LastError     *string `json:"lastError"`
}

type SyncTarget struct {
	WorkspaceID   string
	IssueID       string
	CommentID     string
	ContainerType string
}

var urlPattern = regexp.MustCompile(`https?://[^\s<>"']+`)

func ExtractLinks(content string) []Link {
	matches := urlPattern.FindAllString(content, -1)
	seen := map[string]Link{}
	for _, candidate := range matches {
		link, ok := ParseLink(candidate)
		if !ok {
			continue
		}
		seen[link.NormalizedURL] = link
	}
	links := make([]Link, 0, len(seen))
	for _, link := range seen {
		links = append(links, link)
	}
	sort.Slice(links, func(i, j int) bool { return links[i].NormalizedURL < links[j].NormalizedURL })
	return links
}

func ParseLink(raw string) (Link, bool) {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimRight(trimmed, ".,;:!?)\"]}")
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return Link{}, false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return Link{}, false
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "figma.com" && host != "www.figma.com" {
		return Link{}, false
	}
	parts := strings.Split(strings.Trim(parsed.EscapedPath(), "/"), "/")
	if len(parts) < 2 {
		return Link{}, false
	}
	kind := parts[0]
	if kind != "file" && kind != "design" && kind != "proto" {
		return Link{}, false
	}
	fileKey, err := url.PathUnescape(parts[1])
	if err != nil || strings.TrimSpace(fileKey) == "" {
		return Link{}, false
	}
	nodeID := strings.TrimSpace(parsed.Query().Get("node-id"))
	if nodeID != "" {
		nodeID = strings.ReplaceAll(nodeID, "-", ":")
	}
	normalized := url.URL{Scheme: "https", Host: "www.figma.com", Path: "/" + kind + "/" + fileKey}
	if nodeID != "" {
		query := url.Values{}
		query.Set("node-id", nodeID)
		normalized.RawQuery = query.Encode()
	}
	return Link{Kind: kind, FileKey: fileKey, NodeID: nodeID, URL: trimmed, NormalizedURL: normalized.String()}, true
}

func SyncSources(ctx context.Context, tx pgx.Tx, target SyncTarget, content string) error {
	containerType := strings.TrimSpace(target.ContainerType)
	if containerType == "" {
		containerType = "issue_description"
	}
	if target.CommentID == "" {
		if _, err := tx.Exec(ctx, `delete from figma_source where workspace_id=$1::uuid and issue_id=$2::uuid and container_type=$3 and comment_id is null`, target.WorkspaceID, target.IssueID, containerType); err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(ctx, `delete from figma_source where workspace_id=$1::uuid and issue_id=$2::uuid and container_type=$3 and comment_id=$4::uuid`, target.WorkspaceID, target.IssueID, containerType, target.CommentID); err != nil {
			return err
		}
	}
	for _, link := range ExtractLinks(content) {
		name := defaultName(link)
		if target.CommentID == "" {
			if _, err := tx.Exec(ctx, `insert into figma_source (workspace_id, issue_id, container_type, source_url, normalized_url, file_key, node_id, kind, name, captured_at, updated_at) values ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,now(),now())`, target.WorkspaceID, target.IssueID, containerType, link.URL, link.NormalizedURL, link.FileKey, nullString(link.NodeID), link.Kind, name); err != nil {
				return err
			}
			continue
		}
		if _, err := tx.Exec(ctx, `insert into figma_source (workspace_id, issue_id, comment_id, container_type, source_url, normalized_url, file_key, node_id, kind, name, captured_at, updated_at) values ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,now(),now())`, target.WorkspaceID, target.IssueID, target.CommentID, containerType, link.URL, link.NormalizedURL, link.FileKey, nullString(link.NodeID), link.Kind, name); err != nil {
			return err
		}
	}
	return nil
}

func ScanSource(row pgx.Row) (Source, error) {
	var source Source
	var nodeID, name, thumbnailURL, lastError *string
	var capturedAt time.Time
	var refreshedAt *time.Time
	err := row.Scan(&source.ID, &source.URL, &source.NormalizedURL, &source.FileKey, &nodeID, &source.Kind, &name, &thumbnailURL, &source.ContainerType, &capturedAt, &refreshedAt, &lastError)
	if err != nil {
		return Source{}, err
	}
	source.NodeID = nodeID
	source.Name = name
	source.ThumbnailURL = thumbnailURL
	source.CapturedAt = capturedAt.UTC().Format(time.RFC3339)
	if refreshedAt != nil {
		formatted := refreshedAt.UTC().Format(time.RFC3339)
		source.RefreshedAt = &formatted
	}
	source.LastError = lastError
	return source, nil
}

func ScanSources(rows pgx.Rows) ([]Source, error) {
	defer rows.Close()
	sources := []Source{}
	for rows.Next() {
		source, err := ScanSource(rows)
		if err != nil {
			return nil, err
		}
		sources = append(sources, source)
	}
	return sources, rows.Err()
}

func SourceColumns(prefix string) string {
	return prefix + `id::text, ` + prefix + `source_url, ` + prefix + `normalized_url, ` + prefix + `file_key, ` + prefix + `node_id, ` + prefix + `kind, ` + prefix + `name, ` + prefix + `thumbnail_url, ` + prefix + `container_type, ` + prefix + `captured_at, ` + prefix + `refreshed_at, ` + prefix + `last_error`
}

func defaultName(link Link) string {
	switch link.Kind {
	case "proto":
		return "Figma prototype"
	case "design":
		return "Figma design"
	default:
		return "Figma file"
	}
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
