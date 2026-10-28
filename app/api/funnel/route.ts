import { NextRequest, NextResponse } from "next/server";
import { BigQuery } from "@google-cloud/bigquery";

function getBigQueryClient() {
  if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
    try {
      const credentials = typeof process.env.GCP_SERVICE_ACCOUNT_KEY === "string"
        ? JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY)
        : process.env.GCP_SERVICE_ACCOUNT_KEY;

      return new BigQuery({
        projectId: credentials.project_id || process.env.GCP_PROJECT_ID || "gen-lang-client-0375476077",
        credentials: {
          client_email: credentials.client_email,
          private_key: credentials.private_key?.replace(/\\n/g, "\n"),
        },
      });
    } catch (e) {
      console.error("Failed to parse GCP_SERVICE_ACCOUNT_KEY in funnel/route.ts:", e);
    }
  }

  return new BigQuery({
    projectId: process.env.GCP_PROJECT_ID || "gen-lang-client-0375476077",
  });
}

const bigquery = getBigQueryClient();

const EVENTS_TABLE = "`gen-lang-client-0375476077.analytics_telemetry.events_snapshot`";

function cleanParam(val: string | null): string {
  if (!val || val === "all" || val === "All Games" || val === "All Devices" || val === "All Sources") {
    return "all";
  }
  return val.replace(/'/g, "''");
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const days = searchParams.get("days") || "30";
  const device = cleanParam(searchParams.get("device"));
  const game = cleanParam(searchParams.get("game"));
  const country = cleanParam(searchParams.get("country"));
  const source = cleanParam(searchParams.get("source"));

  try {
    const [latestRows] = await bigquery.query({
      query: `
        SELECT
          MAX(PARSE_DATE('%Y%m%d', event_date)) AS max_date,
          MAX(event_timestamp) AS max_timestamp
        FROM ${EVENTS_TABLE}
      `,
      location: "asia-south1",
    });

    const latestDate =
      latestRows?.[0]?.max_date?.value ||
      latestRows?.[0]?.max_date ||
      "2026-10-26";

    let dateWhere = "";
    if (startDate && endDate) {
      const s = startDate.replace(/-/g, "");
      const e = endDate.replace(/-/g, "");
      dateWhere = `AND event_date BETWEEN '${s}' AND '${e}'`;
    } else if (days !== "all") {
      const n = Math.max(1, Math.min(parseInt(days, 10) || 30, 365));
      dateWhere = `
        AND PARSE_DATE('%Y%m%d', event_date)
            BETWEEN DATE_SUB(DATE '${latestDate}', INTERVAL ${n - 1} DAY)
                AND DATE '${latestDate}'
      `;
    }

    const deviceFilter = device !== "all" ? `AND device.category = '${device}'` : "";
    const countryFilter = country !== "all" ? `AND COALESCE(geo.country, 'Unknown') = '${country}'` : "";
    const sourceFilter = source !== "all" ? `AND COALESCE(traffic_source.source, '(direct)') = '${source}'` : "";

    const query = `
      WITH EventStream AS (
        SELECT
          user_pseudo_id,
          event_name,
          event_timestamp,
          PARSE_DATE('%Y%m%d', event_date) AS event_date,
          COALESCE(
            CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING),
            'no_session'
          ) AS session_id_param,
          COALESCE((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec'), 0) AS engagement_msec,
          COALESCE(
            (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'game_id'),
            (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'game_name'),
            'Unspecified'
          ) AS game_id
        FROM ${EVENTS_TABLE}
        WHERE 1=1
          ${dateWhere}
          ${deviceFilter}
          ${countryFilter}
          ${sourceFilter}
      ),

      SessionAggregates AS (
        SELECT
          CONCAT(user_pseudo_id, '-', session_id_param) AS session_id,
          user_pseudo_id,
          MAX(IF(event_name IN ('page_view','session_start'), 1, 0)) AS step_landing,
          MAX(IF(event_name = 'preview_open', 1, 0)) AS step_preview,
          MAX(IF(event_name = 'game_start', 1, 0)) AS step_play,
          MAX(IF(
            event_name = 'preview_open' AND ('${game}' = 'all' OR game_id = '${game}'), 1, 0
          )) AS step_game_preview,
          MAX(IF(
            event_name = 'game_start' AND ('${game}' = 'all' OR game_id = '${game}'), 1, 0
          )) AS step_game_play,
          ARRAY_AGG(DISTINCT IF(game_id != 'Unspecified', game_id, NULL) IGNORE NULLS) AS all_interacted_games
        FROM EventStream
        GROUP BY 1, 2
      ),

      FilteredSessions AS (
        SELECT *
        FROM SessionAggregates
        WHERE
          '${game}' = 'all'
          OR '${game}' IN UNNEST(all_interacted_games)
          OR step_game_preview = 1
          OR step_game_play = 1
      )

      SELECT
        COUNT(DISTINCT session_id) AS total_sessions,
        COUNT(DISTINCT IF(step_landing = 1, session_id, NULL)) AS landing_sessions,
        COUNT(DISTINCT IF(step_landing = 1 AND (IF('${game}' = 'all', step_preview = 1, step_game_preview = 1 OR step_preview = 1)), session_id, NULL)) AS preview_sessions,
        COUNT(DISTINCT IF(step_landing = 1 AND (IF('${game}' = 'all', step_play = 1, step_game_play = 1)), session_id, NULL)) AS play_sessions
      FROM FilteredSessions
    `;

    const [rows] = await bigquery.query({ query, location: "asia-south1" });

    return NextResponse.json({ data: rows[0] || {} });
  } catch (error: any) {
    console.error("Funnel BigQuery Error:", error);
    return NextResponse.json({ error: error?.message || "Failed to query funnel data" }, { status: 500 });
  }
}