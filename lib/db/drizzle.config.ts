import { defineConfig } from "drizzle-kit";
import path from "path";

// Fall back to the repo-root .env when DATABASE_URL isn't already exported.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(path.join(__dirname, "../../.env"));
  } catch {
    // No .env file — the check below reports the missing variable.
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
