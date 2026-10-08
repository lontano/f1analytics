use anyhow::Error;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

use crate::DbPool;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,

    pub meeting_key: Option<i32>,
    pub session_key: Option<i32>,
    pub session_name: Option<String>,
    pub session_type: Option<String>,
    pub session_path: Option<String>,

    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,

    pub session_info: Option<Value>,
}

pub async fn list_sessions(pool: &DbPool, limit: i64) -> Result<Vec<SessionSummary>, Error> {
    let limit = limit.clamp(1, 200);

    let rows = sqlx::query(
        r#"
select
  id,
  created_at,
  started_at,
  ended_at,
  meeting_key,
  session_key,
  session_name,
  session_type,
  session_path,
  start_date,
  end_date,
  session_info
from sessions
order by started_at desc nulls last, created_at desc
limit $1
"#,
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());

    for row in rows {
        out.push(SessionSummary {
            id: row.try_get("id")?,
            created_at: row.try_get("created_at")?,
            started_at: row.try_get("started_at")?,
            ended_at: row.try_get("ended_at")?,
            meeting_key: row.try_get("meeting_key")?,
            session_key: row.try_get("session_key")?,
            session_name: row.try_get("session_name")?,
            session_type: row.try_get("session_type")?,
            session_path: row.try_get("session_path")?,
            start_date: row.try_get("start_date")?,
            end_date: row.try_get("end_date")?,
            session_info: row.try_get("session_info")?,
        });
    }

    Ok(out)
}

