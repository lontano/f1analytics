use std::{env, path::PathBuf};

use anyhow::Error;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use chrono::{DateTime, Utc};
use flate2::{Compression, read::DeflateDecoder, write::GzEncoder};
use serde_json::{Map, Value};
use tokio::{
    fs,
    io::{AsyncWriteExt, BufWriter},
    sync::mpsc,
    task,
};
use tracing::{error, info, warn};
use uuid::Uuid;

use storage::{
    DbPool,
    ingest::{
        PositionCarRow, RaceControlMessageRow, RawEvent, SessionMeta, TeamRadioRow, TelemetryCarRow,
        TimingDriverRow, TireDriverRow, WeatherRow, end_session, insert_position_rows,
        insert_race_control_messages, insert_raw_event, insert_team_radio_rows,
        insert_telemetry_rows, insert_timing_rows, insert_tire_rows, insert_weather, upsert_session,
    },
};

use crate::services::state_service::merge;

#[derive(Clone, Debug)]
pub enum PersistEvent {
    StartSession {
        session_id: Uuid,
        received_at: DateTime<Utc>,
        initial_raw: Value,
        initial_normalized: Value,
    },
    Update {
        session_id: Uuid,
        received_at: DateTime<Utc>,
        topic_raw: String,
        topic_normalized: String,
        data: Value,
        signalr_timestamp: String,
    },
    EndSession {
        session_id: Uuid,
        received_at: DateTime<Utc>,
    },
}

#[derive(Clone)]
pub struct PersistHandle {
    pub tx: mpsc::Sender<PersistEvent>,
}

pub fn start_persist_service(pool: Option<DbPool>) -> PersistHandle {
    let (tx, rx) = mpsc::channel::<PersistEvent>(4096);

    tokio::spawn(async move {
        if let Err(e) = persist_worker(rx, pool).await {
            error!(?e, "persist worker crashed");
        }
    });

    PersistHandle { tx }
}

struct RecordingWriter {
    path: PathBuf,
    writer: BufWriter<fs::File>,
}

impl RecordingWriter {
    async fn new(data_dir: &str, session_id: Uuid) -> Result<Self, Error> {
        let mut path = PathBuf::from(data_dir);
        path.push("recordings");
        path.push(session_id.to_string());
        fs::create_dir_all(&path).await?;

        let mut file_path = path.clone();
        file_path.push("events.jsonl");

        let file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
            .await?;

        Ok(Self {
            path: file_path,
            writer: BufWriter::new(file),
        })
    }

    async fn write_line(&mut self, line: &str) -> Result<(), Error> {
        self.writer.write_all(line.as_bytes()).await?;
        self.writer.write_all(b"\n").await?;
        Ok(())
    }

    async fn flush(&mut self) -> Result<(), Error> {
        self.writer.flush().await?;
        Ok(())
    }
}

async fn compress_jsonl_gzip(path: PathBuf) -> Result<Option<PathBuf>, Error> {
    if !fs::try_exists(&path).await? {
        return Ok(None);
    }

    let mut gz_path = path.clone();
    gz_path.set_extension("jsonl.gz");

    let src = path.clone();
    let dst = gz_path.clone();

    task::spawn_blocking(move || -> Result<(), Error> {
        let mut input = std::fs::File::open(src)?;
        let output = std::fs::File::create(dst)?;

        let mut encoder = GzEncoder::new(output, Compression::default());
        std::io::copy(&mut input, &mut encoder)?;
        encoder.finish()?;

        Ok(())
    })
    .await??;

    // Keep the compressed recording as the source of truth.
    // If deletion fails (e.g. antivirus lock), the uncompressed file is still usable.
    let _ = fs::remove_file(&path).await;

    Ok(Some(gz_path))
}

