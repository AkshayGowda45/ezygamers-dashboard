import { NextRequest, NextResponse } from "next/server";
import { BigQuery } from "@google-cloud/bigquery";

export const dynamic = "force-dynamic";

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
          "gen-lang-client-0375476077",
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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    let conditions: string[] = ["1 = 1"];
    const queryParams: Record<string, any> = {};

    if (startDate) {
      conditions.push("event_date >= @startDate");
      queryParams.startDate = startDate.replace(/-/g, "");
    }
    if (endDate) {
      conditions.push("event_date <= @endDate");
      queryParams.endDate = endDate.replace(/-/g, "");
    }

    const whereClause = conditions.join(" AND ");

    const query = `
      SELECT
        COUNT(DISTINCT user_pseudo_id) AS dau,
        COUNT(DISTINCT CASE 
          WHEN event_date >= FORMAT_DATE('%Y%m%d', DATE_SUB(PARSE_DATE('%Y%m%d', @endDate), INTERVAL 7 DAY)) 
          THEN user_pseudo_id END
        ) AS wau,
        COUNT(DISTINCT CASE 
          WHEN event_date >= FORMAT_DATE('%Y%m%d', DATE_SUB(PARSE_DATE('%Y%m%d', @endDate), INTERVAL 30 DAY)) 
          THEN user_pseudo_id END
        ) AS mau,
        COUNT(DISTINCT CONCAT(user_pseudo_id, CAST(
          (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING
        ))) AS sessions,
        COUNT(CASE WHEN event_name = 'game_start' THEN 1 END) AS game_starts
      FROM ${EVENTS_TABLE}
      WHERE ${whereClause};
    `;

    const [rows] = await bigquery.query({
      query,
      params: queryParams,
    });

    return NextResponse.json({
      success: true,
      data: rows[0] || { dau: 0, wau: 0, mau: 0, sessions: 0, game_starts: 0 },
    });
  } catch (error: any) {
    console.error("BigQuery Overview Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}