pub async fn list_topics(pool: &DbPool, session_id: Uuid) -> Result<Vec<String>, Error> {
    let rows = sqlx::query(
        r#"
select distinct topic
from raw_events
where session_id = $1
  and topic is not null
order by topic asc
"#,
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());

    for row in rows {
        let topic: String = row.try_get("topic")?;
        out.push(topic);
    }

    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawEventRow {
    pub id: i64,
    pub time: DateTime<Utc>,
    pub received_at: DateTime<Utc>,

    pub session_id: Uuid,
    pub event_type: String,
    pub topic: Option<String>,

    pub data: Value,
    pub signalr_timestamp: Option<String>,
}

pub struct RawEventsQuery {
    pub session_id: Uuid,
    pub topic: Option<String>,
    pub from_time: Option<DateTime<Utc>>,
    pub to_time: Option<DateTime<Utc>>,
    pub cursor_id: Option<i64>,
    pub limit: i64,
}

pub async fn query_raw_events(pool: &DbPool, q: RawEventsQuery) -> Result<Vec<RawEventRow>, Error> {
    let limit = q.limit.clamp(1, 500);

    let rows = sqlx::query(
        r#"
select
  id,
  time,
  received_at,
  session_id,
  event_type,
  topic,
  data,
  signalr_timestamp
from raw_events
where session_id = $1
  and ($2::text is null or topic = $2)
  and ($3::timestamptz is null or time >= $3)
  and ($4::timestamptz is null or time <= $4)
  and ($5::bigint is null or id < $5)
order by id desc
limit $6
"#,
    )
    .bind(q.session_id)
    .bind(q.topic.as_deref())
    .bind(q.from_time)
    .bind(q.to_time)
    .bind(q.cursor_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());

    for row in rows {
        out.push(RawEventRow {
            id: row.try_get("id")?,
            time: row.try_get("time")?,
            received_at: row.try_get("received_at")?,
            session_id: row.try_get("session_id")?,
            event_type: row.try_get("event_type")?,
            topic: row.try_get("topic")?,
            data: row.try_get("data")?,
            signalr_timestamp: row.try_get("signalr_timestamp")?,
        });
    }

    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBounds {
    pub session_id: Uuid,
    pub min_time: Option<DateTime<Utc>>,
    pub max_time: Option<DateTime<Utc>>,
    pub event_count: i64,
}

pub async fn session_bounds(pool: &DbPool, session_id: Uuid) -> Result<SessionBounds, Error> {
    let row = sqlx::query(
        r#"
select
  min(time) as min_time,
  max(time) as max_time,
  count(*)::bigint as event_count
from raw_events
where session_id = $1
"#,
    )
    .bind(session_id)
    .fetch_one(pool)
    .await?;

    Ok(SessionBounds {
        session_id,
        min_time: row.try_get("min_time")?,
        max_time: row.try_get("max_time")?,
        event_count: row.try_get("event_count")?,
    })
}

// --- Review (laps / stints from derived tables) ---

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewLapRow {
    pub driver_nr: i16,
    pub lap: Option<i32>,
    pub position: Option<i32>,
    pub gap_ms: Option<i64>,
    pub leader_gap_ms: Option<i64>,
    pub last_laptime_ms: Option<i64>,
    pub sector1_ms: Option<i64>,
    pub sector2_ms: Option<i64>,
    pub sector3_ms: Option<i64>,
    pub time: DateTime<Utc>,
}

pub async fn query_session_laps(pool: &DbPool, session_id: Uuid) -> Result<Vec<ReviewLapRow>, Error> {
    let rows = sqlx::query(
        r#"
with completed as (
  -- One row per (driver, lap completion) based on last lap time.
  -- This makes the endpoint robust even if the stored `lap` field is missing/constant.
  select distinct on (driver_nr, last_laptime_ms)
    driver_nr,
    position,
    gap_ms,
    leader_gap_ms,
    last_laptime_ms,
    sector1_ms,
    sector2_ms,
    sector3_ms,
    time
  from timing_driver
  where session_id = $1
    and last_laptime_ms is not null
    and last_laptime_ms > 30000
    and last_laptime_ms < 300000
  -- Exclude in-pit / in-lap / out-lap (segment 2064 or InPit).
    and (in_pit_segment is null or in_pit_segment = false)
  -- Exclude pit-period artifacts (0 or tiny values). Real F1 laps are 60s+.
  -- Pick the FIRST time we see a new LastLapTime value (closest to lap completion).
  order by driver_nr, last_laptime_ms, time asc
),
numbered as (
  select
    driver_nr,
    row_number() over (partition by driver_nr order by time asc)::int as lap,
    position,
    gap_ms,
    leader_gap_ms,
    last_laptime_ms,
    sector1_ms,
    sector2_ms,
    sector3_ms,
    time
  from completed
)
select
  driver_nr,
  lap,
  position,
  gap_ms,
  leader_gap_ms,
  last_laptime_ms,
  sector1_ms,
  sector2_ms,
  sector3_ms,
  time
from numbered
order by driver_nr asc, lap asc
"#,
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(ReviewLapRow {
            driver_nr: row.try_get("driver_nr")?,
            lap: row.try_get("lap")?,
            position: row.try_get("position")?,
            gap_ms: row.try_get("gap_ms")?,
            leader_gap_ms: row.try_get("leader_gap_ms")?,
            last_laptime_ms: row.try_get("last_laptime_ms")?,
            sector1_ms: row.try_get("sector1_ms")?,
            sector2_ms: row.try_get("sector2_ms")?,
            sector3_ms: row.try_get("sector3_ms")?,
            time: row.try_get("time")?,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStintRow {
    pub driver_nr: i16,
    pub lap: Option<i32>,
    pub compound: Option<String>,
    pub stint_laps: Option<i32>,
    pub time: DateTime<Utc>,
}

pub async fn query_session_stints(pool: &DbPool, session_id: Uuid) -> Result<Vec<ReviewStintRow>, Error> {
    let rows = sqlx::query(
        r#"
select distinct on (driver_nr, lap)
  driver_nr,
  lap,
  compound,
  stint_laps,
  time
from tire_driver
where session_id = $1
  and lap is not null
order by driver_nr, lap, time desc
"#,
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(ReviewStintRow {
            driver_nr: row.try_get("driver_nr")?,
            lap: row.try_get("lap")?,
            compound: row.try_get("compound")?,
            stint_laps: row.try_get("stint_laps")?,
            time: row.try_get("time")?,
        });
    }
    Ok(out)
}

/// One pit visit: driver was in pit from enter_time to exit_time (from timing_driver in_pit_segment).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PitWindowRow {
    pub driver_nr: i16,
    pub enter_time: DateTime<Utc>,
    pub exit_time: DateTime<Utc>,
}

/// Compute pit windows from timing_driver: consecutive in_pit_segment true then false.
pub async fn query_pit_windows(pool: &DbPool, session_id: Uuid) -> Result<Vec<PitWindowRow>, Error> {
    let rows = sqlx::query(
        r#"
select driver_nr, time, in_pit_segment
from timing_driver
where session_id = $1
order by driver_nr asc, time asc
"#,
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::new();
    let mut by_driver: Option<(i16, Option<DateTime<Utc>>)> = None;

    for row in rows {
        let driver_nr: i16 = row.try_get("driver_nr")?;
        let time: DateTime<Utc> = row.try_get("time")?;
        let in_pit: Option<bool> = row.try_get("in_pit_segment")?;
        let in_pit = in_pit.unwrap_or(false);

        match by_driver.as_mut() {
            Some((prev_nr, enter)) if *prev_nr == driver_nr => {
                if in_pit {
                    if enter.is_none() {
                        *enter = Some(time);
                    }
                } else {
                    if let Some(enter_time) = enter.take() {
                        out.push(PitWindowRow {
                            driver_nr,
                            enter_time,
                            exit_time: time,
                        });
                    }
                }
            }
            _ => {
                if in_pit {
                    by_driver = Some((driver_nr, Some(time)));
                } else {
                    by_driver = Some((driver_nr, None));
                }
            }
        }
    }

    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDriverRow {
    pub driver_nr: i16,
}

pub async fn list_session_drivers(pool: &DbPool, session_id: Uuid) -> Result<Vec<SessionDriverRow>, Error> {
    let rows = sqlx::query(
        r#"
select distinct driver_nr
from timing_driver
where session_id = $1
order by driver_nr asc
"#,
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(SessionDriverRow {
            driver_nr: row.try_get("driver_nr")?,
        });
    }
    Ok(out)
}

pub async fn get_initial_event(pool: &DbPool, session_id: Uuid) -> Result<Option<RawEventRow>, Error> {
    let row = sqlx::query(
        r#"
select
  id,
  time,
  received_at,
  session_id,
  event_type,
  topic,
  data,
  signalr_timestamp
from raw_events
where session_id = $1
  and event_type = 'initial'
order by id asc
limit 1
"#,
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    Ok(Some(RawEventRow {
        id: row.try_get("id")?,
        time: row.try_get("time")?,
        received_at: row.try_get("received_at")?,
        session_id: row.try_get("session_id")?,
        event_type: row.try_get("event_type")?,
        topic: row.try_get("topic")?,
        data: row.try_get("data")?,
        signalr_timestamp: row.try_get("signalr_timestamp")?,
    }))
}

