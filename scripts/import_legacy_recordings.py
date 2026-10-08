"""Load f1-dash session recordings into TimescaleDB and data/recordings."""

from __future__ import annotations

import gzip
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg2
from psycopg2.extras import Json, execute_values

SRC = Path(r"D:\Projects\Gelosoft\F1analysis\Docs\f1-dash-main\f1-dash-main\data\recordings")
DST = Path(r"D:\Projects\Gelosoft\F1analysis\F1Analytics\data\recordings")
DSN = "host=127.0.0.1 port=18732 dbname=f1analysis user=postgres password=postgres"


def load_text(path: Path) -> str:
    if path.name.endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return handle.read()
    return path.read_text(encoding="utf-8")


def decode_events(text: str) -> list[dict]:
    decoder = json.JSONDecoder()
    index = 0
    events: list[dict] = []
    length = len(text)
    while index < length:
        while index < length and text[index] in " \r\n\t":
            index += 1
        if index >= length:
            break
        event, end = decoder.raw_decode(text, index)
        index = end
        if isinstance(event, dict):
            events.append(event)
    return events


def recording_events(folder: Path) -> list[dict]:
    seen: set[tuple] = set()
    events: list[dict] = []
    for path in (folder / "events.jsonl", folder / "events.jsonl.gz"):
        if not path.exists() or path.stat().st_size == 0:
            continue
        for event in decode_events(load_text(path)):
            key = (event.get("type"), event.get("receivedAt"), event.get("topic"), event.get("signalrTimestamp"))
            if key in seen:
                continue
            seen.add(key)
            events.append(event)
    events.sort(key=lambda event: str(event.get("receivedAt") or ""))
    return events


def parse_ts(value: object, assume_utc: bool = False) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        if not assume_utc:
            return None
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def offset_seconds(session_info: dict) -> int:
    raw = str(session_info.get("GmtOffset") or "00:00:00")
    sign = 1
    if raw.startswith("-"):
        sign = -1
        raw = raw[1:]
    elif raw.startswith("+"):
        raw = raw[1:]
    parts = raw.split(":")
    try:
        hours = int(parts[0]) if parts and parts[0] else 0
        minutes = int(parts[1]) if len(parts) > 1 else 0
        seconds = int(parts[2]) if len(parts) > 2 else 0
    except ValueError:
        return 0
    return sign * (hours * 3600 + minutes * 60 + seconds)


def local_session_time(value: object, session_info: dict) -> datetime | None:
    aware = parse_ts(value, assume_utc=False)
    if aware is not None:
        return aware
    if not isinstance(value, str) or not value:
        return None
    try:
        naive = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if naive.tzinfo is not None:
        return naive.astimezone(timezone.utc)
    utc = naive - timedelta(seconds=offset_seconds(session_info))
    return utc.replace(tzinfo=timezone.utc)


def normalize_topic(topic: str) -> str:
    if topic.endswith(".z"):
        return f"{topic[:-2]}Z"
    return topic


def normalize_state(state: object) -> dict:
    if not isinstance(state, dict):
        return {}
    return {normalize_topic(str(key)): value for key, value in state.items()}


def merge(base, update):
    if isinstance(base, dict) and isinstance(update, dict):
        for key, value in update.items():
            if key in base:
                base[key] = merge(base[key], value)
            else:
                base[key] = value
        return base
    if isinstance(base, list) and isinstance(update, dict):
        for key, value in update.items():
            if str(key).isdigit():
                index = int(key)
                if 0 <= index < len(base):
                    base[index] = merge(base[index], value)
                else:
                    base.append(value)
        return base
    return update


def as_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def parse_laptime_ms(value: object) -> int | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        if ":" in text:
            minutes, seconds = text.split(":", 1)
            return int(minutes) * 60_000 + int(float(seconds) * 1000)
        return int(float(text) * 1000)
    except ValueError:
        return None


def parse_sector_ms(value: object) -> int | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return int(float(value.strip()) * 1000)
    except ValueError:
        return None


def parse_gap_ms(value: object) -> int | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or "L" in text:
        return None
    try:
        return int(float(text.lstrip("+")) * 1000)
    except ValueError:
        return None


def copy_recordings() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    for folder in sorted(path for path in SRC.iterdir() if path.is_dir()):
        target = DST / folder.name
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(folder, target)


