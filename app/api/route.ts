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
    val === "All Sources"
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
          (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id
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
        COUNT(CASE WHEN event_name = 'game_complete' THEN 1 END) AS gameCompletes
      FROM base_events;
    `;

    const [rows] = await bigquery.query({
      query,
      params: queryParams,
    });

    const result = rows[0] || {};
    const catalogViews = Number(result.catalogViews || 0);
    const previewOpens = Number(result.previewOpens || 0);
    const catalogDropOff =
      catalogViews > 0
        ? Math.max(0, ((catalogViews - previewOpens) / catalogViews) * 100)
        : 0;

    return NextResponse.json({
      success: true,
      metrics: {
        dau: Number(result.dau || 0),
        wau: Number(result.wau || 0),
        mau: Number(result.mau || 0),
        sessions: Number(result.sessions || 0),
        gameStarts: Number(result.gameStarts || 0),
        catalogViews,
        previewOpens,
        gameCompletes: Number(result.gameCompletes || 0),
        catalogDropOff,
      },
    });
  } catch (error: any) {
    console.error("Telemetry API Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}