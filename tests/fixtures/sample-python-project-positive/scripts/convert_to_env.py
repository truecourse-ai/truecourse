"""shared-mutable-module-state shape that should NOT fire.

This file is a one-shot CLI script. Module-scope variables here
are not "shared state across requests" — they live for the
duration of the script run only.
"""

import argparse
import sys


parser = argparse.ArgumentParser(description="Convert config to .env")
parser.add_argument("--input", required=True)
args = parser.parse_args()

seen: set[str] = set()
output: list[str] = []

with open(args.input, encoding="utf-8") as fp:
    for line in fp.read().splitlines():
        if line in seen:
            continue
        seen.add(line)
        output.append(line)

sys.stdout.write("\n".join(output))
