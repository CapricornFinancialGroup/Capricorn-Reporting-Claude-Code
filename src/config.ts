// Env-driven configuration: read once at startup, validate, expose a typed object.
// In production these come from App Service application settings; locally from .env (via tsx/dotenv
// is not used — export them in the shell or use `npm run dev` with a .env loader of your choice;
// simplest is `set -a; source .env; set +a`).

export interface Config {
  port: number;
  nodeEnv: string;
  logLevel: string;

  /** The Capricorn Fabric lakehouse share (read-only). */
  fabric: {
    /** Fabric SQL endpoint FQDN (…datawarehouse.fabric.microsoft.com). */
    endpoint: string;
    /** Lakehouse SQL database name, e.g. GAGold_Capricorn. */
    database: string;
  };

  /** When set, bypasses App Service Easy Auth and treats this email as the viewer (local dev only). */
  devUserEmail: string | null;

  reporting: {
    /** Shared secret the kiosk surface requires (query `?k=` or `x-kiosk-token` header). Empty = kiosk disabled. */
    kioskToken: string;
    /** Client poll interval for live data (seconds). */
    refreshSeconds: number;
    /** Kiosk auto-rotate dwell per screen (seconds). */
    cycleSeconds: number;
    /** Business timezone for the day clock (handles BST automatically via Intl). */
    timeZone: string;
    /** Pacing model: "mtd" (month-to-date, day-grained — the honest default for a nightly lake). */
    pacingMode: "mtd" | "drip";
    /** Server-side dataset cache TTL (seconds). */
    cacheTtlSeconds: number;
  };

  /** Weekly targets upload (item 1, 2026-07-07). */
  targets: {
    /** Lower-cased emails allowed to upload targets. Empty = upload disabled (fails closed). */
    adminEmails: string[];
    /** Blob storage account name holding the `weekly-targets` container. Empty = upload/hydrate
     *  disabled — the app falls back to the domain/targets.ts placeholders, same as before this
     *  feature existed. */
    storageAccount: string;
  };
}

function optional(value: string | undefined, fallback: string): string {
  return value && value.trim() !== "" ? value : fallback;
}

export function loadConfig(): Config {
  return {
    port: parseInt(optional(process.env.PORT ?? process.env.WEBSITES_PORT, "3000"), 10),
    nodeEnv: optional(process.env.NODE_ENV, "development"),
    logLevel: optional(process.env.LOG_LEVEL, "info"),

    fabric: {
      endpoint: optional(
        process.env.FABRIC_SQL_ENDPOINT,
        "t43woyvlppeu7nhsptsxhz7zwq-43nhrvmg2hze7j3vqn2euun35u.datawarehouse.fabric.microsoft.com",
      ),
      database: optional(process.env.FABRIC_DATABASE, "GAGold_Capricorn"),
    },

    devUserEmail: process.env.DEV_USER_EMAIL?.trim() || null,

    reporting: {
      kioskToken: process.env.REPORTING_KIOSK_TOKEN ?? "",
      refreshSeconds: parseInt(optional(process.env.REPORTING_REFRESH_SECONDS, "60"), 10),
      cycleSeconds: parseInt(optional(process.env.REPORTING_CYCLE_SECONDS, "20"), 10),
      timeZone: optional(process.env.REPORTING_TIMEZONE, "Europe/London"),
      pacingMode: process.env.PACING_MODE === "drip" ? "drip" : "mtd",
      cacheTtlSeconds: parseInt(optional(process.env.REPORTING_CACHE_TTL_SECONDS, "45"), 10),
    },

    targets: {
      adminEmails: (process.env.TARGETS_ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
      storageAccount: process.env.TARGETS_STORAGE_ACCOUNT?.trim() || "",
    },
  };
}
