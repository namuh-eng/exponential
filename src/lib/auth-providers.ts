type OAuthEnvConfig = {
  clientId: string;
  clientSecret: string;
};

function getOAuthEnvConfig(clientIdKey: string, clientSecretKey: string) {
  const clientId = process.env[clientIdKey];
  const clientSecret = process.env[clientSecretKey];

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret } satisfies OAuthEnvConfig;
}

export function getGoogleOAuthConfig() {
  return getOAuthEnvConfig("AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET");
}

export function getGitHubOAuthConfig() {
  return getOAuthEnvConfig("AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET");
}

export function getGitLabOAuthConfig() {
  return getOAuthEnvConfig("AUTH_GITLAB_ID", "AUTH_GITLAB_SECRET");
}

export function getSlackOAuthConfig() {
  return getOAuthEnvConfig("AUTH_SLACK_ID", "AUTH_SLACK_SECRET");
}

export function isGoogleOAuthConfigured() {
  return Boolean(getGoogleOAuthConfig());
}

export function isGitHubOAuthConfigured() {
  return Boolean(getGitHubOAuthConfig());
}

export function isGitLabOAuthConfigured() {
  return Boolean(getGitLabOAuthConfig());
}

export function isSlackOAuthConfigured() {
  return Boolean(getSlackOAuthConfig());
}
