import { defineConfig } from "drizzle-kit";
import { getDatabaseUrl } from "./src/lib/db/connection-string";

const url = getDatabaseUrl();
const needsSsl = process.env.DB_SSL === "true";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      needsSsl && !url.includes("sslmode")
        ? `${url}${url.includes("?") ? "&" : "?"}sslmode=no-verify`
        : url,
  },
});
