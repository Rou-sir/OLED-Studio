"""Package the tested offline HTML and integration examples without local data."""

import re
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def package(version: str) -> Path:
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
        raise ValueError("Release version must look like v0.1.0")
    root = Path(__file__).resolve().parent.parent
    files = [root / "dist" / name for name in (
        "oled-studio.html", "U8g2-LICENSE.txt",
        "opentype-LICENSE.txt", "fflate-LICENSE.txt",
    )]
    files.extend(sorted(path for path in (root / "example").rglob("*") if path.is_file()))
    for path in files:
        if not path.is_file():
            raise FileNotFoundError(path)
    output = root / "release" / f"oled-studio-{version}.zip"
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.name if path.parent.name == "dist" else path.relative_to(root).as_posix())
    with ZipFile(output) as archive:
        bad = archive.testzip()
        if bad:
            raise ValueError(f"Corrupt archive entry: {bad}")
        if archive.read("oled-studio.html") != files[0].read_bytes():
            raise ValueError("Release HTML differs from the tested distribution")
    return output


if __name__ == "__main__":
    print(package(sys.argv[1]))
