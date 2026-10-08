use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use tracing::error;
use uuid::Uuid;

use storage::query::{
    list_session_drivers, query_pit_windows, query_session_laps, query_session_stints,
};

use crate::http_server::Context;

#[derive(Debug, Deserialize)]
pub struct SessionIdParams {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

pub async fn drivers(
    State(ctx): State<Arc<Context>>,
    Query(params): Query<SessionIdParams>,
) -> Response {
    let Some(db) = ctx.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({ "error": "database not configured" })),
        )
            .into_response();
    };

    let session_id = match Uuid::parse_str(&params.session_id) {
        Ok(id) => id,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({ "error": "invalid sessionId" })),
            )
                .into_response()
        }
    };

    match list_session_drivers(db, session_id).await {
        Ok(drivers) => (StatusCode::OK, axum::Json(drivers)).into_response(),
        Err(e) => {
            error!(?e, "failed to list session drivers");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": "failed to list session drivers" })),
            )
                .into_response()
        }
    }
}

pub async fn laps(
    State(ctx): State<Arc<Context>>,
    Query(params): Query<SessionIdParams>,
) -> Response {
    let Some(db) = ctx.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({ "error": "database not configured" })),
        )
            .into_response();
    };

    let session_id = match Uuid::parse_str(&params.session_id) {
        Ok(id) => id,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({ "error": "invalid sessionId" })),
            )
                .into_response()
        }
    };

    match query_session_laps(db, session_id).await {
        Ok(laps) => (StatusCode::OK, axum::Json(laps)).into_response(),
        Err(e) => {
            error!(?e, "failed to query session laps");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": "failed to query session laps" })),
            )
                .into_response()
        }
    }
}

pub async fn stints(
    State(ctx): State<Arc<Context>>,
    Query(params): Query<SessionIdParams>,
) -> Response {
    let Some(db) = ctx.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({ "error": "database not configured" })),
        )
            .into_response();
    };

    let session_id = match Uuid::parse_str(&params.session_id) {
        Ok(id) => id,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({ "error": "invalid sessionId" })),
            )
                .into_response()
        }
    };

    match query_session_stints(db, session_id).await {
        Ok(stints) => (StatusCode::OK, axum::Json(stints)).into_response(),
        Err(e) => {
            error!(?e, "failed to query session stints");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": "failed to query session stints" })),
            )
                .into_response()
        }
    }
}

pub async fn pit_windows(
    State(ctx): State<Arc<Context>>,
    Query(params): Query<SessionIdParams>,
) -> Response {
    let Some(db) = ctx.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({ "error": "database not configured" })),
        )
            .into_response();
    };

    let session_id = match Uuid::parse_str(&params.session_id) {
        Ok(id) => id,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({ "error": "invalid sessionId" })),
            )
                .into_response()
        }
    };

    match query_pit_windows(db, session_id).await {
        Ok(windows) => (StatusCode::OK, axum::Json(windows)).into_response(),
        Err(e) => {
            error!(?e, "failed to query pit windows");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": "failed to query pit windows" })),
            )
                .into_response()
        }
    }
}
