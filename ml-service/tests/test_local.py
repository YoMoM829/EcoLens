"""CLI harness for running EcoLens inference on a local image or video file."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ml_pipeline import process_file


def main() -> int:
    parser = argparse.ArgumentParser(description="Run EcoLens ML inference on a local file.")
    parser.add_argument("path", type=Path, help="Path to an image or video file")
    parser.add_argument(
        "--user-id",
        default="local-user",
        help="Owner user id used in generated S3 keys (default: local-user)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Path for the metadata JSON (default: <input_stem>.json beside the input file)",
    )
    args = parser.parse_args()

    if not args.path.is_file():
        print(f"File not found: {args.path}", file=sys.stderr)
        return 1

    output_path = args.output or args.path.with_name(f"{args.path.stem}.json")
    result = process_file(args.path, user_id=args.user_id)
    output_path.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
    print(f"Saved results to {output_path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