async fn persist_worker(
    mut rx: mpsc::Receiver<PersistEvent>,
    pool: Option<DbPool>,
) -> Result<(), Error> {
    let data_dir = env::var("DATA_DIR").unwrap_or_else(|_| "data".to_string());
    if pool.is_some() {
        info!("db enabled: persisting raw + derived data");
    } else {
        warn!("db disabled: recording to disk only");
    }

    let mut current_session: Option<Uuid> = None;
    let mut recording: Option<RecordingWriter> = None;
    let mut state: Value = Value::Object(serde_json::Map::new());

    while let Some(event) = rx.recv().await {
        match event {
            PersistEvent::StartSession {
                session_id,
                received_at,
                initial_raw,
                initial_normalized,
            } => {
                if let Some(curr) = current_session {
                    warn!(?curr, ?session_id, "received StartSession while another session is active, closing previous");
                }

                current_session = Some(session_id);
                state = initial_normalized.clone();

                match RecordingWriter::new(&data_dir, session_id).await {
                    Ok(mut w) => {
                        let line = format!(
                            r#"{{"type":"initial","receivedAt":"{}","sessionId":"{}","state":{}}}"#,
                            received_at.to_rfc3339(),
                            &session_id,
                            &initial_raw
                        );
                        if let Err(e) = w.write_line(&line).await {
                            error!(?e, "failed to write initial recording line");
                        }
                        recording = Some(w);
                    }
                    Err(e) => {
                        error!(?e, "failed to create recording writer");
                        recording = None;
                    }
                }

                if let Some(pool) = pool.as_ref() {
                    if let Err(e) = persist_initial(pool, session_id, received_at, &state, &initial_raw).await {
                        error!(?e, "failed to persist initial state");
                    }
                }
            }
            PersistEvent::Update {
                session_id,
                received_at,
                topic_raw,
                topic_normalized,
                data,
                signalr_timestamp,
            } => {
                // Keep a normalized in-memory state for derived parsing.
                let mut map = Map::new();
                map.insert(topic_normalized.clone(), data.clone());
                merge(&mut state, Value::Object(map));

                if let Some(w) = recording.as_mut() {
                    let topic_json = serde_json::to_string(&topic_raw).unwrap_or_else(|_| "\"\"".to_string());
                    let normalized_topic_json =
                        serde_json::to_string(&topic_normalized).unwrap_or_else(|_| "\"\"".to_string());
                    let ts_json =
                        serde_json::to_string(&signalr_timestamp).unwrap_or_else(|_| "\"\"".to_string());

                    let line = format!(
                        r#"{{"type":"update","receivedAt":"{}","sessionId":"{}","topic":{},"normalizedTopic":{},"signalrTimestamp":{},"data":{}}}"#,
                        received_at.to_rfc3339(),
                        &session_id,
                        topic_json,
                        normalized_topic_json,
                        ts_json,
                        &data
                    );

                    if let Err(e) = w.write_line(&line).await {
                        error!(?e, "failed to write update recording line");
                    }
                }

                if let Some(pool) = pool.as_ref() {
                    if let Err(e) = persist_update(
                        pool,
                        session_id,
                        received_at,
                        &signalr_timestamp,
                        &topic_raw,
                        &topic_normalized,
                        &state,
                        &data,
                    )
                    .await
                    {
                        error!(?e, "failed to persist update");
                    }
                }
            }
            PersistEvent::EndSession {
                session_id,
                received_at,
            } => {
                if let Some(pool) = pool.as_ref() {
                    if let Err(e) = end_session(pool, session_id, received_at).await {
                        error!(?e, "failed to mark session ended");
                    }
                }

                let recording_path = if let Some(mut w) = recording.take() {
                    let path = w.path.clone();
                    if let Err(e) = w.flush().await {
                        error!(?e, "failed to flush recording");
                    } else {
                        info!(path = %path.display(), "recording flushed");
                    }
                    Some(path)
                } else {
                    None
                };

                if let Some(path) = recording_path {
                    match compress_jsonl_gzip(path).await {
                        Ok(Some(gz)) => info!(path = %gz.display(), "recording compressed"),
                        Ok(None) => {}
                        Err(e) => error!(?e, "failed to compress recording"),
                    }
                }

                current_session = None;
                state = Value::Object(serde_json::Map::new());
            }
        }
    }

    Ok(())
}

async fn persist_initial(
    pool: &DbPool,
    session_id: Uuid,
    received_at: DateTime<Utc>,
    normalized_state: &Value,
    raw_state: &Value,
) -> Result<(), Error> {
    let session_info = normalized_state.get("SessionInfo").cloned();

    let (meeting_key, session_key, session_name, session_type, session_path, start_date, end_date) =
        parse_session_info(&session_info);

    let meta = SessionMeta {
        id: session_id,
        started_at: Some(received_at),
        ended_at: None,
        session_info,
        meeting_key,
        session_key,
        session_name,
        session_type,
        session_path,
        start_date,
        end_date,
    };

    upsert_session(pool, &meta).await?;

    let raw_event = RawEvent {
        time: received_at,
        received_at,
        session_id,
        event_type: "initial".to_string(),
        topic: None,
        data: raw_state.clone(),
        signalr_timestamp: None,
    };

    insert_raw_event(pool, &raw_event).await?;

    Ok(())
}

