from datetime import datetime
from zoneinfo import ZoneInfo

from agent_service.prompts import calendar_context
from evals.run import evaluation_clock


def test_next_week_friday_uses_next_calendar_week_and_future_dst_offset() -> None:
    instant = datetime.fromisoformat("2026-10-27T00:30:00+08:00")
    los_angeles = calendar_context(instant.astimezone(ZoneInfo("America/Los_Angeles")))
    shanghai = calendar_context(instant.astimezone(ZoneInfo("Asia/Shanghai")))
    assert los_angeles["today"] == "2026-10-26"
    assert los_angeles["nextWeekMonday"] == "2026-11-02"
    assert los_angeles["nextWeekFridayAt18"] == "2026-11-06T18:00:00-08:00"
    assert los_angeles["nextWeekFridayAt18Utc"] == "2026-11-07T02:00:00+00:00"
    assert shanghai["today"] == "2026-10-27"
    assert shanghai["nextWeekFridayAt18"] == "2026-11-06T18:00:00+08:00"


def test_sunday_advances_to_following_monday_and_tomorrow_uses_local_date() -> None:
    sunday = datetime(2026, 11, 1, 23, 59, tzinfo=ZoneInfo("Asia/Shanghai"))
    result = calendar_context(sunday)
    assert result["tomorrow"] == "2026-11-02"
    assert result["nextWeekMonday"] == "2026-11-02"
    assert result["nextWeekFriday"] == "2026-11-06"


def test_frozen_eval_clock_preserves_iana_timezone_instead_of_a_fixed_offset() -> None:
    instant = datetime.fromisoformat("2026-10-27T00:30:00+08:00")
    zone = ZoneInfo("America/Los_Angeles")
    with evaluation_clock(instant) as clock:
        local = clock.now(zone)
        assert local.tzinfo is zone
        assert calendar_context(local)["nextWeekFridayAt18Utc"] == "2026-11-07T02:00:00+00:00"