def snapshot_rows(session_id: str, when: datetime, state: dict):
    timing = []
    tires = []
    weather = []
    control = []
    radio = []

    lines = ((state.get("TimingData") or {}).get("Lines") or {})
    stats = ((state.get("TimingStats") or {}).get("Lines") or {})
    if isinstance(lines, dict):
        for number, driver in lines.items():
            driver_nr = as_int(number)
            if driver_nr is None or not isinstance(driver, dict):
                continue
            stat = stats.get(number) if isinstance(stats, dict) else None
            stat = stat if isinstance(stat, dict) else {}
            bests = driver.get("BestLapTimes")
            if not isinstance(bests, list) or not bests:
                last = driver.get("LastLapTime")
                bests = [last] if isinstance(last, dict) else []
            personal = stat.get("PersonalBestLapTime") if isinstance(stat.get("PersonalBestLapTime"), dict) else {}
            sectors = stat.get("BestSectors") if isinstance(stat.get("BestSectors"), list) else []
            position = as_int(driver.get("Position"))
            gap = None
            interval = driver.get("IntervalToPositionAhead")
            if isinstance(interval, dict):
                gap = parse_gap_ms(interval.get("Value"))
            leader = parse_gap_ms(driver.get("GapToLeader"))
            for best in bests:
                if not isinstance(best, dict):
                    continue
                lap_ms = parse_laptime_ms(best.get("Value"))
                if lap_ms is None:
                    continue
                use_sectors = personal.get("Value") == best.get("Value")
                timing.append(
                    (
                        when,
                        session_id,
                        driver_nr,
                        as_int(best.get("Lap")) or as_int(driver.get("NumberOfLaps")),
                        as_int(personal.get("Position")) if use_sectors and personal.get("Position") is not None else position,
                        gap,
                        leader,
                        lap_ms,
                        parse_sector_ms(sectors[0].get("Value")) if use_sectors and len(sectors) > 0 and isinstance(sectors[0], dict) else None,
                        parse_sector_ms(sectors[1].get("Value")) if use_sectors and len(sectors) > 1 and isinstance(sectors[1], dict) else None,
                        parse_sector_ms(sectors[2].get("Value")) if use_sectors and len(sectors) > 2 and isinstance(sectors[2], dict) else None,
                        False,
                    )
                )

    app_lines = ((state.get("TimingAppData") or {}).get("Lines") or {})
    if isinstance(app_lines, dict):
        for number, driver in app_lines.items():
            driver_nr = as_int(number)
            if driver_nr is None or not isinstance(driver, dict):
                continue
            stints = driver.get("Stints")
            if not isinstance(stints, list):
                continue
            for stint in stints:
                if not isinstance(stint, dict):
                    continue
                lap = as_int(stint.get("LapNumber"))
                compound = stint.get("Compound") if isinstance(stint.get("Compound"), str) else None
                total = as_int(stint.get("TotalLaps"))
                if lap is None and compound is None:
                    continue
                tires.append((when, session_id, driver_nr, lap, compound, total))

    weather_state = state.get("WeatherData")
    if isinstance(weather_state, dict) and any(weather_state.get(key) for key in ("AirTemp", "TrackTemp", "Humidity")):
        weather.append(
            (
                when,
                session_id,
                _text(weather_state.get("AirTemp")),
                _text(weather_state.get("TrackTemp")),
                _text(weather_state.get("Humidity")),
                _text(weather_state.get("Pressure")),
                _text(weather_state.get("Rainfall")),
                _text(weather_state.get("WindDirection")),
                _text(weather_state.get("WindSpeed")),
            )
        )

    messages = ((state.get("RaceControlMessages") or {}).get("Messages") or [])
    if isinstance(messages, list):
        for message in messages:
            if not isinstance(message, dict):
                continue
            control.append(
                (
                    parse_ts(message.get("Utc"), assume_utc=True) or when,
                    session_id,
                    as_int(message.get("Lap")),
                    _text(message.get("Category")),
                    _text(message.get("Message")),
                    _text(message.get("Flag")),
                    _text(message.get("Scope")),
                    as_int(message.get("Sector")),
                    _text(message.get("Status")),
                )
            )

    captures = ((state.get("TeamRadio") or {}).get("Captures") or [])
    if isinstance(captures, list):
        for capture in captures:
            if not isinstance(capture, dict):
                continue
            radio.append(
                (
                    parse_ts(capture.get("Utc"), assume_utc=True) or when,
                    session_id,
                    as_int(capture.get("RacingNumber")),
                    _text(capture.get("Path")),
                )
            )

    return timing, tires, weather, control, radio


