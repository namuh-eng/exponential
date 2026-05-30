import { readFileSync } from "node:fs";

const required = [
  {
    file: "infra/ecs/api-task-definition.json",
    family: "exponential-api",
    container: "api",
    port: 7016,
  },
  {
    file: "infra/ecs/api-migrate-task-definition.json",
    family: "exponential-api-migrate",
    container: "api-migrate",
    imageIncludes: "exponential-api",
    noPort: true,
  },
  {
    file: "infra/ecs/web-task-definition.json",
    family: "exponential-web",
    container: "web",
    port: 3000,
  },
];

for (const item of required) {
  const doc = JSON.parse(readFileSync(item.file, "utf8"));
  if (doc.family !== item.family) throw new Error(`${item.file}: wrong family`);
  if (doc.networkMode !== "awsvpc")
    throw new Error(`${item.file}: must use awsvpc`);
  if (!doc.requiresCompatibilities?.includes("FARGATE"))
    throw new Error(`${item.file}: must require FARGATE`);
  const container = doc.containerDefinitions?.find(
    (entry) => entry.name === item.container,
  );
  if (!container)
    throw new Error(`${item.file}: missing container ${item.container}`);
  if (!item.noPort) {
    if (
      !container.portMappings?.some(
        (mapping) => mapping.containerPort === item.port,
      )
    ) {
      throw new Error(`${item.file}: missing port ${item.port}`);
    }
  }
  if (item.imageIncludes && !container.image?.includes(item.imageIncludes)) {
    throw new Error(`${item.file}: image must include ${item.imageIncludes}`);
  }
  if (container.logConfiguration?.logDriver !== "awslogs") {
    throw new Error(`${item.file}: missing CloudWatch awslogs config`);
  }
  if (container.logConfiguration.options?.["awslogs-create-group"] !== "true") {
    throw new Error(`${item.file}: awslogs must create missing log groups`);
  }
  const environmentNames = new Set(
    (container.environment ?? []).map((entry) => entry.name),
  );
  const secretNames = new Set(
    (container.secrets ?? []).map((entry) => entry.name),
  );
  if (item.container === "web") {
    for (const forbidden of ["DATABASE_URL", "EXPONENTIAL_API_DATABASE_URL"]) {
      if (environmentNames.has(forbidden) || secretNames.has(forbidden)) {
        throw new Error(`${item.file}: web task must not receive ${forbidden}`);
      }
    }
    if (environmentNames.has("DB_SSL")) {
      throw new Error(`${item.file}: web task must not receive DB_SSL`);
    }
    const apiUrl = container.environment?.find(
      (entry) => entry.name === "EXPONENTIAL_API_URL",
    )?.value;
    if (apiUrl !== "${WEB_INTERNAL_API_URL}") {
      throw new Error(
        `${item.file}: web EXPONENTIAL_API_URL must use WEB_INTERNAL_API_URL`,
      );
    }
  }
  if (item.container === "api" || item.container === "api-migrate") {
    if (!secretNames.has("EXPONENTIAL_API_DATABASE_URL")) {
      throw new Error(
        `${item.file}: ${item.container} must receive EXPONENTIAL_API_DATABASE_URL`,
      );
    }
  }
  if (item.container === "api") {
    if (!secretNames.has("EXPONENTIAL_SESSION_SECRET")) {
      throw new Error(
        `${item.file}: api must receive EXPONENTIAL_SESSION_SECRET`,
      );
    }
  }
}
