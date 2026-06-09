#!/usr/bin/env python3
"""Generate Go OpenAPI types + chi strict-server stubs from the 3.1 contract.

`oapi-codegen` does not fully understand OpenAPI 3.1 nullability yet, so this
script converts the checked-in 3.1 document to a temporary 3.0-compatible form
for code generation only. The source contract remains packages/proto/openapi.yaml.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import yaml
except ImportError as exc:  # pragma: no cover - environment guard
    raise SystemExit("PyYAML is required to generate Go OpenAPI stubs") from exc

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "packages/proto/openapi.yaml"
OUTPUT = ROOT / "apps/api/internal/openapi/openapi.gen.go"
PACKAGE = "openapi"


def convert_nullable(node: object) -> None:
    if isinstance(node, dict):
        for key in ("anyOf", "oneOf"):
            variants = node.get(key)
            if isinstance(variants, list) and len(variants) == 2:
                null_variants = [
                    item
                    for item in variants
                    if isinstance(item, dict) and item.get("type") == "null"
                ]
                concrete = [
                    item
                    for item in variants
                    if not (isinstance(item, dict) and item.get("type") == "null")
                ]
                if len(null_variants) == 1 and len(concrete) == 1:
                    node.pop(key, None)
                    schema = concrete[0]
                    if isinstance(schema, dict) and "$ref" in schema:
                        node["allOf"] = [{"$ref": schema["$ref"]}]
                    elif isinstance(schema, dict):
                        node.update(schema)
                    node["nullable"] = True

        schema_type = node.get("type")
        if isinstance(schema_type, list) and "null" in schema_type:
            non_null = [value for value in schema_type if value != "null"]
            node["type"] = non_null[0] if len(non_null) == 1 else non_null
            node["nullable"] = True

        enum_values = node.get("enum")
        if isinstance(enum_values, list) and None in enum_values:
            node["enum"] = [value for value in enum_values if value is not None]
            node["nullable"] = True

        for value in list(node.values()):
            convert_nullable(value)
    elif isinstance(node, list):
        for item in node:
            convert_nullable(item)


def main() -> int:
    spec = yaml.safe_load(SOURCE.read_text())
    spec["openapi"] = "3.0.3"
    spec.pop("jsonSchemaDialect", None)
    convert_nullable(spec)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmpdir:
        generated_spec = Path(tmpdir) / "openapi.codegen.yaml"
        generated_spec.write_text(yaml.safe_dump(spec, sort_keys=False))
        subprocess.run(
            [
                "go",
                "run",
                "github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.5.0",
                "-generate",
                "types,chi-server,strict-server",
                "-package",
                PACKAGE,
                "-o",
                str(OUTPUT),
                str(generated_spec),
            ],
            cwd=ROOT / "apps/api",
            check=True,
        )
    subprocess.run(["gofmt", "-w", str(OUTPUT)], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
