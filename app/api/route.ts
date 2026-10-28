import { NextRequest, NextResponse } from "next/server";
import { BigQuery } from "@google-cloud/bigquery";

function getBigQueryClient() {
  if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
    try {
      const credentials =
        typeof process.env.GCP_SERVICE_ACCOUNT_KEY === "string"
          ? JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY)
          : process.env.GCP_SERVICE_ACCOUNT_KEY;

      return new BigQuery({
        projectId:
          credentials.project_id ||
          process.env.GCP_PROJECT_ID ||
          "play-ezygamers-512305",
        credentials: {
          client_email: credentials.client_email,
          private_key: credentials.private_key?.replace(/\\n/g, "\n"),
        },
      });
    } catch (e) {
      console.error("Failed to parse GCP_SERVICE_ACCOUNT_KEY in route.ts:", e);
    }
  }

  return new BigQuery({
    projectId: process.env.GCP_PROJECT_ID || "play-ezygamers-512305",
  });
}

const bigquery = getBigQueryClient();
const EVENTS_TABLE = "`play-ezygamers-512305.analytics_557900460.events_*`";

function cleanParam(val: string | null): string {
  if (
    !val ||
    val === "all" ||
    val === "All Games" ||
    val === "All Devices" ||
    val === "All Sources" ||
    val === "All Games (Platform)"
  ) {
    return "all";
  }
  return val.replace(/['"]/g, "");
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const game = cleanParam(searchParams.get("game"));
    const device = cleanParam(searchParams.get("device"));
    const source = cleanParam(searchParams.get("source"));

    let conditions: string[] = ["1 = 1"];
    const queryParams: Record<string, any> = {};

    if (startDate && endDate) {
      const startClean = startDate.replace(/-/g, "");
      const endClean = endDate.replace(/-/g, "");
      conditions.push(
        "(_TABLE_SUFFIX BETWEEN @startClean AND @endClean OR _TABLE_SUFFIX LIKE 'intraday_%')"
      );
      queryParams.startClean = startClean;
      queryParams.endClean = endClean;
    }

    if (game !== "all") {
      conditions.push(
        "(SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'game_title') = @game"
      );
      queryParams.game = game;
    }
    if (device !== "all") {
      conditions.push("device.category = @device");
      queryParams.device = device;
    }
    if (source !== "all") {
      conditions.push("traffic_source.source = @source");
      queryParams.source = source;
    }

    const whereClause = conditions.join(" AND ");

    const query = `
      WITH base_events AS (
        SELECT
          event_name,
          user_pseudo_id,
          event_date,
          TIMESTAMP_MICROS(event_timestamp) as event_time,
          device.category AS device_category,
          geo.city AS geo_city,
          geo.country AS geo_country,
          traffic_source.source AS traffic_source,
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'game_title') AS game_title,
          (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id,
          (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec') AS dwell_time
        FROM ${EVENTS_TABLE}
        WHERE ${whereClause}
      )
      SELECT
        COUNT(DISTINCT user_pseudo_id) AS dau,
        COUNT(DISTINCT CASE 
          WHEN event_date >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE("Asia/Kolkata"), INTERVAL 7 DAY)) 
          THEN user_pseudo_id END
        ) AS wau,
        COUNT(DISTINCT CASE 
          WHEN event_date >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE("Asia/Kolkata"), INTERVAL 30 DAY)) 
          THEN user_pseudo_id END
        ) AS mau,
        COUNT(DISTINCT CONCAT(user_pseudo_id, CAST(session_id AS STRING))) AS sessions,
        COUNT(CASE WHEN event_name = 'game_start' THEN 1 END) AS gameStarts,
        COUNT(CASE WHEN event_name = 'page_view' THEN 1 END) AS catalogViews,
        COUNT(CASE WHEN event_name = 'game_select' THEN 1 END) AS previewOpens,
        COUNT(CASE WHEN event_name = 'game_complete' THEN 1 END) AS gameCompletes,
        COALESCE(AVG(dwell_time) / 1000.0, 0) AS avgDwellSec
      FROM base_events;

      -- Query 2: Dynamic Game Titles
      SELECT DISTINCT 
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'game_title') AS game_title
      FROM ${EVENTS_TABLE}
      WHERE (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'game_title') IS NOT NULL;

      -- Query 3: Game Rankings
      SELECT
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'game_title') AS game_title,
        COUNT(CASE WHEN event_name = 'game_start' THEN 1 END) AS plays,
        COUNT(DISTINCT user_pseudo_id) AS unique_players
      FROM ${EVENTS_TABLE}
      WHERE ${whereClause}
        AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'game_title') IS NOT NULL
      GROUP BY 1
      ORDER BY plays DESC
      LIMIT 10;

      -- Query 4: Geo Breakdown
      SELECT
        COALESCE(NULLIF(geo.city, ''), 'Unknown') AS city,
        COALESCE(NULLIF(geo.country, ''), 'Unknown') AS country,
        COUNT(DISTINCT user_pseudo_id) AS users,
        COUNT(CASE WHEN event_name = 'game_start' THEN 1 END) AS plays
      FROM ${EVENTS_TABLE}
      WHERE ${whereClause}
      GROUP BY 1, 2
      ORDER BY users DESC
      LIMIT 10;

      -- Query 5: Acquisition Source Breakdown
      SELECT
        COALESCE(NULLIF(traffic_source.source, ''), '(direct)') AS source_name,
        COUNT(DISTINCT user_pseudo_id) AS users,
        COUNT(DISTINCT CONCAT(user_pseudo_id, CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING))) AS sessions
      FROM ${EVENTS_TABLE}
      WHERE ${whereClause}
      GROUP BY 1
      ORDER BY sessions DESC
      LIMIT 10;
    `;

    const [results] = await bigquery.query({
      query,
      params: queryParams,
    });

    const metricsRow = Array.isArray(results[0]) ? results[0][0] : results[0] || {};
    const gameRows = results[1] || [];
    const rankingsRows = results[2] || [];
    const geoRows = results[3] || [];
    const acquisitionRows = results[4] || [];

    const catalogViews = Number(metricsRow.catalogViews || 0);
    const previewOpens = Number(metricsRow.previewOpens || 0);
    const catalogDropOff =
      catalogViews > 0
        ? Math.max(0, ((catalogViews - previewOpens) / catalogViews) * 100)
        : 0;

    const gameList = gameRows
      .map((r: any) => r.game_title)
      .filter((title: string | null) => Boolean(title));

    return NextResponse.json({
      success: true,
      metrics: {
        dau: Number(metricsRow.dau || 0),
        wau: Number(metricsRow.wau || 0),
        mau: Number(metricsRow.mau || 0),
        sessions: Number(metricsRow.sessions || 0),
        gameStarts: Number(metricsRow.gameStarts || 0),
        catalogViews,
        previewOpens,
        gameCompletes: Number(metricsRow.gameCompletes || 0),
        catalogDropOff,
        avgDwellSec: Number(metricsRow.avgDwellSec || 0),
      },
      games: gameList,
      rankings: rankingsRows,
      geo: geoRows,
      acquisition: acquisitionRows,
    });
  } catch (error: any) {
    console.error("Telemetry API Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}