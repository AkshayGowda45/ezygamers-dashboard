import { NextRequest, NextResponse } from 'next/server';
import { BigQuery } from '@google-cloud/bigquery';

const bigquery = new BigQuery({
  projectId: 'gen-lang-client-0375476077',
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10), 1), 90);
  const device = searchParams.get('device') || 'all';
  const country = searchParams.get('country') || 'all';

  const deviceFilter = device !== 'all' ? `AND device.category = '${device}'` : '';
  const countryFilter = country !== 'all' ? `AND geo.country LIKE '%${country}%'` : '';

  const query = `
    WITH EventsWithParams AS (
      SELECT
        user_pseudo_id,
        event_name,
        PARSE_DATE('%Y%m%d', event_date) AS event_date,
        COALESCE(
          CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING),
          'no_session'
        ) AS session_id_param,
        COALESCE((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec'), 0) AS engagement_msec,
        COALESCE((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'session_engaged'), '0') AS session_engaged_flag,
        COALESCE(geo.country, 'Unknown') AS country,
        COALESCE(device.category, 'desktop') AS device_category,
        COALESCE(traffic_source.source, '(direct)') AS traffic_source,
        COALESCE(traffic_source.medium, '(none)') AS traffic_medium,
        COALESCE(
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'game_id'),
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'game_name'),
          'Unspecified'
        ) AS game_id,
        MIN(PARSE_DATE('%Y%m%d', event_date)) OVER(PARTITION BY user_pseudo_id) AS first_seen_date
      FROM \`play-ezygamers-512305.analytics_557900460.events_*\`
      WHERE _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL ${days} DAY))
      ${deviceFilter}
      ${countryFilter}
    ),
    Sessions AS (
      SELECT
        CONCAT(user_pseudo_id, '-', session_id_param) AS session_id,
        user_pseudo_id,
        event_date,
        first_seen_date,
        country,
        device_category,
        traffic_source,
        traffic_medium,
        game_id,
        event_name,
        engagement_msec,
        session_engaged_flag,
        DATE_DIFF(event_date, first_seen_date, DAY) AS day_diff
      FROM EventsWithParams
    ),
    SessionAgg AS (
      SELECT
        session_id,
        ANY_VALUE(user_pseudo_id) AS user_id,
        MAX(CASE WHEN event_name IN ('first_open', 'first_visit') THEN 1 ELSE 0 END) AS is_new_user,
        MAX(CASE WHEN event_name IN ('page_view', 'session_start') THEN 1 ELSE 0 END) AS has_landing,
        MAX(CASE WHEN event_name = 'preview_open' THEN 1 ELSE 0 END) AS has_preview,
        MAX(CASE WHEN event_name = 'game_start' THEN 1 ELSE 0 END) AS has_start,
        MAX(CASE WHEN session_engaged_flag = '1' THEN 1 ELSE 0 END) AS is_engaged,
        SUM(engagement_msec) AS total_engagement_msec
      FROM Sessions
      GROUP BY session_id
    ),
    OverviewKPIs AS (
      SELECT
        COUNT(DISTINCT user_id) AS total_users,
        COUNT(DISTINCT CASE WHEN is_new_user = 1 THEN user_id END) AS new_users,
        COUNT(DISTINCT session_id) AS total_sessions,
        COUNT(DISTINCT CASE WHEN is_engaged = 1 THEN session_id END) AS engaged_sessions,
        ROUND(SAFE_DIVIDE(COUNT(DISTINCT CASE WHEN is_engaged = 1 THEN session_id END), COUNT(DISTINCT session_id)) * 100, 1) AS engagement_rate_pct,
        ROUND(SAFE_DIVIDE(SUM(total_engagement_msec), COUNT(DISTINCT session_id) * 1000), 1) AS avg_engagement_sec,
        COUNT(DISTINCT CASE WHEN has_landing = 1 THEN session_id END) AS funnel_step1_landing,
        COUNT(DISTINCT CASE WHEN has_landing = 1 AND has_preview = 1 THEN session_id END) AS funnel_step2_preview,
        COUNT(DISTINCT CASE WHEN has_landing = 1 AND has_preview = 1 AND has_start = 1 THEN session_id END) AS funnel_step3_preview_play,
        COUNT(DISTINCT CASE WHEN has_landing = 1 AND has_preview = 0 AND has_start = 1 THEN session_id END) AS funnel_step3_direct_play,
        COUNT(DISTINCT CASE WHEN has_landing = 1 AND has_start = 1 THEN session_id END) AS funnel_total_plays,
        ROUND(SAFE_DIVIDE(COUNT(DISTINCT CASE WHEN has_landing = 1 AND has_start = 1 THEN session_id END), COUNT(DISTINCT CASE WHEN has_landing = 1 THEN session_id END)) * 100, 1) AS conversion_rate_pct
      FROM SessionAgg
    ),
    DailyActivity AS (
      SELECT
        FORMAT_DATE('%Y-%m-%d', event_date) AS date_label,
        COUNT(DISTINCT user_pseudo_id) AS dau,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(CASE WHEN event_name = 'game_start' THEN 1 END) AS plays
      FROM Sessions
      GROUP BY event_date
      ORDER BY event_date ASC
    ),
    CohortBase AS (
      SELECT
        FORMAT_DATE('%Y-%m-%d', first_seen_date) AS cohort_date,
        COUNT(DISTINCT user_pseudo_id) AS cohort_size,
        COUNT(DISTINCT CASE WHEN day_diff = 1 THEN user_pseudo_id END) AS d1_users,
        COUNT(DISTINCT CASE WHEN day_diff = 3 THEN user_pseudo_id END) AS d3_users,
        COUNT(DISTINCT CASE WHEN day_diff = 7 THEN user_pseudo_id END) AS d7_users
      FROM Sessions
      GROUP BY cohort_date
      ORDER BY cohort_date DESC
      LIMIT 10
    ),
    AcquisitionChannels AS (
      SELECT
        CASE 
          WHEN traffic_medium = 'organic' OR traffic_source = 'google' THEN 'Organic Search'
          WHEN traffic_source LIKE '%facebook%' OR traffic_source LIKE '%instagram%' OR traffic_medium = 'social' THEN 'Organic Social'
          WHEN traffic_source = '(direct)' THEN 'Direct'
          ELSE 'Referral / Other'
        END AS channel,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(DISTINCT user_pseudo_id) AS users
      FROM Sessions
      GROUP BY channel
      ORDER BY sessions DESC
    ),
    GameDiagnostics AS (
      SELECT
        game_id,
        COUNT(1) AS starts,
        COUNT(DISTINCT user_pseudo_id) AS unique_players,
        ROUND(AVG(engagement_msec) / 1000, 1) AS avg_duration_sec
      FROM Sessions
      WHERE event_name = 'game_start' AND game_id != 'Unspecified'
      GROUP BY game_id
      ORDER BY starts DESC
      LIMIT 8
    )
    SELECT
      (SELECT AS STRUCT * FROM OverviewKPIs) AS summary,
      ARRAY(SELECT AS STRUCT * FROM DailyActivity) AS activity_trend,
      ARRAY(SELECT AS STRUCT * FROM CohortBase) AS cohorts,
      ARRAY(SELECT AS STRUCT * FROM AcquisitionChannels) AS acquisition,
      ARRAY(SELECT AS STRUCT * FROM GameDiagnostics) AS games;
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      location: 'asia-south1',
    });
    return NextResponse.json({ data: rows[0] || {} });
  } catch (error: any) {
    console.error('BigQuery Execution Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}