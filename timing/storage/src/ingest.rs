use anyhow::Error;
use chrono::{DateTime, Utc};
use serde_json::Value;
use uuid::Uuid;

use crate::DbPool;

#[derive(Clone, Debug)]
pub struct SessionMeta {
    pub id: Uuid,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,

    pub session_info: Option<Value>,

    pub meeting_key: Option<i32>,
    pub session_key: Option<i32>,
    pub session_name: Option<String>,
    pub session_type: Option<String>,
    pub session_path: Option<String>,

    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
}

pub async fn upsert_session(pool: &DbPool, meta: &SessionMeta) -> Result<(), Error> {
    sqlx::query(
        r#"
insert into sessions (
  id,
  started_at,
  ended_at,
  session_info,
  meeting_key,
  session_key,
  session_name,
  session_type,
  session_path,
  start_date,
  end_date
)
values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
on conflict (id) do update set
  started_at   = coalesce(excluded.started_at, sessions.started_at),
  ended_at     = coalesce(excluded.ended_at, sessions.ended_at),
  session_info = coalesce(excluded.session_info, sessions.session_info),
  meeting_key  = coalesce(excluded.meeting_key, sessions.meeting_key),
  session_key  = coalesce(excluded.session_key, sessions.session_key),
  session_name = coalesce(excluded.session_name, sessions.session_name),
  session_type = coalesce(excluded.session_type, sessions.session_type),
  session_path = coalesce(excluded.session_path, sessions.session_path),
  start_date   = coalesce(excluded.start_date, sessions.start_date),
  end_date     = coalesce(excluded.end_date, sessions.end_date)
"#,
    )
    .bind(meta.id)
    .bind(meta.started_at)
    .bind(meta.ended_at)
    .bind(meta.session_info.clone())
    .bind(meta.meeting_key)
    .bind(meta.session_key)
    .bind(meta.session_name.clone())
    .bind(meta.session_type.clone())
    .bind(meta.session_path.clone())
    .bind(meta.start_date)
    .bind(meta.end_date)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn end_session(pool: &DbPool, id: Uuid, ended_at: DateTime<Utc>) -> Result<(), Error> {
    sqlx::query(r#"update sessions set ended_at = $2 where id = $1"#)
        .bind(id)
        .bind(ended_at)
        .execute(pool)
        .await?;

    Ok(())
}

#[derive(Clone, Debug)]
pub struct RawEvent {
    pub time: DateTime<Utc>,
    pub received_at: DateTime<Utc>,

    pub session_id: Uuid,
    pub event_type: String,
    pub topic: Option<String>,

    pub data: Value,
    pub signalr_timestamp: Option<String>,
}

pub async fn insert_raw_event(pool: &DbPool, event: &RawEvent) -> Result<(), Error> {
    sqlx::query(
        r#"
insert into raw_events (
  time,
  received_at,
  session_id,
  event_type,
  topic,
  data,
  signalr_timestamp
)
values ($1,$2,$3,$4,$5,$6,$7)
"#,
    )
    .bind(event.time)
    .bind(event.received_at)
    .bind(event.session_id)
    .bind(&event.event_type)
    .bind(event.topic.as_deref())
    .bind(event.data.clone())
    .bind(event.signalr_timestamp.as_deref())
    .execute(pool)
    .await?;

    Ok(())
}

#[derive(Clone, Debug)]
pub struct TelemetryCarRow {
    pub time: DateTime<Utc>,
    pub session_id: Uuid,
    pub driver_nr: i16,

    pub speed_kmh: Option<i32>,
    pub rpm: Option<i32>,
    pub gear: Option<i16>,
    pub throttle: Option<i16>,
    pub brake: Option<bool>,
    pub drs: Option<i16>,
}

pub async fn insert_telemetry_rows(pool: &DbPool, rows: &[TelemetryCarRow]) -> Result<(), Error> {
    if rows.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;

    for row in rows {
        sqlx::query(
            r#"
insert into telemetry_car (
  time, session_id, driver_nr,
  speed_kmh, rpm, gear, throttle, brake, drs
)
values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
"#,
        )
        .bind(row.time)
        .bind(row.session_id)
        .bind(row.driver_nr)
        .bind(row.speed_kmh)
        .bind(row.rpm)
        .bind(row.gear)
        .bind(row.throttle)
        .bind(row.brake)
        .bind(row.drs)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

#[derive(Clone, Debug)]
pub struct PositionCarRow {
    pub time: DateTime<Utc>,
    pub session_id: Uuid,
    pub driver_nr: i16,

    pub status: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub z: Option<f64>,
}

pub async fn insert_position_rows(pool: &DbPool, rows: &[PositionCarRow]) -> Result<(), Error> {
    if rows.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;

    for row in rows {
        sqlx::query(
            r#"
insert into position_car (
  time, session_id, driver_nr,
  status, x, y, z
)
values ($1,$2,$3,$4,$5,$6,$7)
"#,
        )
        .bind(row.time)
        .bind(row.session_id)
        .bind(row.driver_nr)
        .bind(row.status.as_deref())
        .bind(row.x)
        .bind(row.y)
        .bind(row.z)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

#[derive(Clone, Debug)]
pub struct TimingDriverRow {
    pub time: DateTime<Utc>,
    pub session_id: Uuid,
    pub driver_nr: i16,

    pub lap: Option<i32>,
    pub position: Option<i32>,

    pub gap_ms: Option<i64>,
    pub leader_gap_ms: Option<i64>,

    pub last_laptime_ms: Option<i64>,
    pub sector1_ms: Option<i64>,
    pub sector2_ms: Option<i64>,
    pub sector3_ms: Option<i64>,

    /// True when driver is in pit or any mini-sector has Status 2064 (pit lane).
    pub in_pit_segment: Option<bool>,
}

pub async fn insert_timing_rows(pool: &DbPool, rows: &[TimingDriverRow]) -> Result<(), Error> {
    if rows.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;

    for row in rows {
        sqlx::query(
            r#"
insert into timing_driver (
  time, session_id, driver_nr,
  lap, position,
  gap_ms, leader_gap_ms,
  last_laptime_ms, sector1_ms, sector2_ms, sector3_ms,
  in_pit_segment
)
values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
"#,
        )
        .bind(row.time)
        .bind(row.session_id)
        .bind(row.driver_nr)
        .bind(row.lap)
        .bind(row.position)
        .bind(row.gap_ms)
        .bind(row.leader_gap_ms)
        .bind(row.last_laptime_ms)
        .bind(row.sector1_ms)
        .bind(row.sector2_ms)
        .bind(row.sector3_ms)
        .bind(row.in_pit_segment)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

#[derive(Clone, Debug)]
pub struct TireDriverRow {
    pub time: DateTime<Utc>,
    pub session_id: Uuid,
    pub driver_nr: i16,

    pub lap: Option<i32>,
    pub compound: Option<String>,
    pub stint_laps: Option<i32>,
}

pub async fn insert_tire_rows(pool: &DbPool, rows: &[TireDriverRow]) -> Result<(), Error> {
    if rows.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;

    for row in rows {
        sqlx::query(
            r#"
insert into tire_driver (
  time, session_id, driver_nr,
  lap, compound, stint_laps
)
values ($1,$2,$3,$4,$5,$6)
"#,
        )
        .bind(row.time)
        .bind(row.session_id)
        .bind(row.driver_nr)
        .bind(row.lap)
        .bind(row.compound.as_deref())
        .bind(row.stint_laps)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

#[derive(Clone, Debug)]
pub struct WeatherRow {
    pub time: DateTime<Utc>,
    pub session_id: Uuid,

    pub air_temp: Option<String>,
    pub track_temp: Option<String>,
    pub humidity: Option<String>,
    pub pressure: Option<String>,
    pub rainfall: Option<String>,
    pub wind_direction: Option<String>,
    pub wind_speed: Option<String>,
}

pub async fn insert_weather(pool: &DbPool, row: &WeatherRow) -> Result<(), Error> {
    sqlx::query(
        r#"
insert into weather (
  time, session_id,
  air_temp, track_temp, humidity, pressure, rainfall, wind_direction, wind_speed
)
values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
"#,
    )
    .bind(row.time)
    .bind(row.session_id)
    .bind(row.air_temp.as_deref())
    .bind(row.track_temp.as_deref())
    .bind(row.humidity.as_deref())
    .bind(row.pressure.as_deref())
    .bind(row.rainfall.as_deref())
    .bind(row.wind_direction.as_deref())
    .bind(row.wind_speed.as_deref())
    .execute(pool)
    .await?;

    Ok(())
}

#[derive(Clone, Debug)]
pub struct RaceControlMessageRow {
    pub time: DateTime<Utc>,
    pub session_id: Uuid,

    pub lap: Option<i32>,
    pub category: Option<String>,
    pub message: Option<String>,
    pub flag: Option<String>,
    pub scope: Option<String>,
    pub sector: Option<i32>,
    pub status: Option<String>,
}

pub async fn insert_race_control_messages(
    pool: &DbPool,
    rows: &[RaceControlMessageRow],
) -> Result<(), Error> {
    if rows.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;

    for row in rows {
        sqlx::query(
            r#"
insert into race_control_message (
  time, session_id,
  lap, category, message, flag, scope, sector, status
)
values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
"#,
        )
        .bind(row.time)
        .bind(row.session_id)
        .bind(row.lap)
        .bind(row.category.as_deref())
        .bind(row.message.as_deref())
        .bind(row.flag.as_deref())
        .bind(row.scope.as_deref())
        .bind(row.sector)
        .bind(row.status.as_deref())
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

#[derive(Clone, Debug)]
pub struct TeamRadioRow {
    pub time: DateTime<Utc>,
    pub session_id: Uuid,

    pub driver_nr: Option<i16>,
    pub path: Option<String>,
}

pub async fn insert_team_radio_rows(pool: &DbPool, rows: &[TeamRadioRow]) -> Result<(), Error> {
    if rows.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;

    for row in rows {
        sqlx::query(
            r#"
insert into team_radio (
  time, session_id,
  driver_nr, path
)
values ($1,$2,$3,$4)
"#,
        )
        .bind(row.time)
        .bind(row.session_id)
        .bind(row.driver_nr)
        .bind(row.path.as_deref())
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

