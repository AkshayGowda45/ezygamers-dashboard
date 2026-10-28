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
      console.error("Failed to parse GCP_SERVICE_ACCOUNT_KEY in funnel/route.ts:", e);
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
      WITH funnel_steps AS (
        SELECT
          COUNT(DISTINCT CASE WHEN event_name = 'page_view' THEN user_pseudo_id END) AS catalog_views,
          COUNT(DISTINCT CASE WHEN event_name = 'game_select' THEN user_pseudo_id END) AS preview_opens,
          COUNT(DISTINCT CASE WHEN event_name = 'game_start' THEN user_pseudo_id END) AS game_starts,
          COUNT(DISTINCT CASE WHEN event_name = 'game_complete' THEN user_pseudo_id END) AS game_completes
        FROM ${EVENTS_TABLE}
        WHERE ${whereClause}
      )
      SELECT * FROM funnel_steps;
    `;

    const [rows] = await bigquery.query({
      query,
      params: queryParams,
    });

    return NextResponse.json({
      success: true,
      data: rows[0] || {
        catalog_views: 0,
        preview_opens: 0,
        game_starts: 0,
        game_completes: 0,
      },
    });
  } catch (error: any) {
    console.error("Funnel API Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}