use std::{env, sync::Arc};

use anyhow::Error;
use axum::{
    Router,
    http::HeaderValue,
    routing::get,
};
use tokio::{net::TcpListener, sync::broadcast::Sender};
use tower_http::cors::{Any, CorsLayer};
use tracing::info;

use storage::DbPool;

use crate::services::state_service::StateService;

mod connections;
mod current;
mod drivers;
mod health;
mod raw;
mod realtime;
mod review;

pub struct Context {
    pub state_service: StateService,
    pub tx: Sender<String>,
    pub db: Option<DbPool>,
}

pub async fn start(
    state_service: StateService,
    tx: Sender<String>,
    db: Option<DbPool>,
) -> Result<(), Error> {
    let addr = env::var("ADDRESS").unwrap_or_else(|_| "127.0.0.1:4000".to_string());

    let context = Arc::new(Context { state_service, tx, db });

    let cors = cors_layer()?;

    let app = Router::new()
        .route("/api/health", get(health::health_check))
        .route("/api/realtime", get(realtime::sse_stream))
        .route("/api/current", get(current::current_state))
        .route("/api/drivers", get(drivers::drivers))
        .route("/api/connections", get(connections::current_connections))
        .route("/api/raw/sessions", get(raw::sessions))
        .route("/api/raw/topics", get(raw::topics))
        .route("/api/raw/events", get(raw::events))
        .route("/api/raw/bounds", get(raw::bounds))
        .route("/api/raw/initial", get(raw::initial))
        .route("/api/review/drivers", get(review::drivers))
        .route("/api/review/laps", get(review::laps))
        .route("/api/review/stints", get(review::stints))
        .route("/api/review/pit-windows", get(review::pit_windows))
        .with_state(context)
        .layer(cors)
        .into_make_service();

    info!(addr, "starting norths http server");

    axum::serve(TcpListener::bind(addr).await?, app).await?;

    Ok(())
}

pub fn cors_layer() -> Result<CorsLayer, Error> {
    let origin = env::var("ORIGIN").unwrap_or_else(|_| {
        "http://127.0.0.1:18701,http://localhost:18701,https://f1analytics.gelosoft.app".to_string()
    });

    if origin.trim() == "*" {
        return Ok(CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any));
    }

    let origins = origin
        .split(|c| c == ';' || c == ',')
        .map(str::trim)
        .filter(|o| !o.is_empty())
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect::<Vec<HeaderValue>>();

    Ok(CorsLayer::new()
        .allow_origin(origins)
        .allow_methods(Any)
        .allow_headers(Any))
}
