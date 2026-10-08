use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::StatusCode,
	response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use tracing::error;
use uuid::Uuid;

use storage::query::{RawEventsQuery, list_sessions, list_topics, query_raw_events, session_bounds, get_initial_event};

use crate::http_server::Context;

#[derive(Debug, Deserialize)]
pub struct SessionsParams {
    pub limit: Option<i64>,
}

pub async fn sessions(
    State(ctx): State<Arc<Context>>,
    Query(params): Query<SessionsParams>,
) -> Response {
    let Some(db) = ctx.db.as_ref() else {
		return (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({ "error": "database not configured" })),
		)
			.into_response();
    };

    let limit = params.limit.unwrap_or(50);

    match list_sessions(db, limit).await {
		Ok(sessions) => (StatusCode::OK, axum::Json(sessions)).into_response(),
        Err(e) => {
            error!(?e, "failed to list sessions");
			(
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": "failed to list sessions" })),
			)
				.into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct TopicsParams {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

pub async fn topics(State(ctx): State<Arc<Context>>, Query(params): Query<TopicsParams>) -> impl IntoResponse {
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

    match list_topics(db, session_id).await {
		Ok(topics) => (StatusCode::OK, axum::Json(topics)).into_response(),
        Err(e) => {
            error!(?e, "failed to list topics");
			(
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": "failed to list topics" })),
			)
				.into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct EventsParams {
    #[serde(rename = "sessionId")]
    pub session_id: String,

    pub topic: Option<String>,
    #[serde(rename = "from")]
    pub from_time: Option<String>,
    #[serde(rename = "to")]
    pub to_time: Option<String>,

    pub cursor: Option<i64>,
    pub limit: Option<i64>,
}

pub async fn events(State(ctx): State<Arc<Context>>, Query(params): Query<EventsParams>) -> impl IntoResponse {
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

    let from_time = match params.from_time.as_deref().map(parse_rfc3339_utc) {
        Some(Some(v)) => Some(v),
        Some(None) => {
			return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({ "error": "invalid from timestamp (RFC3339 expected)" })),
			)
				.into_response()
        }
        None => None,
    };

    let to_time = match params.to_time.as_deref().map(parse_rfc3339_utc) {
        Some(Some(v)) => Some(v),
        Some(None) => {
			return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({ "error": "invalid to timestamp (RFC3339 expected)" })),
			)
				.into_response()
        }
        None => None,
    };

    let q = RawEventsQuery {
        session_id,
        topic: params.topic,
        from_time,
        to_time,
        cursor_id: params.cursor,
        limit: params.limit.unwrap_or(200),
    };

    match query_raw_events(db, q).await {
		Ok(events) => (StatusCode::OK, axum::Json(events)).into_response(),
        Err(e) => {
            error!(?e, "failed to query raw events");
			(
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": "failed to query raw events" })),
			)
				.into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct BoundsParams {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

pub async fn bounds(State(ctx): State<Arc<Context>>, Query(params): Query<BoundsParams>) -> Response {
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

    match session_bounds(db, session_id).await {
        Ok(b) => (StatusCode::OK, axum::Json(b)).into_response(),
        Err(e) => {
            error!(?e, "failed to query session bounds");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": "failed to query session bounds" })),
            )
                .into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct InitialParams {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

pub async fn initial(State(ctx): State<Arc<Context>>, Query(params): Query<InitialParams>) -> Response {
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

    match get_initial_event(db, session_id).await {
        Ok(Some(ev)) => (StatusCode::OK, axum::Json(ev)).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({ "error": "initial event not found" })),
        )
            .into_response(),
        Err(e) => {
            error!(?e, "failed to query initial event");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": "failed to query initial event" })),
            )
                .into_response()
        }
    }
}

fn parse_rfc3339_utc(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

