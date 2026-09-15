#!/usr/bin/env python3
"""Railway adapter for the vendored beat-synced-edit pipeline.

The upstream deterministic stages remain intact; this adapter only supplies
bounded paths and invokes them in order for the API worker.
"""
import argparse
import os
import subprocess
import sys
import tempfile
import json

ROOT = os.path.join(os.path.dirname(__file__), "beat-synced-edit")


def run(args):
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True)
    if result.returncode:
        sys.stderr.write(result.stdout[-4000:])
        sys.stderr.write(result.stderr[-4000:])
        raise SystemExit(result.returncode)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--audio")
    parser.add_argument("--output", required=True)
    parser.add_argument("--beat-stride", type=int, default=1)
    args = parser.parse_args()

    if not os.path.isfile(args.video) or not os.path.isfile(args.audio):
        raise SystemExit("video and audio files must exist")
    if args.beat_stride < 1 or args.beat_stride > 16:
        raise SystemExit("beat-stride must be between 1 and 16")

    with tempfile.TemporaryDirectory(prefix="adroom-beat-edit-") as work:
        beatmap = os.path.join(work, "beatmap.json")
        clips = os.path.join(work, "clips.json")
        edl = os.path.join(work, "edl.json")
        run([sys.executable, "clip_tag.py", args.video, "--output", clips])
        audio = args.audio
        if not audio:
            duration_result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", args.video],
                check=True, capture_output=True, text=True,
            )
            duration = max(1.0, min(600.0, float(duration_result.stdout.strip())))
            audio = os.path.join(work, "silent.m4a")
            run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
                 "-t", str(duration), "-c:a", "aac", audio])
            with open(clips, "r", encoding="utf-8") as stream:
                clip_data = json.load(stream)
            beats = [round(float(i), 3) for i in range(0, max(1, int(duration)), 2)]
            clip_data["source"] = args.video
            with open(beatmap, "w", encoding="utf-8") as stream:
                json.dump({
                    "file": audio, "duration": duration, "tempo": 30.0,
                    "beat_count": len(beats), "beats": beats,
                    "peaks": [], "valleys": [], "energy_curve": [],
                    "top_segments": [{"rank": 1, "start": 0, "end": duration,
                                      "duration": duration, "avg_energy": 0.5}],
                    "best_segment": {"start": 0, "end": duration,
                                     "duration": duration, "avg_energy": 0.5},
                }, stream)
            with open(clips, "w", encoding="utf-8") as stream:
                json.dump(clip_data, stream)
        else:
            run([sys.executable, "beat_map.py", audio, "--output", beatmap])
        run([sys.executable, "plan_edit.py", beatmap, clips, "--output", edl, "--beat-stride", str(args.beat_stride)])
        run([sys.executable, "render_edit.py", edl, "--audio", audio, "--video", args.video, "--output", args.output])

    if not os.path.isfile(args.output) or os.path.getsize(args.output) == 0:
        raise SystemExit("beat-synced pipeline did not produce an output")


if __name__ == "__main__":
    main()
