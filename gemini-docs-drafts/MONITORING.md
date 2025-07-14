# 📊 MONITORING GUIDE

**Understanding monitoring for the MINOOTS timer system.**

---

## 🎯 MONITORING OVERVIEW

MINOOTS is built on Firebase and Google Cloud Functions, leveraging Google Cloud's robust monitoring and logging infrastructure. Direct application-level metrics (like Prometheus) are not exposed by the application itself.

## 🔍 GOOGLE CLOUD MONITORING

All application logs and performance metrics are automatically collected by Google Cloud's operations suite (formerly Stackdriver).

### 1. Cloud Logging

All `console.log`, `console.error`, and other standard output from your Firebase Functions are sent to Cloud Logging. You can view these logs in the Google Cloud Console.

**Accessing Logs**:

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Navigate to **Logging** > **Logs Explorer**.
3.  Filter logs by resource type (`Cloud Function`) and function name (`api`, `checkExpiredTimers`, `cleanupTimers`).

### 2. Cloud Monitoring

Cloud Monitoring automatically collects metrics for your Firebase Functions, such as invocation count, execution time, and error rates. You can create custom dashboards and alerts based on these metrics.

**Accessing Metrics & Creating Alerts**:

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Navigate to **Monitoring** > **Metrics Explorer** or **Alerting**.
3.  Select resource type `Cloud Function` to view relevant metrics.

## 🚨 ALERTING

You can set up custom alerts in Google Cloud Monitoring to be notified of critical events, such as:

*   High error rates for API endpoints.
*   Function invocation failures.
*   Increased latency.
*   Resource utilization exceeding thresholds.

## 📊 USAGE ANALYTICS

For user-specific usage statistics (e.g., timers created, API key usage), you can use the `/account/usage` API endpoint.

```bash
curl -X GET https://api-m3waemr5lq-uc.a.run.app/account/usage \
  -H "x-api-key: YOUR_API_KEY"
```

## ⚠️ Important Notes

*   **No Custom Metrics Endpoint**: The MINOOTS application does not expose a `/metrics` endpoint for external scraping (e.g., by Prometheus).
*   **No Self-Hosted Monitoring**: The project does not support or provide configurations for self-hosted monitoring solutions like Prometheus, Grafana, or ELK stack.
*   **Audit Logs**: While the system logs certain administrative actions internally, these are not currently exposed via a public API or dashboard for customer access.

```