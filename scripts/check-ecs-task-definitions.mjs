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
}
