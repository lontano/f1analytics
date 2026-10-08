"""Static session shaped like the live-timing surfaces the dashboard renders."""


def timing_snapshot() -> dict:
    drivers = [
        _driver(1, "1", "VER", "Max Verstappen", "Red Bull", 18, "1:33.421", None, "+0.000", "SOFT", 8, True, [0, 1, 0]),
        _driver(2, "16", "LEC", "Charles Leclerc", "Ferrari", 18, "1:33.902", "+0.481", "+0.481", "MEDIUM", 12, False, [1, 2, 1]),
        _driver(3, "55", "SAI", "Carlos Sainz", "Ferrari", 18, "1:34.110", "+1.204", "+0.723", "MEDIUM", 12, False, [1, 1, 2]),
        _driver(4, "44", "HAM", "Lewis Hamilton", "Mercedes", 18, "1:34.330", "+2.018", "+0.814", "HARD", 22, True, [2, 1, 0]),
        _driver(5, "63", "RUS", "George Russell", "Mercedes", 18, "1:34.512", "+3.441", "+1.423", "HARD", 21, False, [0, 2, 1]),
        _driver(6, "4", "NOR", "Lando Norris", "McLaren", 18, "1:34.088", "+4.902", "+1.461", "SOFT", 6, True, [0, 0, 1]),
        _driver(7, "81", "PIA", "Oscar Piastri", "McLaren", 17, "1:34.640", "+1 LAP", "+1 LAP", "MEDIUM", 14, False, [1, 0, 2]),
        _driver(8, "11", "PER", "Sergio Perez", "Red Bull", 17, "1:34.901", "+1 LAP", "+8.220", "HARD", 19, False, [2, 2, 1]),
    ]
    return {
        "session": {
            "name": "Bahrain Grand Prix",
            "type": "Race",
            "circuit": "Bahrain International Circuit",
            "country": "Bahrain",
            "status": "Started",
            "lap": 18,
            "laps": 57,
            "clock": "1:12:04",
        },
        "feed": {
            "connected": True,
            "source": "demo-snapshot",
            "topics": 8,
            "delay_s": 0,
            "max_delay_s": 30,
        },
        "weather": {
            "air": 28.4,
            "track": 36.1,
            "humidity": 41,
            "wind_speed": 3.2,
            "wind_direction": 210,
            "rainfall": False,
            "pressure": 1012,
        },
        "drivers": drivers,
        "race_control": [
            {"lap": 18, "flag": "GREEN", "message": "Track clear"},
            {"lap": 14, "flag": "YELLOW", "message": "Yellow in sector 2"},
            {"lap": 14, "flag": "CLEAR", "message": "Yellow cleared"},
            {"lap": 9, "flag": "DRS", "message": "DRS enabled"},
        ],
        "radios": [
            {"driver": "VER", "lap": 17, "message": "Tyres are fine, stay out"},
            {"driver": "NOR", "lap": 16, "message": "Box this lap, soft tyre"},
            {"driver": "LEC", "lap": 12, "message": "Undercut window is open"},
        ],
        "violations": [
            {"driver": "PER", "lap": 11, "kind": "Track limits", "note": "Turn 4, lap deleted"},
            {"driver": "RUS", "lap": 7, "kind": "Track limits", "note": "Turn 11 warning"},
        ],
        "standings": {
            "drivers": [
                {"pos": 1, "code": "VER", "team": "Red Bull", "points": 51},
                {"pos": 2, "code": "LEC", "team": "Ferrari", "points": 47},
                {"pos": 3, "code": "SAI", "team": "Ferrari", "points": 40},
                {"pos": 4, "code": "NOR", "team": "McLaren", "points": 36},
                {"pos": 5, "code": "HAM", "team": "Mercedes", "points": 28},
            ],
            "constructors": [
                {"pos": 1, "team": "Ferrari", "points": 87},
                {"pos": 2, "team": "Red Bull", "points": 74},
                {"pos": 3, "team": "McLaren", "points": 58},
                {"pos": 4, "team": "Mercedes", "points": 46},
            ],
        },
        "stints": [
            {"code": "VER", "laps": [94.2, 93.8, 93.6, 93.5, 93.7, 93.4, 94.1, 93.9]},
            {"code": "LEC", "laps": [94.8, 94.4, 94.1, 94.0, 94.2, 93.9, 94.6, 94.3]},
            {"code": "NOR", "laps": [95.4, 95.0, 94.6, 94.4, 94.8, 94.2, 95.1, 94.7]},
            {"code": "HAM", "laps": [95.1, 94.9, 94.7, 94.8, 95.0, 94.6, 95.2, 94.9]},
        ],
        "trace": [
            {"code": "VER", "x": 62, "y": 28},
            {"code": "LEC", "x": 58, "y": 34},
            {"code": "SAI", "x": 54, "y": 40},
            {"code": "HAM", "x": 48, "y": 48},
            {"code": "RUS", "x": 42, "y": 56},
            {"code": "NOR", "x": 36, "y": 62},
            {"code": "PIA", "x": 28, "y": 70},
            {"code": "PER", "x": 22, "y": 74},
        ],
        "raw_topics": [
            {"topic": "Heartbeat", "messages": 1840},
            {"topic": "TimingData", "messages": 960},
            {"topic": "DriverList", "messages": 4},
            {"topic": "SessionInfo", "messages": 1},
            {"topic": "WeatherData", "messages": 42},
            {"topic": "RaceControlMessages", "messages": 11},
            {"topic": "TeamRadio", "messages": 7},
            {"topic": "LapCount", "messages": 18},
        ],
    }


def _driver(
    pos: int,
    number: str,
    code: str,
    name: str,
    team: str,
    lap: int,
    last: str,
    gap: str | None,
    interval: str,
    compound: str,
    tire_age: int,
    drs: bool,
    sectors: list[int],
) -> dict:
    return {
        "pos": pos,
        "number": number,
        "code": code,
        "name": name,
        "team": team,
        "lap": lap,
        "last": last,
        "gap": gap or "—",
        "interval": interval,
        "compound": compound,
        "tire_age": tire_age,
        "drs": drs,
        "sectors": sectors,
        "pit": pos in {6, 7},
    }
