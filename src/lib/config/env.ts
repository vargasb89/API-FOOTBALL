import { loadEnvConfig } from "@next/env";
import fs from "fs";
import path from "path";
import { z } from "zod";

loadEnvConfig(process.cwd());

const envSchema = z.object({
  API_FOOTBALL_KEY: z.string().min(1, "API_FOOTBALL_KEY is required"),
  API_FOOTBALL_BASE_URL: z
    .string()
    .url()
    .default("https://v3.football.api-sports.io"),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  CRON_SECRET: z.string().optional(),
  MAIN_LEAGUE_IDS: z.string().optional(),
  DEFAULT_SEASON: z.coerce.number().default(new Date().getFullYear())
});

let cachedEnv: z.infer<typeof envSchema> | null = null;

function findEnvFile(fileName: string) {
  let currentDir = process.cwd();

  while (true) {
    const candidate = path.join(currentDir, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  const workspaceCandidate = path.resolve(
    "C:\\Users\\USUARIO\\OneDrive\\Documentos\\Playground",
    fileName
  );

  return fs.existsSync(workspaceCandidate) ? workspaceCandidate : null;
}

function readEnvFileValue(key: string) {
  const candidates = [".env.local", ".env"];

  for (const fileName of candidates) {
    const filePath = findEnvFile(fileName);

    if (!filePath) {
      continue;
    }

    const content = fs.readFileSync(filePath, "utf8");
    const line = content
      .split(/\r?\n/)
      .find((entry) => entry.trim().startsWith(`${key}=`));

    if (line) {
      return line.slice(line.indexOf("=") + 1).trim();
    }
  }

  return undefined;
}

export function getEnv() {
  if (!cachedEnv) {
    const apiFootballKey =
      process.env.API_FOOTBALL_KEY ?? readEnvFileValue("API_FOOTBALL_KEY");
    const apiFootballBaseUrl =
      process.env.API_FOOTBALL_BASE_URL ?? readEnvFileValue("API_FOOTBALL_BASE_URL");
    const databaseUrl = process.env.DATABASE_URL ?? readEnvFileValue("DATABASE_URL");
    const redisUrl = process.env.REDIS_URL ?? readEnvFileValue("REDIS_URL");
    const cronSecret = process.env.CRON_SECRET ?? readEnvFileValue("CRON_SECRET");
    const mainLeagueIds =
      process.env.MAIN_LEAGUE_IDS ?? readEnvFileValue("MAIN_LEAGUE_IDS");
    const defaultSeason =
      process.env.DEFAULT_SEASON ?? readEnvFileValue("DEFAULT_SEASON");

    cachedEnv = envSchema.parse({
      API_FOOTBALL_KEY: apiFootballKey,
      API_FOOTBALL_BASE_URL: apiFootballBaseUrl,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      CRON_SECRET: cronSecret,
      MAIN_LEAGUE_IDS: mainLeagueIds,
      DEFAULT_SEASON: defaultSeason
    });
  }

  return cachedEnv;
}

export function getMainLeagueIds() {
  const env = getEnv();

  return (
    env.MAIN_LEAGUE_IDS?.split(",")
      .map((value) => Number(value.trim()))
      .filter(Number.isFinite) ?? []
  );
}
