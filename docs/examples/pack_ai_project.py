"""Package an OLED Studio v1 manifest with the Python standard library."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

LIMIT = 128 * 1024 * 1024
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}")


def check_id(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError(f"Invalid ID: {value!r}")
    return value


def resource_bytes(resource, prefix, root):
    key = prefix + "Bytes"
    expected = f"{'resources' if prefix == 'data' else 'sources'}/{resource['id']}.bin"
    if key in resource:
        values = resource.pop(key)
        if prefix + "Path" in resource:
            raise ValueError(f"Use either {key} or {prefix}Path, not both")
        if not isinstance(values, list) or len(values) > 32 * 1024 * 1024:
            raise ValueError(f"{key} must be a byte array <= 32 MiB")
        if any(type(value) is not int or value < 0 or value > 255 for value in values):
            raise ValueError(f"{key} values must be integers in 0..255")
        data = bytes(values)
    else:
        if resource.get(prefix + "Path") != expected:
            raise ValueError(f"Expected path: {expected}")
        file = root.joinpath(*expected.split("/")).resolve()
        if not file.is_relative_to(root):
            raise ValueError("Resource path escapes the asset directory")
        if file.stat().st_size > 32 * 1024 * 1024:
            raise ValueError("Resource file exceeds 32 MiB")
        data = file.read_bytes()
    resource[prefix + "Path"] = expected
    resource[prefix + "Length"] = len(data)
    resource[prefix + "Hash"] = hashlib.sha256(data).hexdigest()
    return expected, data


def package_project(manifest, root):
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Only schemaVersion 1 is supported")
    pages, resources = manifest.get("pages"), manifest.get("resources")
    if not isinstance(pages, list) or not 1 <= len(pages) <= 1000:
        raise ValueError("Expected 1..1000 pages")
    if not isinstance(resources, list) or len(resources) > 10000:
        raise ValueError("Expected at most 10000 resources")
    ids = [check_id(manifest.get("id"))]
    code_names = set()
    for page in pages:
        ids.append(check_id(page.get("id")))
        if "codeName" in page:
            name = page["codeName"]
            if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name) or "__" in name:
                raise ValueError("Page codeName must start with a letter, contain 1..64 ASCII letters/digits/underscores, without double underscores")
            if name.lower() in code_names:
                raise ValueError("Page codeName must be unique, ignoring case")
            code_names.add(name.lower())
        components = page.get("components")
        if not isinstance(components, list) or len(components) > 10000:
            raise ValueError("Expected at most 10000 components per page")
        ids.extend(check_id(component.get("id")) for component in components)
    ids.extend(check_id(resource.get("id")) for resource in resources)
    if len(ids) != len(set(ids)):
        raise ValueError("IDs must be globally unique")
    if manifest.get("defaultPageId") not in {page["id"] for page in pages}:
        raise ValueError("defaultPageId does not refer to a page")
    files, total = {}, 0
    for resource in resources:
        path, data = resource_bytes(resource, "data", root)
        if resource.get("kind") == "image":
            width, height = resource.get("width"), resource.get("height")
            if type(width) is not int or type(height) is not int or not (1 <= width <= 512 and 1 <= height <= 512):
                raise ValueError("Image width/height must be integers in 1..512")
            stride = (width + 7) // 8
            if len(data) != stride * height:
                raise ValueError("XBM byte length does not match dimensions")
            if width % 8 and any(data[(y + 1) * stride - 1] >> (width % 8) for y in range(height)):
                raise ValueError("XBM unused row-tail bits must be zero")
        elif resource.get("kind") != "font":
            raise ValueError("Resource kind must be image or font")
        files[path] = data
        total += len(data)
        if "sourceBytes" in resource or "sourcePath" in resource:
            path, data = resource_bytes(resource, "source", root)
            files[path] = data
            total += len(data)
        elif "sourceLength" in resource or "sourceHash" in resource:
            raise ValueError("Source metadata requires sourcePath or sourceBytes")
        if total > LIMIT:
            raise ValueError("Total resources exceed 128 MiB")
    files["project.json"] = json.dumps(manifest, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(files["project.json"]) > 8 * 1024 * 1024 or total + len(files["project.json"]) > LIMIT:
        raise ValueError("Manifest or decompressed project exceeds budget")
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--assets", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    if args.input.stat().st_size > 8 * 1024 * 1024:
        raise ValueError("Input manifest exceeds 8 MiB")
    manifest = json.loads(args.input.read_text(encoding="utf-8-sig"))
    files = package_project(manifest, (args.assets or args.input.parent).resolve())
    output = args.output.resolve()
    if output == args.input.resolve():
        raise ValueError("Output must not replace the input manifest")
    asset_paths = {(args.assets or args.input.parent).resolve().joinpath(*name.split("/")).resolve()
                   for name in files if name != "project.json"}
    if output in asset_paths:
        raise ValueError("Output must not replace a resource file")
    with zipfile.ZipFile(output, "w" if args.overwrite else "x", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    if output.stat().st_size > LIMIT:
        raise ValueError("Output ZIP exceeds 128 MiB; do not import it")
    print(f"Created: {output}")
    print(f"Pages: {len(manifest['pages'])}; resources: {len(manifest['resources'])}")
    print("Packaging complete. Import into OLED Studio for full schema/font/render validation.")


if __name__ == "__main__":
    main()