async fn persist_update(
    pool: &DbPool,
    session_id: Uuid,
    received_at: DateTime<Utc>,
    signalr_timestamp: &str,
    topic_raw: &str,
    topic_normalized: &str,
    normalized_state: &Value,
    update_payload: &Value,
) -> Result<(), Error> {
    let parsed_ts = parse_rfc3339_utc(signalr_timestamp);
    let event_time = parsed_ts.unwrap_or(received_at);

    let raw_event = RawEvent {
        time: event_time,
        received_at,
        session_id,
        event_type: "update".to_string(),
        topic: Some(topic_raw.to_string()),
        data: update_payload.clone(),
        signalr_timestamp: Some(signalr_timestamp.to_string()),
    };

    insert_raw_event(pool, &raw_event).await?;

    // Derived tables (best-effort; raw_events remains authoritative).
    match topic_normalized {
        "CarDataZ" | "CarData.z" => {
            if let Some(b64) = update_payload.as_str() {
                if let Ok(rows) = decode_telemetry(session_id, b64) {
                    let _ = insert_telemetry_rows(pool, &rows).await;
                }
            }
        }
        "PositionZ" | "Position.z" => {
            if let Some(b64) = update_payload.as_str() {
                if let Ok(rows) = decode_positions(session_id, b64) {
                    let _ = insert_position_rows(pool, &rows).await;
                }
            }
        }
        "TimingData" => {
            let rows = decode_timing_rows(session_id, event_time, normalized_state, update_payload);
            let _ = insert_timing_rows(pool, &rows).await;
        }
        "TimingAppData" => {
            let rows = decode_tire_rows(session_id, event_time, normalized_state, update_payload);
            let _ = insert_tire_rows(pool, &rows).await;
        }
        "WeatherData" => {
            if let Some(row) = decode_weather_row(session_id, event_time, normalized_state) {
                let _ = insert_weather(pool, &row).await;
            }
        }
        "RaceControlMessages" => {
            let rows = decode_race_control_messages(session_id, update_payload);
            let _ = insert_race_control_messages(pool, &rows).await;
        }
        "TeamRadio" => {
            let rows = decode_team_radio(session_id, update_payload);
            let _ = insert_team_radio_rows(pool, &rows).await;
        }
        _ => {}
    }

    Ok(())
}

fn parse_rfc3339_utc(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn parse_session_info(
    session_info: &Option<Value>,
) -> (
    Option<i32>,
    Option<i32>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<DateTime<Utc>>,
    Option<DateTime<Utc>>,
) {
    let Some(si) = session_info.as_ref() else {
        return (None, None, None, None, None, None, None);
    };

    let meeting_key = si
        .get("Meeting")
        .and_then(|v| v.get("Key"))
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);

    let session_key = si.get("Key").and_then(|v| v.as_i64()).map(|v| v as i32);

    let session_name = si.get("Name").and_then(|v| v.as_str()).map(|v| v.to_string());

    let session_type = si.get("Type").and_then(|v| v.as_str()).map(|v| v.to_string());

    let session_path = si.get("Path").and_then(|v| v.as_str()).map(|v| v.to_string());

    let start_date = si
        .get("StartDate")
        .and_then(|v| v.as_str())
        .and_then(parse_rfc3339_utc);

    let end_date = si
        .get("EndDate")
        .and_then(|v| v.as_str())
        .and_then(parse_rfc3339_utc);

    (
        meeting_key,
        session_key,
        session_name,
        session_type,
        session_path,
        start_date,
        end_date,
    )
}

fn inflate_raw_base64(data: &str) -> Result<Value, Error> {
    let bytes = B64.decode(data)?;

    let mut decoder = DeflateDecoder::new(bytes.as_slice());
    let mut out = String::new();
    std::io::Read::read_to_string(&mut decoder, &mut out)?;

    Ok(serde_json::from_str(&out)?)
}

