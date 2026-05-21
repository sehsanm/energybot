import json
from energybot.logging import configure_logging, get_logger


def test_logger_emits_json(capsys):
    configure_logging("INFO")
    log = get_logger("test")
    log.info("hello", trace_id="abc", user_id="u1", latency_ms=12)
    captured = capsys.readouterr()
    parsed = json.loads(captured.out.strip().splitlines()[-1])
    assert parsed["event"] == "hello"
    assert parsed["trace_id"] == "abc"
    assert parsed["user_id"] == "u1"
    assert parsed["latency_ms"] == 12
    assert parsed["level"] == "info"
