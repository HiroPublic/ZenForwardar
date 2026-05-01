import "dotenv/config";
import { z } from "zod";

export const EnvSchema = z.object({
  APP_URL: envDefault("http://localhost:3000"),
  SESSION_SECRET: envDefault("dev-session-secret-change-me"),
  GOOGLE_CLIENT_ID: envOptional(),
  GOOGLE_CLIENT_SECRET: envOptional(),
  GOOGLE_REDIRECT_URI: envDefault("http://localhost:3000/auth/google/callback"),
  GMAIL_AUTH_ACCOUNT: envDefault("user@example.com").pipe(z.string().email()),
  FORWARD_FROM_EMAIL: envDefault("sender@example.com").pipe(z.string().email()),
  OPENAI_API_KEY: envOptional(),
  OPENAI_MODEL: envDefault("gpt-4.1-mini"),
  NOTION_API_KEY: envOptional(),
  NOTION_HOTEL_RESERVATION_DATABASE_ID: envOptional(),
  TRIPIT_FORWARD_EMAIL: envDefault("plans@tripit.com").pipe(z.string().email()),
  HOTELSLASH_FORWARD_EMAIL: envDefault("save@hotelslash.com").pipe(z.string().email()),
  EXCHANGE_RATE_API_KEY: envOptional(),
  EXCHANGE_RATE_PROVIDER: envDefault("mock")
});

export function parseConfig(env: NodeJS.ProcessEnv) {
  return EnvSchema.parse(env);
}

export const config = parseConfig(process.env);

export const isLiveMode =
  Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) &&
  Boolean(config.OPENAI_API_KEY) &&
  Boolean(config.NOTION_API_KEY && config.NOTION_HOTEL_RESERVATION_DATABASE_ID);

function envDefault(value: string) {
  return z.preprocess((input) => (input === "" || input === undefined ? value : input), z.string());
}

function envOptional() {
  return z.preprocess((input) => (input === "" ? undefined : input), z.string().optional());
}
