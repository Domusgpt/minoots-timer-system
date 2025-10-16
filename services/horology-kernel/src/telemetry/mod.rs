use std::{net::SocketAddr, sync::Arc};

use anyhow::Context;
use axum::http::{header, StatusCode};
use axum::response::Response;
use axum::{routing::get, Router};
use opentelemetry::{global, KeyValue};
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{metrics::MeterProvider, trace, Resource};
use prometheus::{Encoder, Registry, TextEncoder};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tracing::warn;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub mod replication;

pub struct TelemetryHandle {
    registry: Arc<Registry>,
    meter_provider: MeterProvider,
}

impl TelemetryHandle {
    pub async fn serve_metrics(&self, addr: SocketAddr) -> anyhow::Result<JoinHandle<()>> {
        let listener = TcpListener::bind(addr)
            .await
            .with_context(|| format!("failed to bind metrics listener at {addr}"))?;
        let registry = self.registry.clone();
        let app = Router::new().route("/metrics", get(move || metrics_handler(registry.clone())));

        let handle = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, app.into_make_service()).await {
                warn!(?error, "metrics server terminated");
            }
        });

        Ok(handle)
    }

    pub fn shutdown(self) {
        if let Err(error) = self.meter_provider.force_flush() {
            warn!(?error, "failed to flush meter provider before shutdown");
        }
        if let Err(error) = self.meter_provider.shutdown() {
            warn!(?error, "failed to shutdown meter provider");
        }
        opentelemetry::global::shutdown_meter_provider();
        opentelemetry::global::shutdown_tracer_provider();
    }
}

pub fn init() -> anyhow::Result<TelemetryHandle> {
    let service_name = std::env::var("KERNEL_OTEL_SERVICE_NAME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var("OTEL_SERVICE_NAME").ok())
        .unwrap_or_else(|| "horology-kernel".to_string());
    let resource = Resource::new(vec![KeyValue::new("service.name", service_name)]);

    let registry = Registry::new();
    let exporter = opentelemetry_prometheus::exporter()
        .with_registry(registry.clone())
        .build()?;
    let registry = Arc::new(registry);

    let meter_provider = MeterProvider::builder()
        .with_resource(resource.clone())
        .with_reader(exporter)
        .build();
    global::set_meter_provider(meter_provider.clone());

    let endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:4317".to_string());

    let trace_config = trace::Config::default().with_resource(resource.clone());
    let tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .tonic()
                .with_endpoint(endpoint),
        )
        .with_trace_config(trace_config)
        .install_batch(opentelemetry_sdk::runtime::Tokio)?;

    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_opentelemetry::layer().with_tracer(tracer))
        .try_init()
        .ok();

    Ok(TelemetryHandle {
        registry,
        meter_provider,
    })
}

async fn metrics_handler(registry: Arc<Registry>) -> Response {
    let metric_families = registry.gather();
    let encoder = TextEncoder::new();
    let mut buffer = Vec::new();

    match encoder.encode(&metric_families, &mut buffer) {
        Ok(()) => match String::from_utf8(buffer) {
            Ok(body) => Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, encoder.format_type())
                .body(body.into())
                .unwrap_or_else(|error| {
                    warn!(?error, "failed to build metrics response");
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body("failed to build metrics response".into())
                        .unwrap()
                }),
            Err(error) => {
                warn!(?error, "failed to encode prometheus metrics as utf-8");
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body("failed to encode metrics".into())
                    .unwrap()
            }
        },
        Err(error) => {
            warn!(?error, "failed to render prometheus metrics");
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body("failed to render metrics".into())
                .unwrap()
        }
    }
}
