import { BigQuery } from '@google-cloud/bigquery';

function createBigQueryClient() {
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
    } catch (error) {
      console.error('Error parsing GCP_SERVICE_ACCOUNT_KEY:', error);
    }
  }

  // Fallback for local development in VS Code
  return new BigQuery({
    projectId: process.env.GCP_PROJECT_ID || 'gen-lang-client-0375476077',
  });
}

export const bigquery = createBigQueryClient();