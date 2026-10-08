use std::env;

use anyhow::Error;
use axum::{
    Router,
    http::HeaderValue,
    routing::get,
};

use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};
use tracing::info;

use shared::tracing_subscriber;

mod endpoints {
    pub(crate) mod health;
    pub(crate) mod schedule;
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber();

    let addr = env::var("ADDRESS").unwrap_or_else(|_| "127.0.0.1:4010".to_string());

    let cors = cors_layer()?;

    let app = Router::new()
        .route("/api/schedule", get(endpoints::schedule::get))
        .route("/api/schedule/next", get(endpoints::schedule::get_next))
        .route("/api/health", get(endpoints::health::check))
        .layer(cors);

    info!(addr, "starting api http server");

    axum::serve(TcpListener::bind(addr).await?, app).await?;

    Ok(())
}

pub fn cors_layer() -> Result<CorsLayer, anyhow::Error> {
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
