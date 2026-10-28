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
    val.includes("All Games") ||
    val.includes("All Devices") ||
    val.includes("All Sources") ||
    val.includes("All Platforms")
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
        `COALESCE(
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key IN ('game_title', 'game_name', 'game', 'item_name')),
          REGEXP_EXTRACT((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'), r'/games?/([^/?#]+)')
        ) = @game`
      );
      queryParams.game = game;
    }
    if (device !== "all") {
      conditions.push("device.category = @device");
      queryParams.device = device;
    }
    if (source !== "all") {
      conditions.push("COALESCE(traffic_source.source, '(direct)') = @source");
      queryParams.source = source;
    }

    const whereClause = conditions.join(" AND ");

    // Query 1: Platform KPIs & Journey Totals
    const metricsQuery = `
      WITH scoped AS (
        SELECT
          event_name,
          user_pseudo_id,
          event_date,
          (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id,
          COALESCE((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec'), 0) AS dwell_msec
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
        COUNT(CASE WHEN event_name IN ('game_start', 'game_play', 'play_game') THEN 1 END) AS gameStarts,
        COUNT(CASE WHEN event_name IN ('page_view', 'screen_view') THEN 1 END) AS catalogViews,
        COUNT(CASE WHEN event_name IN ('game_select', 'select_item', 'view_item') THEN 1 END) AS previewOpens,
        COUNT(CASE WHEN event_name IN ('game_complete', 'level_complete') THEN 1 END) AS gameCompletes,
        COALESCE(SUM(dwell_msec) / 1000.0, 0) AS totalPlayTimeSec,
        COALESCE(SAFE_DIVIDE(SUM(dwell_msec) / 1000.0, NULLIF(COUNT(CASE WHEN event_name IN ('game_start', 'game_play') THEN 1 END), 0)), 0) AS avgPlayTimeSec
      FROM scoped;
    `;

    // Query 2: All Distinct Games (Checks parameter keys + URL fallback)
    const gamesQuery = `
      SELECT DISTINCT 
        COALESCE(
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key IN ('game_title', 'game_name', 'game', 'item_name')),
          INITCAP(REPLACE(REGEXP_EXTRACT((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'), r'/games?/([^/?#]+)'), '-', ' '))
        ) AS game_title
      FROM ${EVENTS_TABLE}
      WHERE COALESCE(
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key IN ('game_title', 'game_name', 'game', 'item_name')),
        REGEXP_EXTRACT((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'), r'/games?/([^/?#]+)')
      ) IS NOT NULL
      ORDER BY 1;
    `;

    // Query 3: Real Daily Trends
    const trendsQuery = `
      SELECT
        event_date,
        COUNT(DISTINCT user_pseudo_id) AS dau,
        COUNT(DISTINCT CONCAT(user_pseudo_id, CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING))) AS sessions,
        COUNT(CASE WHEN event_name IN ('game_start', 'game_play') THEN 1 END) AS game_starts
      FROM ${EVENTS_TABLE}
      WHERE ${whereClause}
      GROUP BY event_date
      ORDER BY event_date ASC
      LIMIT 14;
    `;

    // Query 4: Dual Rankings
    const rankingsQuery = `
      SELECT
        COALESCE(
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key IN ('game_title', 'game_name', 'game', 'item_name')),
          INITCAP(REPLACE(REGEXP_EXTRACT((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'), r'/games?/([^/?#]+)'), '-', ' ')),
          'Unknown Game'
        ) AS game_title,
        COUNT(CASE WHEN event_name IN ('game_start', 'game_play') THEN 1 END) AS total_plays,
        COUNT(DISTINCT user_pseudo_id) AS unique_players,
        ROUND(COALESCE(AVG((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec')) / 1000.0, 0), 1) AS avg_dwell_sec
      FROM ${EVENTS_TABLE}
      WHERE ${whereClause}
        AND (
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key IN ('game_title', 'game_name', 'game', 'item_name')) IS NOT NULL
          OR REGEXP_CONTAINS((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'), r'/games?/')
        )
      GROUP BY 1;
    `;

    // Query 5: Full Inbound Acquisition
    const acquisitionQuery = `
      SELECT
        COALESCE(NULLIF(traffic_source.source, ''), '(direct)') AS source,
        COALESCE(NULLIF(traffic_source.medium, ''), '(none)') AS medium,
        COALESCE(NULLIF(traffic_source.name, ''), '(not set)') AS campaign,
        COUNT(DISTINCT user_pseudo_id) AS users,
        COUNT(DISTINCT CONCAT(user_pseudo_id, CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING))) AS sessions,
        COUNT(CASE WHEN event_name IN ('game_start', 'game_play') THEN 1 END) AS plays
      FROM ${EVENTS_TABLE}
      WHERE ${whereClause}
      GROUP BY 1, 2, 3
      ORDER BY sessions DESC
      LIMIT 15;
    `;

    // Query 6: Geo Locations
    const geoQuery = `
      SELECT
        COALESCE(NULLIF(geo.city, ''), 'Unknown City') AS city,
        COALESCE(NULLIF(geo.region, ''), 'Unknown Region') AS region,
        COALESCE(NULLIF(geo.country, ''), 'Unknown Country') AS country,
        COUNT(DISTINCT user_pseudo_id) AS users,
        COUNT(DISTINCT CONCAT(user_pseudo_id, CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING))) AS sessions,
        COUNT(CASE WHEN event_name IN ('game_start', 'game_play') THEN 1 END) AS plays
      FROM ${EVENTS_TABLE}
      WHERE ${whereClause}
      GROUP BY 1, 2, 3
      ORDER BY users DESC
      LIMIT 15;
    `;

    // Query 7: Top Content & Links Opened
    const linksQuery = `
      SELECT
        COALESCE(
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key IN ('game_title', 'game_name', 'item_name')),
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_title'),
          'Portal Page'
        ) AS game_title,
        COALESCE((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'), '/') AS url,
        COUNT(1) AS opens,
        COUNT(DISTINCT user_pseudo_id) AS unique_visitors
      FROM ${EVENTS_TABLE}
      WHERE ${whereClause}
      GROUP BY 1, 2
      ORDER BY opens DESC
      LIMIT 10;
    `;

    const [
      [metricsRows],
      [gameRows],
      [trendsRows],
      [rankingsRows],
      [acqRows],
      [geoRows],
      [linkRows],
    ] = await Promise.all([
      bigquery.query({ query: metricsQuery, params: queryParams }),
      bigquery.query({ query: gamesQuery }),
      bigquery.query({ query: trendsQuery, params: queryParams }),
      bigquery.query({ query: rankingsQuery, params: queryParams }),
      bigquery.query({ query: acquisitionQuery, params: queryParams }),
      bigquery.query({ query: geoQuery, params: queryParams }),
      bigquery.query({ query: linksQuery, params: queryParams }),
    ]);

    const result = metricsRows[0] || {};
    const catalogViews = Number(result.catalogViews || 0);
    const gameStarts = Number(result.gameStarts || 0);
    const previewOpens = Number(result.previewOpens || 0);

    // Drop-off: Entrances that failed to interact with previews or launch gameplay
    const catalogDropOff =
      catalogViews > 0
        ? Math.max(0, ((catalogViews - Math.max(previewOpens, gameStarts)) / catalogViews) * 100)
        : 0;

    const mostPlayed = [...rankingsRows].sort(
      (a: any, b: any) => Number(b.total_plays || 0) - Number(a.total_plays || 0)
    );
    const mostDwell = [...rankingsRows].sort(
      (a: any, b: any) => Number(b.avg_dwell_sec || 0) - Number(a.avg_dwell_sec || 0)
    );

    const gameList = gameRows
      .map((r: any) => r.game_title)
      .filter((title: string | null) => Boolean(title && title.trim() !== ""));

    return NextResponse.json({
      success: true,
      metrics: {
        dau: Number(result.dau || 0),
        wau: Number(result.wau || 0),
        mau: Number(result.mau || 0),
        sessions: Number(result.sessions || 0),
        gameStarts,
        catalogViews,
        previewOpens,
        gameCompletes: Number(result.gameCompletes || 0),
        catalogDropOff,
        totalPlayTimeSec: Number(result.totalPlayTimeSec || 0),
        avgPlayTimeSec: Number(result.avgPlayTimeSec || 0),
      },
      games: gameList,
      dailyTrends: trendsRows || [],
      rankings: {
        mostPlayed,
        mostDwell,
      },
      acquisition: acqRows || [],
      geo: geoRows || [],
      topLinks: linkRows || [],
    });
  } catch (error: any) {
    console.error("Telemetry API Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}