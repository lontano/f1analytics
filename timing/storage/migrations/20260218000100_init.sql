-- TimescaleDB schema for raw + derived F1 live timing data.

-- Ensure extensions exist.
create extension if not exists timescaledb;

-- Core session metadata (one per live session).
create table if not exists sessions (
  id uuid primary key,

  -- When our system first observed/created this session record.
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,

  -- Optional snapshot of SessionInfo for quick listing/filtering.
  session_info jsonb,

  meeting_key integer,
  session_key integer,
  session_name text,
  session_type text,
  session_path text,

  start_date timestamptz,
  end_date timestamptz
);

create index if not exists sessions_started_at_idx on sessions (started_at desc);

-- Lossless raw event storage (initial + every update).
create table if not exists raw_events (
  id bigint generated always as identity not null,

  -- Event time (prefer upstream timestamp when available; otherwise received_at).
  time timestamptz not null,
  received_at timestamptz not null default now(),

  session_id uuid not null references sessions(id) on delete cascade,

  -- \"initial\" | \"update\"
  event_type text not null,
  topic text,

  -- Raw payload for the topic (or full state for initial).
  data jsonb not null,

  -- Upstream SignalR timestamp string when present.
  signalr_timestamp text
);

-- TimescaleDB hypertables require unique indexes / PKs to include the time partition key.
alter table raw_events drop constraint if exists raw_events_pkey;
alter table raw_events add primary key (time, id);

create index if not exists raw_events_session_time_idx on raw_events (session_id, time desc, id desc);
create index if not exists raw_events_session_topic_time_idx on raw_events (session_id, topic, time desc, id desc);

select create_hypertable('raw_events', 'time', if_not_exists => true);

-- Derived: car telemetry (from CarData.z / CarDataZ)
create table if not exists telemetry_car (
  time timestamptz not null,
  session_id uuid not null references sessions(id) on delete cascade,
  driver_nr smallint not null,

  speed_kmh integer,
  rpm integer,
  gear smallint,
  throttle smallint,
  brake boolean,
  drs smallint
);

create index if not exists telemetry_car_session_driver_time_idx on telemetry_car (session_id, driver_nr, time desc);
select create_hypertable('telemetry_car', 'time', if_not_exists => true);

-- Derived: car position (from Position.z / PositionZ)
create table if not exists position_car (
  time timestamptz not null,
  session_id uuid not null references sessions(id) on delete cascade,
  driver_nr smallint not null,

  status text,
  x double precision,
  y double precision,
  z double precision
);

create index if not exists position_car_session_driver_time_idx on position_car (session_id, driver_nr, time desc);
select create_hypertable('position_car', 'time', if_not_exists => true);

-- Derived: timing per driver (from TimingData)
create table if not exists timing_driver (
  time timestamptz not null,
  session_id uuid not null references sessions(id) on delete cascade,
  driver_nr smallint not null,

  lap integer,
  position integer,

  gap_ms bigint,
  leader_gap_ms bigint,

  last_laptime_ms bigint,
  sector1_ms bigint,
  sector2_ms bigint,
  sector3_ms bigint
);

create index if not exists timing_driver_session_driver_time_idx on timing_driver (session_id, driver_nr, time desc);
select create_hypertable('timing_driver', 'time', if_not_exists => true);

-- Derived: tires/stints (from TimingAppData)
create table if not exists tire_driver (
  time timestamptz not null,
  session_id uuid not null references sessions(id) on delete cascade,
  driver_nr smallint not null,

  lap integer,
  compound text,
  stint_laps integer
);

create index if not exists tire_driver_session_driver_time_idx on tire_driver (session_id, driver_nr, time desc);
select create_hypertable('tire_driver', 'time', if_not_exists => true);

-- Derived: weather (from WeatherData)
create table if not exists weather (
  time timestamptz not null,
  session_id uuid not null references sessions(id) on delete cascade,

  air_temp text,
  track_temp text,
  humidity text,
  pressure text,
  rainfall text,
  wind_direction text,
  wind_speed text
);

create index if not exists weather_session_time_idx on weather (session_id, time desc);
select create_hypertable('weather', 'time', if_not_exists => true);

-- Derived: race control messages (from RaceControlMessages)
create table if not exists race_control_message (
  time timestamptz not null,
  session_id uuid not null references sessions(id) on delete cascade,

  lap integer,
  category text,
  message text,
  flag text,
  scope text,
  sector integer,
  status text
);

create index if not exists rcm_session_time_idx on race_control_message (session_id, time desc);
select create_hypertable('race_control_message', 'time', if_not_exists => true);

-- Derived: team radio captures (from TeamRadio)
create table if not exists team_radio (
  time timestamptz not null,
  session_id uuid not null references sessions(id) on delete cascade,

  driver_nr smallint,
  path text
);

create index if not exists team_radio_session_time_idx on team_radio (session_id, time desc);
select create_hypertable('team_radio', 'time', if_not_exists => true);

