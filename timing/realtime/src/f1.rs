use anyhow::Error;
use chrono::Utc;
use serde_json::{Map, Value};
use tokio::sync::{broadcast::Sender, mpsc};
use tokio_stream::StreamExt;
use tracing::{error, trace, warn};
use uuid::Uuid;

use crate::services::persist_service::PersistEvent;
use crate::services::state_service::StateService;

const URL: &str = "livetiming.formula1.com/signalr";
const HUB: &str = "Streaming";

const TOPICS: [&str; 20] = [
    "Heartbeat",
    "CarData.z",
    "Position.z",
    "ExtrapolatedClock",
    "TopThree",
    "RcmSeries",
    "TimingStats",
    "TimingAppData",
    "WeatherData",
    "TrackStatus",
    "SessionStatus",
    "DriverList",
    "RaceControlMessages",
    "SessionInfo",
    "SessionData",
    "LapCount",
    "TimingData",
    "TeamRadio",
    "PitLaneTimeCollection",
    "ChampionshipPrediction",
];

pub async fn ingest_f1(
    state_service: StateService,
    update_sender: Sender<String>,
    persist_tx: mpsc::Sender<PersistEvent>,
) -> Result<(), Error> {
    let mut signalr_client = signalr::create_client(URL, HUB).await?;

    let initial_raw = signalr::subscribe(&mut signalr_client, &TOPICS).await?;
    let received_at = Utc::now();

    let initial_normalized = normalize_initial_state(initial_raw.clone());
    let session_id = derive_session_id(&initial_normalized).unwrap_or_else(Uuid::new_v4);

    handle_initial(&state_service, initial_normalized.clone()).await?;

    let _ = persist_tx
        .send(PersistEvent::StartSession {
            session_id,
            received_at,
            initial_raw,
            initial_normalized,
        })
        .await;

    let mut stream = signalr::listen(signalr_client);

    while let Some(items) = stream.next().await {
        for update in items {
            trace!(?update.topic, "Received data for topic");

            if update.topic == "SessionInfo" && update.data.pointer("/Name").is_some() {
                warn!("received SessionInfo event, restarting...");
                let _ = persist_tx
                    .send(PersistEvent::EndSession {
                        session_id,
                        received_at: Utc::now(),
                    })
                    .await;
                return Ok(());
            }

            let topic_raw = update.topic;
            let topic_normalized = normalize_topic(&topic_raw);

            let _ = persist_tx
                .send(PersistEvent::Update {
                    session_id,
                    received_at: Utc::now(),
                    topic_raw: topic_raw.clone(),
                    topic_normalized: topic_normalized.clone(),
                    data: update.data.clone(),
                    signalr_timestamp: update.timestamp,
                })
                .await;

            match handle_update(
                &update_sender,
                &state_service,
                topic_normalized,
                update.data,
            )
            .await
            {
                Ok(_) => trace!("handled update"),
                Err(err) => error!(?err, "failed to handle update"),
            };
        }
    }

    let _ = persist_tx
        .send(PersistEvent::EndSession {
            session_id,
            received_at: Utc::now(),
        })
        .await;

    Ok(())
}

async fn handle_update(
    sender: &Sender<String>,
    state_service: &StateService,
    topic: String,
    update: Value,
) -> Result<(), Error> {
    let mut map = Map::new();
    map.insert(topic, update);
    let update = Value::Object(map);

    match sender.send(update.to_string()) {
        Ok(_) => trace!("sent update to realtime channel"),
        Err(err) => error!(?err, "failed to send update to realtime channel"),
    };

    state_service.update_state(update).await?;

    Ok(())
}

async fn handle_initial(state_service: &StateService, initial: Value) -> Result<(), Error> {
    trace!("handling initial state");
    state_service.set_state(initial).await?;
    Ok(())
}

fn derive_session_id(initial_normalized: &Value) -> Option<Uuid> {
    let session_info = initial_normalized.get("SessionInfo")?;

    let meeting_key = session_info
        .get("Meeting")
        .and_then(|v| v.get("Key"))
        .and_then(|v| v.as_i64());

    let session_key = session_info.get("Key").and_then(|v| v.as_i64());

    let session_path = session_info
        .get("Path")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let start_date = session_info
        .get("StartDate")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match (meeting_key, session_key) {
        (Some(mk), Some(sk)) => {
            let name = format!("f1a|meeting:{mk}|session:{sk}|path:{session_path}|start:{start_date}");
            Some(Uuid::new_v5(&Uuid::NAMESPACE_URL, name.as_bytes()))
        }
        _ => None,
    }
}

fn normalize_topic(topic: &str) -> String {
    match topic.strip_suffix(".z") {
        Some(prefix) => format!("{prefix}Z"),
        None => topic.to_string(),
    }
}

fn normalize_initial_state(initial_raw: Value) -> Value {
    let Value::Object(map) = initial_raw else {
        return initial_raw;
    };

    let normalized = map
        .into_iter()
        .map(|(k, v)| (normalize_topic(&k), v))
        .collect();

    Value::Object(normalized)
}
