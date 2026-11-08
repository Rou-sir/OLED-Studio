import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SOURCE = ROOT / "vendor" / "u8g2" / "csrc"
NATIVE = ROOT / "native"
AVR = ROOT / ".tools" / "avr" / "bin"
ARM = ROOT / ".tools" / "xpack-arm-none-eabi-gcc-13.2.1-1.1" / "bin"
ARDUINO_U8G2 = ROOT / "vendor" / "u8g2-arduino" / "src"
CORE = [SOURCE / (name + ".c") for name in [
    "u8g2_setup", "u8g2_font", "u8g2_hvline", "u8g2_ll_hvline", "u8g2_intersection",
    "u8g2_box", "u8g2_bitmap", "u8x8_8x8",
]]

def run(args):
    subprocess.run([str(a) for a in args], cwd=ROOT, check=True)

font = BUILD / "target_font.c"
run([BUILD / "bdfconv.exe", "-f", "1", "-m", "32-65534", "-n", "oled_custom_font",
     "-o", font, BUILD / "otf.bdf"])
font.write_text('#include "u8g2.h"\n\n' + font.read_text(encoding="ascii"), encoding="ascii")
flags = ["-Os", "-ffunction-sections", "-fdata-sections", "-I" + str(SOURCE), "-I" + str(NATIVE)]
avr_flags = ["-Os", "-ffunction-sections", "-fdata-sections",
             "-I" + str(ARDUINO_U8G2 / "clib"), "-I" + str(NATIVE)]
avr_core = [ARDUINO_U8G2 / "clib" / source.name for source in CORE]
run([AVR / "avr-gcc.exe", "-mmcu=atmega328p", *avr_flags, *avr_core,
     NATIVE / "target_ui.c", font, NATIVE / "avr_flash.c",
     "-Wl,--gc-sections", "-o", BUILD / "avr-flash.elf"])
run([AVR / "avr-objcopy.exe", "-O", "binary", BUILD / "avr-flash.elf", BUILD / "avr-flash.bin"])
run([AVR / "avr-size.exe", BUILD / "avr-flash.elf"])
arduino = ROOT / "vendor" / "arduino-avr"
run([AVR / "avr-g++.exe", "-mmcu=atmega328p", *avr_flags, "-std=gnu++11",
     "-DARDUINO=10819", "-DARDUINO_AVR_UNO", "-DF_CPU=16000000UL",
     "-I" + str(arduino / "cores" / "arduino"),
     "-I" + str(arduino / "variants" / "standard"),
     "-I" + str(ARDUINO_U8G2),
     "-c", NATIVE / "arduino_compile.cpp", "-o", BUILD / "arduino-ui.o"])
arm_objects = BUILD / "arm"
arm_objects.mkdir(exist_ok=True)
for source in [*CORE, NATIVE / "target_ui.c", font]:
    run([ARM / "arm-none-eabi-gcc.exe", "-mcpu=cortex-m3", "-mthumb", *flags,
         "-c", source, "-o", arm_objects / (source.stem + ".o")])
run([ARM / "arm-none-eabi-gcc.exe", "-mcpu=cortex-m3", "-mthumb", "-nostdlib",
     "-Wl,-r", "-o", BUILD / "stm32-ui.o", *sorted(arm_objects.glob("*.o"))])
print("Real AVR firmware, Arduino adapter and Cortex-M3 UI objects compiled.")
