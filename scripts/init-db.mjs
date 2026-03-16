import fs from "fs";
import path from "path";
import process from "process";
import nextEnv from "@next/env";
import { Pool } from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const schemaPath = path.resolve(process.cwd(), "db", "schema.sql");
const schemaSql = fs.readFileSync(schemaPath, "utf8");

const pool = new Pool({
  connectionString: databaseUrl
});

try {
  const client = await pool.connect();

  try {
    await client.query(schemaSql);
    console.log("Database schema initialized successfully.");
  } finally {
    client.release();
  }
} catch (error) {
  console.error("Failed to initialize database schema.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
