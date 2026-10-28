import { BigQuery } from '@google-cloud/bigquery';

function getBigQueryClient() {
  if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
    try {
      const credentials = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
      return new BigQuery({
        projectId: credentials.project_id || process.env.GCP_PROJECT_ID,
        credentials: {
          client_email: credentials.client_email,
          private_key: credentials.private_key,
        },
      });
    } catch (e) {
      console.error('Failed to parse GCP_SERVICE_ACCOUNT_KEY:', e);
    }
  }

  // Fallback for local development if using ADC or individual env vars
  return new BigQuery({
    projectId: process.env.GCP_PROJECT_ID,
  });
}

export const bigquery = getBigQueryClient();