#!/usr/bin/env python
"""Render-compatible RUSLE API entry point."""

import argparse
import os
import sys


def main():
    render_port = int(os.environ.get("PORT", "10000"))
    parser = argparse.ArgumentParser(description="Run the RUSLE web application")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=render_port)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    try:
        import uvicorn
    except ImportError:
        print("Error: uvicorn is not installed.")
        sys.exit(1)

    print(f"Starting RUSLE server on {args.host}:{args.port}", flush=True)
    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        workers=1,
        log_level="info",
    )


if __name__ == "__main__":
    main()