fn decode_telemetry(session_id: Uuid, b64: &str) -> Result<Vec<TelemetryCarRow>, Error> {
    let v = inflate_raw_base64(b64)?;
    let mut rows = Vec::new();

    let Some(entries) = v.get("Entries").and_then(|x| x.as_array()) else {
        return Ok(rows);
    };

    for entry in entries {
        let time = entry
            .get("Utc")
            .and_then(|x| x.as_str())
            .and_then(parse_rfc3339_utc)
            .unwrap_or_else(Utc::now);

        let Some(cars) = entry.get("Cars").and_then(|x| x.as_object()) else {
            continue;
        };

        for (nr, car) in cars {
            let Ok(driver_nr) = nr.parse::<i16>() else {
                continue;
            };

            let channels = car.get("Channels").and_then(|x| x.as_object());
            let speed_kmh = channels
                .and_then(|c| c.get("2"))
                .and_then(|x| x.as_i64())
                .map(|x| x as i32);
            let rpm = channels
                .and_then(|c| c.get("0"))
                .and_then(|x| x.as_i64())
                .map(|x| x as i32);
            let gear = channels
                .and_then(|c| c.get("3"))
                .and_then(|x| x.as_i64())
                .map(|x| x as i16);
            let throttle = channels
                .and_then(|c| c.get("4"))
                .and_then(|x| x.as_i64())
                .map(|x| x as i16);
            let brake = channels
                .and_then(|c| c.get("5"))
                .and_then(|x| x.as_i64())
                .map(|x| x != 0);
            let drs = channels
                .and_then(|c| c.get("45"))
                .and_then(|x| x.as_i64())
                .map(|x| x as i16);

            rows.push(TelemetryCarRow {
                time,
                session_id,
                driver_nr,
                speed_kmh,
                rpm,
                gear,
                throttle,
                brake,
                drs,
            });
        }
    }

    Ok(rows)
}

fn decode_positions(session_id: Uuid, b64: &str) -> Result<Vec<PositionCarRow>, Error> {
    let v = inflate_raw_base64(b64)?;
    let mut rows = Vec::new();

    let Some(positions) = v.get("Position").and_then(|x| x.as_array()) else {
        return Ok(rows);
    };

    for item in positions {
        let time = item
            .get("Timestamp")
            .and_then(|x| x.as_str())
            .and_then(parse_rfc3339_utc)
            .unwrap_or_else(Utc::now);

        let Some(entries) = item.get("Entries").and_then(|x| x.as_object()) else {
            continue;
        };

        for (nr, car) in entries {
            let Ok(driver_nr) = nr.parse::<i16>() else {
                continue;
            };

            let status = car.get("Status").and_then(|x| x.as_str()).map(|x| x.to_string());
            let x = car.get("X").and_then(|x| x.as_f64());
            let y = car.get("Y").and_then(|x| x.as_f64());
            let z = car.get("Z").and_then(|x| x.as_f64());

            rows.push(PositionCarRow {
                time,
                session_id,
                driver_nr,
                status,
                x,
                y,
                z,
            });
        }
    }

    Ok(rows)
}

fn parse_gap_ms(value: &str) -> Option<i64> {
    let v = value.trim();
    if v.is_empty() {
        return None;
    }

    // \"1L\", \"2L\", \"LAP1\", etc.
    if v.contains('L') {
        return None;
    }

    let v = v.trim_start_matches('+');
    let seconds = v.parse::<f64>().ok()?;
    Some((seconds * 1000.0) as i64)
}

fn parse_laptime_ms(value: &str) -> Option<i64> {
    let v = value.trim();
    if v.is_empty() {
        return None;
    }

    let parts: Vec<&str> = v.split(':').collect();
    if parts.len() == 2 {
        let minutes = parts[0].parse::<i64>().ok()?;
        let seconds = parts[1].parse::<f64>().ok()?;
        return Some(minutes * 60_000 + (seconds * 1000.0) as i64);
    }

    let seconds = v.parse::<f64>().ok()?;
    Some((seconds * 1000.0) as i64)
}

fn parse_sector_ms(value: &str) -> Option<i64> {
    let v = value.trim();
    if v.is_empty() {
        return None;
    }

    let seconds = v.parse::<f64>().ok()?;
    Some((seconds * 1000.0) as i64)
}

