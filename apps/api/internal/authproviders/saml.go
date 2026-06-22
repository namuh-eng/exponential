package authproviders

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/crewjam/saml"
	"github.com/crewjam/saml/samlsp"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

const (
	samlRequestTTL    = 10 * time.Minute
	samlAssertionTTL  = 24 * time.Hour
	samlRequestPrefix = "saml-request:"
)

type samlWorkspace struct {
	ID       string
	Settings samlWorkspaceSettings
}

type samlWorkspaceSettings struct {
	Enabled     bool
	Domains     []string
	IDPSSOURL   string
	IDPEntityID string
	Certificate string
	MetadataURL string
	MetadataXML string
}

func (h Handler) SAMLMetadata(w http.ResponseWriter, r *http.Request) {
	sp, err := h.samlServiceProvider(r, samlWorkspaceSettings{})
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Build SAML metadata failed", err.Error())
		return
	}
	buf, err := xml.MarshalIndent(sp.Metadata(), "", "  ")
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Build SAML metadata failed", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/samlmetadata+xml")
	_, _ = w.Write(buf)
}

func (h Handler) samlDiscoveryRedirect(ctx context.Context, r *http.Request, domain, callbackURL string) (string, error) {
	workspace, err := h.findSAMLWorkspace(ctx, domain)
	if err != nil {
		return "", err
	}
	if workspace.ID == "" {
		return "", nil
	}
	sp, err := h.samlServiceProvider(r, workspace.Settings)
	if err != nil {
		return "", err
	}
	ssoURL := sp.GetSSOBindingLocation(saml.HTTPRedirectBinding)
	if ssoURL == "" {
		ssoURL = workspace.Settings.IDPSSOURL
	}
	if ssoURL == "" {
		return "", nil
	}
	authReq, err := sp.MakeAuthenticationRequest(ssoURL, saml.HTTPRedirectBinding, saml.HTTPPostBinding)
	if err != nil {
		return "", err
	}
	relayState := "saml_" + randomBase64URLAuth(18)
	identifier := samlRequestPrefix + workspace.ID + ":" + safeSAMLCallbackPath(r, callbackURL)
	_, err = h.DB.Exec(ctx, `insert into verification (id,identifier,value,expires_at,created_at,updated_at) values ($1,$2,$3,$4,now(),now())`, relayState, identifier, authReq.ID, time.Now().UTC().Add(samlRequestTTL))
	if err != nil {
		return "", err
	}
	redirectURL, err := authReq.Redirect(relayState, sp)
	if err != nil {
		return "", err
	}
	return redirectURL.String(), nil
}

func (h Handler) SAMLACS(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid SAML response."})
		return
	}
	relayState := strings.TrimSpace(r.Form.Get("RelayState"))
	if relayState == "" {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Missing SAML RelayState."})
		return
	}
	workspaceID, callbackURL, requestID, err := h.consumeSAMLRequest(r.Context(), relayState)
	if err != nil {
		problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": "SAML request expired or already used."})
		return
	}
	workspace, err := h.samlWorkspaceByID(r.Context(), workspaceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": "SAML workspace is not configured."})
			return
		}
		problem.Write(w, http.StatusInternalServerError, "SAML ACS failed", err.Error())
		return
	}
	if !workspace.Settings.Enabled {
		problem.JSON(w, http.StatusForbidden, map[string]string{"error": "SAML SSO is disabled for this workspace."})
		return
	}
	if !samlResponseUsesStrongSignature(r.Form.Get("SAMLResponse")) {
		problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": "SAML response must be signed with SHA-256 or stronger."})
		return
	}
	sp, err := h.samlServiceProvider(r, workspace.Settings)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "SAML ACS failed", err.Error())
		return
	}
	assertion, err := sp.ParseResponse(r, []string{requestID})
	if err != nil {
		problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid SAML assertion."})
		return
	}
	if err := h.recordSAMLAssertion(r.Context(), assertion.ID); err != nil {
		problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": "SAML assertion was already used."})
		return
	}
	emailAddr := strings.ToLower(strings.TrimSpace(samlAssertionEmail(assertion)))
	if emailAddr == "" || extractEmailDomain(emailAddr) == "" {
		problem.JSON(w, http.StatusUnauthorized, map[string]string{"error": "SAML assertion did not include a valid email address."})
		return
	}
	if !containsString(workspace.Settings.Domains, extractEmailDomain(emailAddr)) {
		problem.JSON(w, http.StatusForbidden, map[string]string{"error": "SAML email domain is not enabled for this workspace."})
		return
	}
	user, err := h.upsertEmailUser(r.Context(), emailAddr, samlAssertionName(assertion, emailAddr))
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create SAML user failed", err.Error())
		return
	}
	if err := h.attachSAMLWorkspaceMember(r.Context(), workspace.ID, user.ID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Attach SAML workspace member failed", err.Error())
		return
	}
	sessionToken, expires, err := h.createBrowserSession(r, user.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create user session failed", err.Error())
		return
	}
	setSessionCookie(w, r, sessionToken, expires)
	http.Redirect(w, r, postAuthCompletionURL(r, callbackURL), http.StatusFound)
}

