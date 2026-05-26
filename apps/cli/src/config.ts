import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type CliConfig = {
  token?: string;
  baseUrl?: string;
};

export function configPath(env: NodeJS.ProcessEnv = process.env) {
  const configHome =
    env.EXPONENTIAL_CONFIG_HOME ?? join(homedir(), ".config", "exponential");
  return join(configHome, "config.json");
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
  try {
    return JSON.parse(readFileSync(configPath(env), "utf8")) as CliConfig;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }
    throw error;
  }
}

export function writeConfig(
  config: CliConfig,
  env: NodeJS.ProcessEnv = process.env,
) {
  const path = configPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function resolveToken(env: NodeJS.ProcessEnv = process.env) {
  return env.EXPONENTIAL_TOKEN ?? readConfig(env).token;
}

export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.EXPONENTIAL_API_URL ??
    readConfig(env).baseUrl ??
    "http://localhost:7016/v1"
  );
}

export function assertPatToken(token: string) {
  if (!token.startsWith("pat_")) {
    throw new Error(
      "--token must be a personal access token starting with pat_",
    );
  }
  return token;
}