def _text(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return str(value)
    return None


def final_state(events: list[dict]) -> tuple[dict, datetime | None, datetime | None, dict | None]:
    state: dict = {}
    session_info = None
    first = None
    last = None
    for event in events:
        received = parse_ts(event.get("receivedAt"), assume_utc=True)
        if received is not None:
            first = first or received
            last = received
        if event.get("type") == "initial":
            state = normalize_state(event.get("state"))
            info = state.get("SessionInfo")
            if isinstance(info, dict):
                session_info = info
            continue
        if event.get("type") != "update":
            continue
        topic = event.get("normalizedTopic") or event.get("topic") or ""
        topic = normalize_topic(str(topic))
        state = merge(state, {topic: event.get("data")})
        if topic == "SessionInfo" and isinstance(event.get("data"), dict) and event["data"].get("Name"):
            session_info = event["data"]
    return state, first, last, session_info if isinstance(session_info, dict) else None


def import_sessions() -> None:
    folders = sorted(path for path in SRC.iterdir() if path.is_dir())
    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    inserted = 0
    try:
        with conn.cursor() as cur:
            for folder in folders:
                events = recording_events(folder)
                if not events:
                    print(f"skip empty {folder.name}")
                    continue
                session_id = folder.name
                state, first, last, info = final_state(events)
                info = info or {}
                meeting = info.get("Meeting") if isinstance(info.get("Meeting"), dict) else {}
                start = local_session_time(info.get("StartDate"), info)
                end = local_session_time(info.get("EndDate"), info)
                started = start or first
                ended = end or last
                cur.execute("delete from sessions where id = %s", (session_id,))
                cur.execute(
                    """
                    insert into sessions (
                      id, started_at, ended_at, session_info,
                      meeting_key, session_key, session_name, session_type, session_path,
                      start_date, end_date
                    ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        session_id,
                        started,
                        ended,
                        Json(info) if info else None,
                        as_int(meeting.get("Key")),
                        as_int(info.get("Key")),
                        _text(info.get("Name")),
                        _text(info.get("Type")),
                        _text(info.get("Path")),
                        start,
                        end,
                    ),
                )
                raw_rows = []
                for event in events:
                    received = parse_ts(event.get("receivedAt"), assume_utc=True) or started
                    kind = event.get("type")
                    if kind == "initial":
                        payload = event.get("state") if isinstance(event.get("state"), dict) else {}
                        raw_rows.append((received, received, session_id, "initial", None, Json(payload), None))
                    elif kind == "update":
                        stamp = event.get("signalrTimestamp")
                        event_time = parse_ts(stamp, assume_utc=False) or received
                        topic = event.get("topic")
                        raw_rows.append(
                            (
                                event_time,
                                received,
                                session_id,
                                "update",
                                str(topic) if topic else None,
                                Json(event.get("data")),
                                str(stamp) if stamp else None,
                            )
                        )
                execute_values(
                    cur,
                    """
                    insert into raw_events (
                      time, received_at, session_id, event_type, topic, data, signalr_timestamp
                    ) values %s
                    """,
                    raw_rows,
                    page_size=200,
                )
                when = last or started or datetime.now(timezone.utc)
                timing, tires, weather, control, radio = snapshot_rows(session_id, when, state)
                if timing:
                    execute_values(
                        cur,
                        """
                        insert into timing_driver (
                          time, session_id, driver_nr, lap, position,
                          gap_ms, leader_gap_ms, last_laptime_ms,
                          sector1_ms, sector2_ms, sector3_ms, in_pit_segment
                        ) values %s
                        """,
                        timing,
                        page_size=200,
                    )
                if tires:
                    execute_values(
                        cur,
                        """
                        insert into tire_driver (time, session_id, driver_nr, lap, compound, stint_laps)
                        values %s
                        """,
                        tires,
                        page_size=200,
                    )
                if weather:
                    execute_values(
                        cur,
                        """
                        insert into weather (
                          time, session_id, air_temp, track_temp, humidity, pressure,
                          rainfall, wind_direction, wind_speed
                        ) values %s
                        """,
                        weather,
                    )
                if control:
                    execute_values(
                        cur,
                        """
                        insert into race_control_message (
                          time, session_id, lap, category, message, flag, scope, sector, status
                        ) values %s
                        """,
                        control,
                        page_size=200,
                    )
                if radio:
                    execute_values(
                        cur,
                        """
                        insert into team_radio (time, session_id, driver_nr, path) values %s
                        """,
                        radio,
                        page_size=200,
                    )
                meeting_name = meeting.get("Name")
                print(
                    f"{session_id[:8]} {meeting_name} {info.get('Name')} "
                    f"events={len(raw_rows)} laps={len(timing)} stints={len(tires)} rc={len(control)}"
                )
                inserted += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    print(f"imported {inserted} sessions")


if __name__ == "__main__":
    copy_recordings()
    import_sessions()
