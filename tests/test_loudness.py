import os
import shutil
import subprocess

import pytest

from app.config import settings
from tests.test_w1_privacy_settings import client, admin, _senior  # noqa: F401  (shared fixtures)
from app.services import loudness_service as ls

SAMPLE = '''[Parsed_loudnorm_0 @ 0x1]
{
\t"input_i" : "-23.40",
\t"input_tp" : "-6.20",
\t"input_lra" : "0.10",
\t"input_thresh" : "-33.40",
\t"output_i" : "-16.00"
}
'''


def test_parse_loudnorm_output():
    assert ls.parse_loudnorm_output(SAMPLE) == {"lufs": -23.4, "true_peak": -6.2}
    assert ls.parse_loudnorm_output("garbage") is None
    assert ls.parse_loudnorm_output(SAMPLE.replace("-23.40", "-inf"))["lufs"] == -70.0


def test_gain_brings_track_to_target_and_respects_limits():
    assert ls.compute_gain_db(-23.4, -12.0) == 7.4         # quiet track boosted to target
    assert ls.compute_gain_db(-23.4, -6.2) == 5.2          # peak ceiling caps it first
    assert ls.compute_gain_db(-8.0, -0.5) == -8.0          # loud track cut
    assert ls.compute_gain_db(-23.0, -1.5) == 0.5          # peak ceiling caps the boost
    assert ls.compute_gain_db(-40.0, -30.0) == 9.0         # boost capped
    assert ls.compute_gain_db(0.0, 0.0) == -12.0           # cut capped
    assert ls.compute_gain_db(-70.0, -70.0) == 0.0         # silence untouched


def test_cache_is_keyed_to_the_file(monkeypatch, tmp_path):
    svc = ls.LoudnessService()
    f = tmp_path / "a.mp3"
    f.write_bytes(b"one")
    monkeypatch.setattr(ls, "measure_file", lambda p: {"lufs": -20.0, "true_peak": -5.0})
    rec = svc.measure_and_store("E-1", str(f))
    assert rec["gain_db"] == 4.0
    assert svc.gain_db("E-1", str(f)) == 4.0
    assert os.path.isfile(os.path.join(settings.storage.event_dir, ls.FACTS_FILENAME))
    f.write_bytes(b"changed-bytes")                          # new upload replaces the file: stale
    assert svc.gain_db("E-1", str(f)) is None


def test_failed_measurement_stores_nothing(monkeypatch, tmp_path):
    svc = ls.LoudnessService()
    f = tmp_path / "a.mp3"
    f.write_bytes(b"x")
    monkeypatch.setattr(ls, "measure_file", lambda p: None)
    assert svc.measure_and_store("E-2", str(f)) is None
    assert svc.gain_db("E-2", str(f)) is None


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_real_ffmpeg_measures_a_quiet_tone(tmp_path):
    f = tmp_path / "quiet.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                    "-af", "volume=-30dB", str(f)], check=True)
    m = ls.measure_file(str(f))
    assert m is not None and -60 < m["lufs"] < -40
    gain = ls.compute_gain_db(m["lufs"], m["true_peak"])
    assert gain == 9.0                                              # very quiet: boosted, capped


def test_manifest_publishes_gain_and_schedules_missing(client, admin, monkeypatch):
    entry = _senior(client, "Ravi Kumar")
    with open(os.path.join(settings.storage.tracks_dir, f"{entry}_x.mp3"), "wb") as f:
        f.write(b"audio-bytes")
    scheduled = []
    monkeypatch.setattr(ls.loudness_service, "schedule", lambda e, p: scheduled.append(e) or True)
    track = {t["entry_id"]: t for t in admin.get("/api/vault/manifest").json()["tracks"]}[entry]
    assert track["gain_db"] is None and scheduled == [entry]
    monkeypatch.setattr(ls.loudness_service, "gain_db", lambda e, p: 3.5)
    track = {t["entry_id"]: t for t in admin.get("/api/vault/manifest").json()["tracks"]}[entry]
    assert track["gain_db"] == 3.5 and scheduled == [entry]
