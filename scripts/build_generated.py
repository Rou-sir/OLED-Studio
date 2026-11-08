import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "build" / "generated"
SOURCE = ROOT / "vendor" / "u8g2" / "csrc"
CORE = [SOURCE / (name + ".c") for name in [
    "u8g2_setup", "u8g2_font", "u8g2_hvline", "u8g2_ll_hvline",
    "u8g2_intersection", "u8g2_box", "u8g2_circle", "u8g2_line", "u8g2_polygon",
    "u8g2_arc", "u8g2_bitmap", "u8g2_buffer", "u8g2_cleardisplay", "u8x8_8x8", "u8x8_setup",
    "u8x8_cad", "u8x8_byte", "u8x8_gpio", "u8g2_kerning", "u8x8_display",
    "u8x8_capture", "u8x8_u16toa",
]]
vswhere = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Microsoft Visual Studio" / "Installer" / "vswhere.exe"
vs = subprocess.check_output([str(vswhere), "-latest", "-products", "*",
    "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], text=True).strip()
if not vs:
    raise RuntimeError("MSVC tools are required for actual generated-source verification")
vcvars = Path(vs) / "VC" / "Auxiliary" / "Build" / "vcvars64.bat"
files = [ROOT / "native" / "renderer.c", ROOT / "native" / "generated_reference.c",
    ROOT / "build" / "builtin_fonts.c", OUTPUT / "esp-idf" / "oled_ui.c", OUTPUT / "esp-idf" / "oled_resources.c", *CORE]
args = ["/nologo", "/O2", "/Gy", "/I" + str(SOURCE), "/I" + str(ROOT / "native"),
    "/I" + str(OUTPUT / "esp-idf"), *files, "/Fe:" + str(OUTPUT / "reference.exe")]
rsp = OUTPUT / "compile.rsp"
rsp.write_text("\n".join(subprocess.list2cmdline([str(arg)]) for arg in args), encoding="utf-16")
subprocess.run(f'call "{vcvars}" >nul && cd /d "{OUTPUT}" && cl @"{rsp}" /link /OPT:REF', shell=True, check=True)

arm = ROOT / ".tools" / "xpack-arm-none-eabi-gcc-13.2.1-1.1" / "bin" / "arm-none-eabi-gcc.exe"
print("Actual ESP-IDF project-generated C compiled for host.")
for target in ["esp-idf", "stm32-hal"]:
    directory = OUTPUT / target
    for file in [directory / "oled_ui.c", directory / "oled_resources.c", ROOT / "native" / "generated_c_example.c"]:
        subprocess.run([str(arm), "-mcpu=cortex-m3", "-mthumb", "-Os", "-Wall", "-Wextra", "-Werror",
            "-I" + str(SOURCE), "-I" + str(directory), "-c", str(file),
            "-o", str(directory / (file.name + ".arm.o"))], check=True)
print("ESP-IDF/STM32 HAL package C and full/page call examples compiled (Cortex-M3 C portability, not ESP-IDF SDK build).")
avr = ROOT / ".tools" / "avr" / "bin"
arduino_u8g2 = ROOT / "vendor" / "u8g2-arduino" / "src"
avr_core = [arduino_u8g2 / "clib" / file.name for file in CORE]
avr_flags = ["-mmcu=atmega328p", "-Os", "-ffunction-sections", "-fdata-sections",
    "-I" + str(arduino_u8g2 / "clib"), "-I" + str(OUTPUT)]
arduino = ROOT / "vendor" / "arduino-avr"
cpp_flags = [*avr_flags, "-std=gnu++11", "-DARDUINO=10819",
    "-DARDUINO_AVR_UNO", "-DF_CPU=16000000UL", "-I" + str(arduino_u8g2),
    "-I" + str(arduino / "cores" / "arduino"), "-I" + str(arduino / "variants" / "standard"),
]
objects = []
for file in [*avr_core, ROOT / "build" / "builtin_fonts.c", OUTPUT / "oled_resources.c"]:
    obj = OUTPUT / (file.name + ".avr.o")
    subprocess.run([str(avr / "avr-gcc.exe"), *avr_flags, "-c", str(file), "-o", str(obj)], check=True)
    objects.append(obj)
for file in [OUTPUT / "oled_ui.cpp", ROOT / "native" / "generated_avr.cpp",
             arduino / "cores" / "arduino" / "Print.cpp"]:
    obj = OUTPUT / (file.name + ".avr.o")
    subprocess.run([str(avr / "avr-g++.exe"), *cpp_flags, "-c", str(file), "-o", str(obj)], check=True)
    objects.append(obj)
subprocess.run([str(avr / "avr-g++.exe"), *avr_flags, *map(str, objects),
    "-Wl,--gc-sections", "-o", str(OUTPUT / "avr.elf")], check=True)
subprocess.run([str(avr / "avr-objcopy.exe"), "-O", "binary", str(OUTPUT / "avr.elf"), str(OUTPUT / "avr.bin")], check=True)
subprocess.run([str(avr / "avr-size.exe"), str(OUTPUT / "avr.elf")], check=True)
subprocess.run([str(avr / "avr-g++.exe"), *cpp_flags,
    "-c", str(ROOT / "native" / "generated_arduino.cpp"), "-o", str(OUTPUT / "arduino.o")], check=True)
print("Actual generated native Arduino C++ page code, full/page examples and AVR firmware compiled.")