func (h Handler) findSAMLWorkspace(ctx context.Context, domain string) (samlWorkspace, error) {
	rows, err := h.DB.Query(ctx, `select id::text,coalesce(settings,'{}'::jsonb) from workspace`)
	if err != nil {
		return samlWorkspace{}, err
	}
	defer rows.Close()
	var found samlWorkspace
	for rows.Next() {
		var id string
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return samlWorkspace{}, err
		}
		settings := readSAMLWorkspaceSettings(raw)
		if !settings.Enabled || !containsString(settings.Domains, domain) {
			continue
		}
		if found.ID != "" {
			return samlWorkspace{}, fmt.Errorf("multiple SAML workspaces match domain %q", domain)
		}
		found = samlWorkspace{ID: id, Settings: settings}
	}
	return found, rows.Err()
}

func (h Handler) samlWorkspaceByID(ctx context.Context, workspaceID string) (samlWorkspace, error) {
	var raw []byte
	var id string
	if err := h.DB.QueryRow(ctx, `select id::text,coalesce(settings,'{}'::jsonb) from workspace where id=$1::uuid limit 1`, workspaceID).Scan(&id, &raw); err != nil {
		return samlWorkspace{}, err
	}
	return samlWorkspace{ID: id, Settings: readSAMLWorkspaceSettings(raw)}, nil
}

func (h Handler) consumeSAMLRequest(ctx context.Context, relayState string) (string, string, string, error) {
	var identifier, requestID string
	err := h.DB.QueryRow(ctx, `delete from verification where id=$1 and expires_at > now() returning identifier,value`, relayState).Scan(&identifier, &requestID)
	if err != nil {
		return "", "", "", err
	}
	if !strings.HasPrefix(identifier, samlRequestPrefix) {
		return "", "", "", fmt.Errorf("invalid SAML request identifier")
	}
	parts := strings.SplitN(strings.TrimPrefix(identifier, samlRequestPrefix), ":", 2)
	if len(parts) != 2 || parts[0] == "" || requestID == "" {
		return "", "", "", fmt.Errorf("invalid SAML request identifier")
	}
	return parts[0], safeCallbackPath(parts[1]), requestID, nil
}

func safeSAMLCallbackPath(r *http.Request, value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "/"
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "/"
	}
	if !parsed.IsAbs() {
		return safeCallbackPath(value)
	}
	base, err := url.Parse(appURL(r))
	if err != nil || !strings.EqualFold(parsed.Scheme, base.Scheme) || !strings.EqualFold(parsed.Host, base.Host) {
		return "/"
	}
	path := parsed.EscapedPath()
	if path == "" {
		path = "/"
	}
	if parsed.RawQuery != "" {
		path += "?" + parsed.RawQuery
	}
	return safeCallbackPath(path)
}

func (h Handler) recordSAMLAssertion(ctx context.Context, assertionID string) error {
	assertionID = strings.TrimSpace(assertionID)
	if assertionID == "" {
		return fmt.Errorf("missing assertion ID")
	}
	sum := sha256.Sum256([]byte(assertionID))
	_, err := h.DB.Exec(ctx, `insert into verification (id,identifier,value,expires_at,created_at,updated_at) values ($1,'saml-assertion',$2,$3,now(),now())`, "saml_assertion_"+hex.EncodeToString(sum[:]), assertionID, time.Now().UTC().Add(samlAssertionTTL))
	return err
}

func (h Handler) attachSAMLWorkspaceMember(ctx context.Context, workspaceID, userID string) error {
	_, err := h.DB.Exec(ctx, `insert into member (user_id,workspace_id,role) values ($1,$2::uuid,'member') on conflict (user_id,workspace_id) do update set deleted_at=null, updated_at=now()`, userID, workspaceID)
	return err
}

func (h Handler) samlServiceProvider(r *http.Request, settings samlWorkspaceSettings) (*saml.ServiceProvider, error) {
	metadataURL, err := url.Parse(appURL(r) + "/api/auth/saml/metadata")
	if err != nil {
		return nil, err
	}
	acsURL, err := url.Parse(appURL(r) + "/api/auth/saml/acs")
	if err != nil {
		return nil, err
	}
	sp := &saml.ServiceProvider{
		EntityID:           metadataURL.String(),
		MetadataURL:        *metadataURL,
		AcsURL:             *acsURL,
		AuthnNameIDFormat:  saml.EmailAddressNameIDFormat,
		AllowIDPInitiated:  false,
		DefaultRedirectURI: "/",
	}
	if settings.Enabled || settings.IDPSSOURL != "" || settings.MetadataXML != "" || settings.Certificate != "" {
		metadata, err := samlIDPMetadata(r.Context(), settings)
		if err != nil {
			return nil, err
		}
		sp.IDPMetadata = metadata
	}
	return sp, nil
}

