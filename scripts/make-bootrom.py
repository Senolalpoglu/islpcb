"""Regenerates core/mcu/bootrom.ts from library/rp2040/bootrom-b1.bin (the 16 KB RP2040 B1 boot ROM).

Run: python scripts/make-bootrom.py
"""
import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
data = (ROOT / "library" / "rp2040" / "bootrom-b1.bin").read_bytes()
assert len(data) == 16384, "the B1 boot ROM is exactly 16 KB"
text = base64.b64encode(data).decode()
lines = [text[i : i + 120] for i in range(0, len(text), 120)]
body = " +\n".join(f"  '{line}'" for line in lines) + ";\n"
(ROOT / "core" / "mcu" / "bootrom.ts").write_text(
    "// RP2040 boot ROM, revision B1 (16 KB), as base64.\n"
    "// Built from https://github.com/raspberrypi/pico-bootrom (BSD-3-Clause, Copyright (c) Raspberry Pi Ltd).\n"
    "// The emulator needs it for the ROM function table (memcpy, flash helpers, soft-float, ...) that the\n"
    "// Pico SDK and the Arduino-Pico core call. Regenerate with: python scripts/make-bootrom.py\n\n"
    "export const BOOTROM_B1_BASE64 =\n" + body,
    encoding="utf-8",
)
print("wrote core/mcu/bootrom.ts")
