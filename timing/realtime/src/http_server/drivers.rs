use std::sync::Arc;

use axum::{extract::State, http::StatusCode, response::IntoResponse};
use serde_json::Value;

use crate::http_server::Context;

fn map_to_vec(value: Value) -> Vec<Value> {
    match value {
        Value::Object(map) => map
            .into_iter()
            .filter(|(_, v)| v.is_object())
            .map(|(_, v)| v)
            .collect(),
        _ => vec![],
    }
}

pub async fn drivers(State(ctx): State<Arc<Context>>) -> impl IntoResponse {
    match ctx.state_service.get_state().await {
        Ok(state) => {
            let drivers = state
                .pointer("/DriverList")
                .cloned()
                .map(map_to_vec)
                .unwrap_or_default();
            Ok(axum::Json(drivers))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({
                "error": format!("Failed to get current state: {}", e),
            })),
        )),
    }
}