func samlIDPMetadata(ctx context.Context, settings samlWorkspaceSettings) (*saml.EntityDescriptor, error) {
	if strings.TrimSpace(settings.MetadataXML) != "" {
		return samlsp.ParseMetadata([]byte(settings.MetadataXML))
	}
	if strings.TrimSpace(settings.MetadataURL) != "" {
		metadataURL, err := url.Parse(settings.MetadataURL)
		if err != nil {
			return nil, err
		}
		return samlsp.FetchMetadata(ctx, http.DefaultClient, *metadataURL)
	}
	metadataXML := syntheticSAMLMetadata(settings)
	if metadataXML == "" {
		return nil, fmt.Errorf("SAML IdP metadata is incomplete")
	}
	return samlsp.ParseMetadata([]byte(metadataXML))
}

func syntheticSAMLMetadata(settings samlWorkspaceSettings) string {
	entityID := xmlEscape(strings.TrimSpace(settings.IDPEntityID))
	ssoURL := xmlEscape(strings.TrimSpace(settings.IDPSSOURL))
	cert := strings.TrimSpace(normalizeSAMLCertificate(settings.Certificate))
	if entityID == "" || ssoURL == "" || cert == "" {
		return ""
	}
	return `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="` + entityID + `"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>` + cert + `</X509Certificate></X509Data></KeyInfo></KeyDescriptor><NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="` + ssoURL + `"/></IDPSSODescriptor></EntityDescriptor>`
}

func readSAMLWorkspaceSettings(raw []byte) samlWorkspaceSettings {
	root := map[string]any{}
	_ = json.Unmarshal(raw, &root)
	security := asRecordAny(root["security"])
	samlRecord := asRecordAny(firstNonNilAuth(security["saml"], root["saml"], root["sso"]))
	return samlWorkspaceSettings{
		Enabled:     boolValueDefault(samlRecord["enabled"], false),
		Domains:     normalizeSAMLDiscoveryDomains(firstNonNilAuth(samlRecord["domains"], samlRecord["emailDomains"])),
		IDPSSOURL:   firstStringAuth(samlRecord["idpSsoUrl"], samlRecord["ssoUrl"], samlRecord["ssoURL"], samlRecord["url"]),
		IDPEntityID: firstStringAuth(samlRecord["entityId"], samlRecord["idpEntityId"]),
		Certificate: firstStringAuth(samlRecord["certificate"], samlRecord["signingCertificate"]),
		MetadataURL: firstStringAuth(samlRecord["metadataUrl"]),
		MetadataXML: firstStringAuth(samlRecord["metadataXml"], samlRecord["metadataXML"]),
	}
}

func samlResponseUsesStrongSignature(encoded string) bool {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return false
	}
	lower := strings.ToLower(string(decoded))
	if !strings.Contains(lower, "signaturemethod") {
		return false
	}
	if strings.Contains(lower, "rsa-sha1") || strings.Contains(lower, "dsa-sha1") || strings.Contains(lower, "ecdsa-sha1") || strings.Contains(lower, "#sha1") {
		return false
	}
	return strings.Contains(lower, "rsa-sha256") || strings.Contains(lower, "rsa-sha384") || strings.Contains(lower, "rsa-sha512") || strings.Contains(lower, "ecdsa-sha256") || strings.Contains(lower, "ecdsa-sha384") || strings.Contains(lower, "ecdsa-sha512")
}

func samlAssertionEmail(assertion *saml.Assertion) string {
	for _, name := range []string{"email", "Email", "mail", "emailAddress", "User.email", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"} {
		if value := samlAssertionAttribute(assertion, name); value != "" {
			return value
		}
	}
	if assertion.Subject != nil && assertion.Subject.NameID != nil && strings.Contains(assertion.Subject.NameID.Value, "@") {
		return assertion.Subject.NameID.Value
	}
	return ""
}

func samlAssertionName(assertion *saml.Assertion, email string) string {
	for _, name := range []string{"name", "Name", "displayName", "cn", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"} {
		if value := samlAssertionAttribute(assertion, name); value != "" {
			return value
		}
	}
	return strings.Split(email, "@")[0]
}

func samlAssertionAttribute(assertion *saml.Assertion, name string) string {
	if assertion == nil {
		return ""
	}
	for _, statement := range assertion.AttributeStatements {
		for _, attr := range statement.Attributes {
			if attr.Name != name && attr.FriendlyName != name {
				continue
			}
			for _, value := range attr.Values {
				if strings.TrimSpace(value.Value) != "" {
					return strings.TrimSpace(value.Value)
				}
				if value.NameID != nil && strings.TrimSpace(value.NameID.Value) != "" {
					return strings.TrimSpace(value.NameID.Value)
				}
			}
		}
	}
	return ""
}

func normalizeSAMLCertificate(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "-----BEGIN CERTIFICATE-----", "")
	value = strings.ReplaceAll(value, "-----END CERTIFICATE-----", "")
	value = strings.TrimSpace(value)
	return regexp.MustCompile(`\s+`).ReplaceAllString(value, "")
}

func xmlEscape(value string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(value))
	return b.String()
}

func fetchSAMLMetadataXML(ctx context.Context, rawURL string) (string, error) {
	metadataURL, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, metadataURL.String(), nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("metadata URL returned HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	return string(data), nil
}
