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
      console.error("Failed to parse GCP_SERVICE_ACCOUNT_KEY in route.ts:", e);
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

    const latestTimestamp = Number(
      latestRows?.[0]?.max_timestamp?.value ||
      latestRows?.[0]?.max_timestamp ||
      Date.now() * 1000
    );

    let currentWhere = "";
    let previousWhere = "";
    let rangeLabel = "";

    if (startDate && endDate) {
      const s = startDate.replace(/-/g, "");
      const e = endDate.replace(/-/g, "");
      currentWhere = `AND event_date BETWEEN '${s}' AND '${e}'`;
      previousWhere = `
        AND PARSE_DATE('%Y%m%d', event_date)
            BETWEEN DATE_SUB(PARSE_DATE('%Y%m%d', '${s}'), INTERVAL DATE_DIFF(PARSE_DATE('%Y%m%d', '${e}'), PARSE_DATE('%Y%m%d', '${s}'), DAY) + 1 DAY)
                AND DATE_SUB(PARSE_DATE('%Y%m%d', '${s}'), INTERVAL 1 DAY)
      `;
      rangeLabel = `${startDate} → ${endDate}`;
    } else if (days === "24h") {
      const ts = latestTimestamp;
      currentWhere = `AND event_timestamp >= ${Math.floor(ts - 86400000000)} AND event_timestamp <= ${Math.floor(ts)}`;
      previousWhere = `AND event_timestamp >= ${Math.floor(ts - 172800000000)} AND event_timestamp < ${Math.floor(ts - 86400000000)}`;
      rangeLabel = "Last 24 Hours";
    } else if (days === "all") {
      currentWhere = "";
      previousWhere = "AND 1=0";
      rangeLabel = "All Recorded Activity";
    } else {
      const n = Math.max(1, Math.min(parseInt(days, 10) || 30, 365));
      currentWhere = `
        AND PARSE_DATE('%Y%m%d', event_date)
            BETWEEN DATE_SUB(DATE '${latestDate}', INTERVAL ${n - 1} DAY)
                AND DATE '${latestDate}'
      `;
      previousWhere = `
        AND PARSE_DATE('%Y%m%d', event_date)
            BETWEEN DATE_SUB(DATE '${latestDate}', INTERVAL ${n * 2 - 1} DAY)
                AND DATE_SUB(DATE '${latestDate}', INTERVAL ${n} DAY)
      `;
      rangeLabel = `Last ${n} Days`;
    }

    const deviceFilter = device !== "all" ? `AND device.category = '${device}'` : "";
    const countryFilter = country !== "all" ? `AND COALESCE(geo.country, 'Unknown') = '${country}'` : "";
    const sourceFilter = source !== "all" ? `AND COALESCE(traffic_source.source, '(direct)') = '${source}'` : "";

    const query = `
      WITH
      CurrentEvents AS (
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
          COALESCE((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'session_engaged'), '0') AS session_engaged_flag,
          COALESCE(geo.country, 'Unknown') AS country,
          COALESCE(geo.city, 'Unknown') AS city,
          COALESCE(device.category, 'desktop') AS device_category,
          COALESCE(traffic_source.source, '(direct)') AS traffic_source,
          COALESCE(traffic_source.medium, '(none)') AS traffic_medium,
          COALESCE(
            (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'game_id'),
            (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'game_name'),
            'Unspecified'
          ) AS game_id
        FROM ${EVENTS_TABLE}
        WHERE 1=1
          ${currentWhere}
          ${deviceFilter}
          ${countryFilter}
          ${sourceFilter}
      ),

      PreviousEvents AS (
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
          COALESCE((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'session_engaged'), '0') AS session_engaged_flag,
          COALESCE(device.category, 'desktop') AS device_category,
          COALESCE(traffic_source.source, '(direct)') AS traffic_source,
          COALESCE(traffic_source.medium, '(none)') AS traffic_medium
        FROM ${EVENTS_TABLE}
        WHERE 1=1
          ${previousWhere}
          ${deviceFilter}
          ${countryFilter}
          ${sourceFilter}
      ),

      CurrentSessionsRaw AS (
        SELECT
          CONCAT(user_pseudo_id, '-', session_id_param) AS session_id,
          user_pseudo_id,
          ANY_VALUE(country) AS country,
          ANY_VALUE(city) AS city,
          ANY_VALUE(device_category) AS device_category,
          ANY_VALUE(traffic_source) AS traffic_source,
          ANY_VALUE(traffic_medium) AS traffic_medium,
          MAX(event_date) AS session_date,
          MAX(IF(event_name IN ('first_open','first_visit'), 1, 0)) AS is_new_user,
          MAX(IF(event_name IN ('page_view','session_start'), 1, 0)) AS has_landing,
          
          MAX(IF(event_name = 'preview_open', 1, 0)) AS has_preview,
          MAX(IF(event_name = 'game_start', 1, 0)) AS has_play,
          
          MAX(IF(
            event_name = 'preview_open' AND game_id = '${game}', 1, 0
          )) AS has_game_specific_preview,
          
          MAX(IF(event_name = 'game_start' AND game_id = '${game}', 1, 0)) AS has_game_specific_play,
          
          ARRAY_AGG(DISTINCT IF(game_id != 'Unspecified', game_id, NULL) IGNORE NULLS) AS all_interacted_games,
          COUNTIF(event_name = 'game_start') AS play_count,
          MAX(IF(session_engaged_flag = '1', 1, 0)) AS is_engaged,
          SUM(engagement_msec) AS total_session_msec,
          
          SUM(IF(event_name IN ('page_view', 'session_start'), engagement_msec, 0)) AS landing_msec,
          SUM(IF(event_name = 'preview_open', engagement_msec, 0)) AS preview_msec,
          SUM(IF(event_name = 'game_start' AND ('${game}' = 'all' OR game_id = '${game}'), engagement_msec, 0)) AS gameplay_msec,

          ARRAY_AGG(event_name ORDER BY event_timestamp DESC LIMIT 1)[OFFSET(0)] AS terminal_event
        FROM CurrentEvents
        GROUP BY 1, 2
      ),

      CurrentSessions AS (
        SELECT *
        FROM CurrentSessionsRaw
        WHERE 
          '${game}' = 'all'
          OR '${game}' IN UNNEST(all_interacted_games)
          OR has_game_specific_play = 1
          OR has_game_specific_preview = 1
      ),

      PreviousSessions AS (
        SELECT
          CONCAT(user_pseudo_id, '-', session_id_param) AS session_id,
          user_pseudo_id,
          MAX(IF(event_name IN ('page_view','session_start'), 1, 0)) AS has_landing,
          MAX(IF(event_name = 'game_start', 1, 0)) AS has_play,
          MAX(IF(session_engaged_flag = '1', 1, 0)) AS is_engaged,
          SUM(engagement_msec) AS total_session_msec
        FROM PreviousEvents
        GROUP BY 1, 2
      ),

      Summary AS (
        SELECT
          COUNT(DISTINCT user_pseudo_id) AS total_users,
          COUNT(DISTINCT IF(is_new_user = 1, user_pseudo_id, NULL)) AS new_users,
          COUNT(DISTINCT user_pseudo_id) - COUNT(DISTINCT IF(is_new_user = 1, user_pseudo_id, NULL)) AS returning_users,
          COUNT(DISTINCT session_id) AS total_sessions,
          COUNT(DISTINCT IF(is_engaged = 1, session_id, NULL)) AS engaged_sessions,
          ROUND(SAFE_DIVIDE(COUNT(DISTINCT IF(is_engaged = 1, session_id, NULL)), COUNT(DISTINCT session_id)) * 100, 1) AS engagement_rate_pct,
          ROUND(SAFE_DIVIDE(SUM(total_session_msec), COUNT(DISTINCT session_id) * 1000), 1) AS avg_session_duration_sec,
          
          COUNT(DISTINCT IF(has_landing = 1, session_id, NULL)) AS landing_sessions,
          COUNT(DISTINCT IF(has_landing = 1 AND (IF('${game}' = 'all', has_preview = 1, has_game_specific_preview = 1 OR has_preview = 1)), session_id, NULL)) AS preview_sessions,
          COUNT(DISTINCT IF(has_landing = 1 AND (IF('${game}' = 'all', has_play = 1, has_game_specific_play = 1)), session_id, NULL)) AS game_start_sessions,
          
          ROUND(SAFE_DIVIDE(AVG(landing_msec), 1000), 1) AS avg_landing_dwell_sec,
          ROUND(SAFE_DIVIDE(AVG(preview_msec), 1000), 1) AS avg_preview_dwell_sec,
          ROUND(SAFE_DIVIDE(AVG(gameplay_msec), 1000), 1) AS avg_gameplay_dwell_sec,
          ROUND(SAFE_DIVIDE(SUM(gameplay_msec), 1000), 0) AS total_gameplay_playtime_sec,

          ROUND(
            SAFE_DIVIDE(
              COUNT(DISTINCT IF(has_landing = 1 AND (IF('${game}' = 'all', has_play = 1, has_game_specific_play = 1)), session_id, NULL)),
              COUNT(DISTINCT IF(has_landing = 1, session_id, NULL))
            ) * 100, 1
          ) AS conversion_rate_pct,
          ROUND(SAFE_DIVIDE(COUNT(DISTINCT session_id), COUNT(DISTINCT user_pseudo_id)), 2) AS sessions_per_user
        FROM CurrentSessions
      ),

      PreviousSummary AS (
        SELECT
          COUNT(DISTINCT user_pseudo_id) AS total_users,
          COUNT(DISTINCT session_id) AS total_sessions,
          COUNT(DISTINCT IF(is_engaged = 1, session_id, NULL)) AS engaged_sessions,
          ROUND(
            SAFE_DIVIDE(
              COUNT(DISTINCT IF(is_engaged = 1, session_id, NULL)),
              COUNT(DISTINCT session_id)
            ) * 100, 1
          ) AS engagement_rate_pct,
          ROUND(
            SAFE_DIVIDE(SUM(total_session_msec), COUNT(DISTINCT session_id) * 1000),
            1
          ) AS avg_session_duration_sec,
          COUNT(DISTINCT IF(has_landing = 1 AND has_play = 1, session_id, NULL)) AS game_start_sessions,
          ROUND(
            SAFE_DIVIDE(
              COUNT(DISTINCT IF(has_landing = 1 AND has_play = 1, session_id, NULL)),
              COUNT(DISTINCT IF(has_landing = 1, session_id, NULL))
            ) * 100, 1
          ) AS conversion_rate_pct
        FROM PreviousSessions
      ),

      ActiveWindows AS (
        SELECT
          COUNT(DISTINCT IF(event_timestamp >= ${latestTimestamp - 1800000000}, user_pseudo_id, NULL)) AS realtime_active_30m,
          COUNT(DISTINCT IF(event_date = DATE '${latestDate}', user_pseudo_id, NULL)) AS dau,
          (SELECT COUNT(DISTINCT user_pseudo_id) FROM ${EVENTS_TABLE} WHERE event_date >= FORMAT_DATE('%Y%m%d', DATE_SUB(DATE '${latestDate}', INTERVAL 6 DAY))) AS wau,
          (SELECT COUNT(DISTINCT user_pseudo_id) FROM ${EVENTS_TABLE} WHERE event_date >= FORMAT_DATE('%Y%m%d', DATE_SUB(DATE '${latestDate}', INTERVAL 29 DAY))) AS mau
        FROM CurrentEvents
      ),

      GameDiagnostics AS (
        SELECT
          game_id,
          COUNTIF(event_name = 'game_start') AS starts,
          COUNT(DISTINCT IF(event_name = 'game_start', user_pseudo_id, NULL)) AS unique_players,
          ROUND(SUM(IF(event_name = 'game_start', engagement_msec, 0)) / 1000, 0) AS total_playtime_sec,
          ROUND(SAFE_DIVIDE(SUM(IF(event_name = 'game_start', engagement_msec, 0)), COUNTIF(event_name = 'game_start') * 1000), 1) AS avg_dwell_sec,
          COUNTIF(event_name = 'game_start' AND engagement_msec < 5000) AS bounces_under_5s,
          ROUND(SAFE_DIVIDE(COUNTIF(event_name = 'game_start' AND engagement_msec < 5000), COUNTIF(event_name = 'game_start')) * 100, 1) AS bounce_rate_pct
        FROM CurrentEvents
        WHERE game_id != 'Unspecified'
        GROUP BY game_id
        HAVING starts > 0
        ORDER BY starts DESC
      ),

      Dropoffs AS (
        SELECT
          terminal_event,
          COUNT(DISTINCT session_id) AS sessions_ended_here,
          COUNT(DISTINCT user_pseudo_id) AS users_lost,
          ROUND(AVG(total_session_msec) / 1000, 1) AS avg_dwell_before_churn_sec,
          CASE
            WHEN terminal_event IN ('page_view','session_start') THEN 'Landing Bounce (Catalog hesitation)'
            WHEN terminal_event = 'preview_open' THEN 'Modal Churn (Read preview, aborted)'
            WHEN terminal_event = 'game_start' THEN 'Immediate Play Exit (<5s load drop)'
            WHEN terminal_event = 'user_engagement' THEN 'Passive Tab Expiration'
            ELSE 'Post-Gameplay Departure'
          END AS churn_reason
        FROM CurrentSessions
        GROUP BY terminal_event
        ORDER BY sessions_ended_here DESC
      ),

      AllCities AS (
        SELECT
          COALESCE(city, '(not set)') AS city,
          COALESCE(country, 'Unknown') AS country,
          COUNT(DISTINCT user_pseudo_id) AS users,
          COUNT(DISTINCT session_id) AS sessions,
          COUNT(DISTINCT IF(has_play = 1, session_id, NULL)) AS game_starts,
          ROUND(SAFE_DIVIDE(SUM(total_session_msec), COUNT(DISTINCT session_id) * 1000), 1) AS avg_dwell_sec
        FROM CurrentSessions
        GROUP BY city, country
        ORDER BY sessions DESC
      ),

      AcquisitionPlatforms AS (
        SELECT
          traffic_source AS source,
          traffic_medium AS medium,
          COUNT(DISTINCT user_pseudo_id) AS users,
          COUNT(DISTINCT session_id) AS sessions,
          COUNT(DISTINCT IF(has_play = 1, session_id, NULL)) AS game_starts,
          ROUND(SAFE_DIVIDE(COUNT(DISTINCT IF(has_play = 1, session_id, NULL)), COUNT(DISTINCT session_id)) * 100, 1) AS conversion_rate_pct,
          ROUND(SAFE_DIVIDE(SUM(total_session_msec), COUNT(DISTINCT session_id) * 1000), 1) AS avg_dwell_sec
        FROM CurrentSessions
        GROUP BY source, medium
        ORDER BY users DESC
      ),

      Trend AS (
        SELECT
          FORMAT_DATE('%Y-%m-%d', session_date) AS date_label,
          COUNT(DISTINCT user_pseudo_id) AS dau,
          COUNT(DISTINCT session_id) AS sessions,
          COUNT(DISTINCT IF(has_play = 1, session_id, NULL)) AS plays
        FROM CurrentSessions
        GROUP BY session_date
        ORDER BY session_date ASC
      )

      SELECT
        (SELECT AS STRUCT * FROM Summary) AS summary,
        (SELECT AS STRUCT * FROM PreviousSummary) AS previous_summary,
        (SELECT AS STRUCT * FROM ActiveWindows) AS user_windows,
        ARRAY(SELECT AS STRUCT * FROM Dropoffs) AS dropoffs,
        ARRAY(SELECT AS STRUCT * FROM GameDiagnostics) AS games,
        ARRAY(SELECT AS STRUCT * FROM AllCities) AS locations,
        ARRAY(SELECT AS STRUCT * FROM AcquisitionPlatforms) AS acquisition,
        ARRAY(SELECT AS STRUCT * FROM Trend) AS trend,
        '${rangeLabel}' AS range_label,
        '${latestDate}' AS latest_data_date
    `;

    const [rows] = await bigquery.query({ query, location: "asia-south1" });

    return NextResponse.json({
      data: rows[0] || {},
      meta: { latestDataDate: latestDate, rangeLabel },
    });
  } catch (error: any) {
    console.error("BigQuery Execution Error:", error);
    return NextResponse.json({ error: error?.message || "Failed to query BigQuery" }, { status: 500 });
  }
}