fn parse_i32_value(v: &Value) -> Option<i32> {
    if let Some(n) = v.as_i64() {
        return Some(n as i32);
    }
    if let Some(s) = v.as_str() {
        return s.parse::<i32>().ok();
    }
    None
}

fn decode_timing_rows(
    session_id: Uuid,
    time: DateTime<Utc>,
    state: &Value,
    update: &Value,
) -> Vec<TimingDriverRow> {
    // Prefer per-driver lap count; fall back to session lap if needed.
    let session_lap = state
        .get("LapCount")
        .and_then(|v| v.get("CurrentLap"))
        .and_then(parse_i32_value);

    let changed_lines = update
        .get("Lines")
        .and_then(|v| v.as_object())
        .map(|m| m.keys().cloned().collect::<Vec<String>>())
        .unwrap_or_default();

    let lines_state = state
        .get("TimingData")
        .and_then(|v| v.get("Lines"))
        .and_then(|v| v.as_object());

    let Some(lines_state) = lines_state else {
        return vec![];
    };

    let mut rows = Vec::new();

    for nr in changed_lines {
        let Ok(driver_nr) = nr.parse::<i16>() else {
            continue;
        };

        let Some(driver) = lines_state.get(&nr) else {
            continue;
        };

        let position = driver
            .get("Position")
            .and_then(|v| v.as_str())
            .and_then(|v| v.parse::<i32>().ok());

        let leader_gap_ms = driver
            .get("GapToLeader")
            .and_then(|v| v.as_str())
            .and_then(parse_gap_ms);

        let gap_ms = driver
            .get("IntervalToPositionAhead")
            .and_then(|v| v.get("Value"))
            .and_then(|v| v.as_str())
            .and_then(parse_gap_ms);

        let last_laptime_ms = driver
            .get("LastLapTime")
            .and_then(|v| v.get("Value"))
            .and_then(|v| v.as_str())
            .and_then(parse_laptime_ms);

        let driver_lap = driver
            .get("NumberOfLaps")
            .and_then(parse_i32_value);

        let sectors = driver.get("Sectors").and_then(|v| v.as_array());
        let sector1_ms = sectors
            .and_then(|s| s.get(0))
            .and_then(|v| v.get("Value"))
            .and_then(|v| v.as_str())
            .and_then(parse_sector_ms);
        let sector2_ms = sectors
            .and_then(|s| s.get(1))
            .and_then(|v| v.get("Value"))
            .and_then(|v| v.as_str())
            .and_then(parse_sector_ms);
        let sector3_ms = sectors
            .and_then(|s| s.get(2))
            .and_then(|v| v.get("Value"))
            .and_then(|v| v.as_str())
            .and_then(parse_sector_ms);

        let in_pit_segment = {
            let in_pit = driver.get("InPit").and_then(|v| v.as_bool()).unwrap_or(false);
            let has_2064 = driver
                .get("Sectors")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter().any(|sector| {
                        sector
                            .get("Segments")
                            .and_then(|v| v.as_array())
                            .map(|segs| {
                                segs.iter().any(|seg| {
                                    seg.get("Status")
                                        .and_then(|v| v.as_i64())
                                        .map(|s| s == 2064)
                                        .unwrap_or(false)
                                })
                            })
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false);
            Some(in_pit || has_2064)
        };

        rows.push(TimingDriverRow {
            time,
            session_id,
            driver_nr,
            lap: driver_lap.or(session_lap),
            position,
            gap_ms,
            leader_gap_ms,
            last_laptime_ms,
            sector1_ms,
            sector2_ms,
            sector3_ms,
            in_pit_segment,
        });
    }

    rows
}

fn decode_tire_rows(
    session_id: Uuid,
    time: DateTime<Utc>,
    state: &Value,
    update: &Value,
) -> Vec<TireDriverRow> {
    // Prefer per-driver lap count from TimingData; fall back to session lap if needed.
    let session_lap = state
        .get("LapCount")
        .and_then(|v| v.get("CurrentLap"))
        .and_then(parse_i32_value);

    let timing_lines = state
        .get("TimingData")
        .and_then(|v| v.get("Lines"))
        .and_then(|v| v.as_object());

    let changed_lines = update
        .get("Lines")
        .and_then(|v| v.as_object())
        .map(|m| m.keys().cloned().collect::<Vec<String>>())
        .unwrap_or_default();

    let lines_state = state
        .get("TimingAppData")
        .and_then(|v| v.get("Lines"))
        .and_then(|v| v.as_object());

    let Some(lines_state) = lines_state else {
        return vec![];
    };

    let mut rows = Vec::new();

    for nr in changed_lines {
        let Ok(driver_nr) = nr.parse::<i16>() else {
            continue;
        };

        let Some(driver) = lines_state.get(&nr) else {
            continue;
        };

        let stint = driver
            .get("Stints")
            .and_then(|v| v.as_array())
            .and_then(|v| v.last());

        let compound = stint
            .and_then(|v| v.get("Compound"))
            .and_then(|v| v.as_str())
            .map(|v| v.to_string());

        let stint_laps = stint
            .and_then(|v| v.get("TotalLaps"))
            .and_then(|v| v.as_i64())
            .map(|v| v as i32);

        let driver_lap = timing_lines
            .and_then(|lines| lines.get(&nr))
            .and_then(|v| v.get("NumberOfLaps"))
            .and_then(parse_i32_value);

        rows.push(TireDriverRow {
            time,
            session_id,
            driver_nr,
            lap: driver_lap.or(session_lap),
            compound,
            stint_laps,
        });
    }

    rows
}

fn decode_weather_row(session_id: Uuid, time: DateTime<Utc>, state: &Value) -> Option<WeatherRow> {
    let w = state.get("WeatherData")?;

    Some(WeatherRow {
        time,
        session_id,
        air_temp: w.get("AirTemp").and_then(|v| v.as_str()).map(|v| v.to_string()),
        track_temp: w.get("TrackTemp").and_then(|v| v.as_str()).map(|v| v.to_string()),
        humidity: w.get("Humidity").and_then(|v| v.as_str()).map(|v| v.to_string()),
        pressure: w.get("Pressure").and_then(|v| v.as_str()).map(|v| v.to_string()),
        rainfall: w.get("Rainfall").and_then(|v| v.as_str()).map(|v| v.to_string()),
        wind_direction: w
            .get("WindDirection")
            .and_then(|v| v.as_str())
            .map(|v| v.to_string()),
        wind_speed: w.get("WindSpeed").and_then(|v| v.as_str()).map(|v| v.to_string()),
    })
}

fn decode_race_control_messages(session_id: Uuid, update: &Value) -> Vec<RaceControlMessageRow> {
    let Some(messages) = update
        .get("Messages")
        .and_then(|v| v.as_array())
    else {
        return vec![];
    };

    let mut rows = Vec::new();

    for msg in messages {
        let time = msg
            .get("Utc")
            .and_then(|v| v.as_str())
            .and_then(parse_rfc3339_utc)
            .unwrap_or_else(Utc::now);

        rows.push(RaceControlMessageRow {
            time,
            session_id,
            lap: msg.get("Lap").and_then(|v| v.as_i64()).map(|v| v as i32),
            category: msg
                .get("Category")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            message: msg
                .get("Message")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            flag: msg.get("Flag").and_then(|v| v.as_str()).map(|v| v.to_string()),
            scope: msg.get("Scope").and_then(|v| v.as_str()).map(|v| v.to_string()),
            sector: msg.get("Sector").and_then(|v| v.as_i64()).map(|v| v as i32),
            status: msg.get("Status").and_then(|v| v.as_str()).map(|v| v.to_string()),
        });
    }

    rows
}

fn decode_team_radio(session_id: Uuid, update: &Value) -> Vec<TeamRadioRow> {
    let Some(captures) = update
        .get("Captures")
        .and_then(|v| v.as_array())
    else {
        return vec![];
    };

    let mut rows = Vec::new();

    for cap in captures {
        let time = cap
            .get("Utc")
            .and_then(|v| v.as_str())
            .and_then(parse_rfc3339_utc)
            .unwrap_or_else(Utc::now);

        let driver_nr = cap
            .get("RacingNumber")
            .and_then(|v| v.as_str())
            .and_then(|v| v.parse::<i16>().ok());

        let path = cap.get("Path").and_then(|v| v.as_str()).map(|v| v.to_string());

        rows.push(TeamRadioRow {
            time,
            session_id,
            driver_nr,
            path,
        });
    }

    rows
}

