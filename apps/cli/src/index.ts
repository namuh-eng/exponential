#!/usr/bin/env node
import { createExponentialClient } from "@exponential/sdk";

const [resource, action = "list"] = process.argv.slice(2);
const token = process.env.EXPONENTIAL_TOKEN;
const baseUrl = process.env.EXPONENTIAL_API_URL ?? "http://localhost:3016/v1";

if (!token) {
  console.error("EXPONENTIAL_TOKEN is required");
  process.exit(1);
}

const client = createExponentialClient({ token, baseUrl });

if (resource === "issues" && action === "list") {
  const { data, error } = await client.GET("/issues", {});
  if (error) {
    console.error(JSON.stringify(error));
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
} else {
  console.error("Usage: exponential issues list");
  process.exit(1);
}
