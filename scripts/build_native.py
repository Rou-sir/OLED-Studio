import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "vendor" / "u8g2"
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)
SDK = ROOT / ".tools" / "emsdk"
ENV = os.environ.copy()
ENV["EM_CONFIG"] = str(SDK / ".emscripten")
ENV["PYTHONUTF8"] = "1"
ENV["PATH"] = str(ROOT / ".tools" / "node-v24.11.0-win-x64") + os.pathsep + ENV["PATH"]
EMCC = SDK / "upstream" / "emscripten" / "emcc.py"
CORE_FILES = [
    "u8g2_setup", "u8g2_font", "u8g2_hvline", "u8g2_ll_hvline",
    "u8g2_intersection", "u8g2_box", "u8g2_circle", "u8g2_line",
    "u8g2_polygon", "u8g2_arc", "u8g2_bitmap", "u8g2_buffer", "u8g2_cleardisplay",
    "u8x8_8x8", "u8x8_setup", "u8x8_cad", "u8x8_byte", "u8x8_gpio",
    "u8g2_kerning", "u8x8_display", "u8x8_capture", "u8x8_u16toa",
]
FONT_NAMES = ["u8g2_font_5x7_tr", "u8g2_font_6x10_tr", "u8g2_font_9x15_tr"]
font_source = (SOURCE / "csrc" / "u8g2_fonts.c").read_text(encoding="latin-1")
fonts = ['#include "u8g2.h"\n']
for name in FONT_NAMES:
    match = re.search(r"const uint8_t " + name + r"\[\d+\][\s\S]*?;\n", font_source)
    if match is None:
        raise RuntimeError(f"Missing builtin font {name}")
    fonts.append(match.group(0))
(BUILD / "builtin_fonts.c").write_text("\n".join(fonts), encoding="utf-8")

core = [str(SOURCE / "csrc" / (name + ".c")) for name in CORE_FILES]
renderer = [str(ROOT / "native" / "renderer.c"), str(BUILD / "builtin_fonts.c"), *core]
include = ["-I" + str(SOURCE / "csrc"), "-I" + str(ROOT / "native")]
exports = [
    "_malloc", "_free", "_render_init", "_render_page", "_render_color", "_render_line",
    "_render_pixel", "_render_hvline", "_render_ellipse", "_render_arc",
    "_render_rect", "_render_round_rect", "_render_circle", "_render_triangle", "_render_polygon", "_render_bitmap",
    "_render_font", "_render_text", "_render_ascent", "_render_descent", "_render_width",
    "_render_glyph", "_render_pixels",
]
common = ["-O2", "-sMODULARIZE=1", "-sSINGLE_FILE=1", "-sALLOW_MEMORY_GROWTH=1",
          "-sENVIRONMENT=web,worker,node", "-sASSERTIONS=1"]

def run(args):
    print("Running:", " ".join(str(a) for a in args[:5]), "...", flush=True)
    subprocess.run([str(a) for a in args], cwd=ROOT, env=ENV, check=True)

run(["python", EMCC, *renderer, *include, *common,
     "-sEXPORT_NAME=OledRenderer", "-sEXPORTED_FUNCTIONS=" + json.dumps(exports),
     "-sEXPORTED_RUNTIME_METHODS=" + json.dumps(["HEAPU8"]),
     "-o", BUILD / "renderer.js"])
if "--renderer-only" in sys.argv:
    print("Renderer WASM updated; converter and native/MCU compilation skipped.", flush=True)
    sys.exit(0)

bdf = SOURCE / "tools" / "font" / "bdfconv"
converter = [str(bdf / (name + ".c")) for name in [
    "main", "bdf_font", "bdf_glyph", "bdf_parser", "bdf_map", "bdf_rle",
    "bdf_tga", "fd", "bdf_8x8", "bdf_kern",
]]
run(["python", EMCC, *converter, *common, "-sEXPORT_NAME=OledFontConverter",
     "-sINVOKE_RUN=0", "-sFORCE_FILESYSTEM=1",
     "-sEXPORTED_RUNTIME_METHODS=" + json.dumps(["FS", "callMain"]),
     "-o", BUILD / "bdfconv.js"])

vswhere = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Microsoft Visual Studio" / "Installer" / "vswhere.exe"
vs = subprocess.check_output([str(vswhere), "-latest", "-products", "*",
    "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property", "installationPath"], text=True).strip()
if not vs:
    raise RuntimeError("Native verification requires Visual Studio C build tools")
vcvars = Path(vs) / "VC" / "Auxiliary" / "Build" / "vcvars64.bat"
native_dir = BUILD / "native"
native_dir.mkdir(exist_ok=True)
compiler_args = ["/nologo", "/O2", "/Gy",
                 "/I" + str(SOURCE / "csrc"), "/I" + str(ROOT / "native")]

def compile_native(files, output, extra=()):
    response = native_dir / "compile.rsp"
    response.write_text("\n".join(subprocess.list2cmdline([str(a)]) for a in [
        *compiler_args, *extra, *files, "/Fe:" + str(output)
    ]), encoding="utf-16")
    command = f'call "{vcvars}" >nul && cd /d "{native_dir}" && cl @"{response}" /link /OPT:REF'
    subprocess.run(command, shell=True, check=True)

shutil.copyfile(bdf / "bdfconv.exe", BUILD / "bdfconv.exe")
compile_native([*renderer, ROOT / "native" / "reference.c"], BUILD / "reference.exe")
compile_native([*renderer, ROOT / "native" / "cpp_reference.cpp"], BUILD / "cpp_reference.exe",
               ["/EHsc", "/I" + str(SOURCE / "cppsrc")])
print("Native and embedded-WASM builds complete.", flush=True)
