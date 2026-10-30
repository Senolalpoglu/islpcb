"""Operating limits of the library parts (the "ratings" entry of a part, see src/editor/customParts.ts).

The schematic compares these with the simulation and puts an exclamation mark next to a part that is over voltage,
over current, over its power rating, or connected the wrong way round. The numbers are the absolute maximum ratings of
the data sheets (the part is not expected to survive beyond them), as instantaneous peak values.

`apply(parts_by_file)` adds the ratings in place; run on its own (`python scripts/library_ratings.py`) it updates the
JSON files in library/parts. Parts that already carry a "ratings" entry (the project parts) are left alone.
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "library" / "parts"


def rv(a, b, mx=None, mn=None, polar=None):
    return {k: v for k, v in (("a", a), ("b", b), ("max", mx), ("min", mn), ("polar", polar)) if v is not None}


def ri(pin, mx):
    return {"pin": pin, "max": mx}


def supply(hi, lo, mx, mn=-0.5):
    """Supply pins: above `mx` is too much, below `mn` is the supply connected backwards."""
    return rv(hi, lo, mx, mn, "min")


def build_table():
    t = {}

    # ---- bipolar transistors: (collector-emitter V, collector A, power W) ----
    npn = {"2n2222": (40, 0.8, 0.5), "2n3904": (40, 0.2, 0.625), "bc547": (45, 0.1, 0.5), "bc337": (45, 0.8, 0.625), "bd139": (80, 1.5, 12.5), "tip31c": (100, 3, 40),
           "2n3055": (60, 15, 115), "tip120": (60, 5, 65), "bc107": (45, 0.1, 0.3), "bc108": (20, 0.1, 0.3), "bc140": (40, 1, 3.7), "tip29c": (100, 1, 30), "bu508a": (700, 8, 125)}
    pnp = {"2n3906": (40, 0.2, 0.625), "bc557": (45, 0.1, 0.5), "bc327": (45, 0.8, 0.625), "bd140": (80, 1.5, 12.5), "tip32c": (100, 3, 40), "mj2955": (60, 15, 115),
           "tip125": (60, 5, 65), "bd138": (60, 1.5, 12.5), "bc856b": (65, 0.1, 0.3), "mmbt2907a": (60, 0.6, 0.3)}
    for k, (v, i, p) in npn.items():
        t[k] = {"v": [rv("C", "E", v), rv("B", "E", None, -6)], "i": [ri("C", i)], "p": p}
    for k, (v, i, p) in pnp.items():
        t[k] = {"v": [rv("E", "C", v), rv("E", "B", None, -6)], "i": [ri("C", i)], "p": p}

    # ---- MOSFETs: (drain-source V, drain A, power W, gate V) ----
    nmos = {"irf540n": (100, 33, 94, 20), "irf520": (100, 9.2, 60, 20), "irfz44n": (55, 49, 94, 20), "irlz44n": (55, 47, 110, 16), "irf3205": (55, 110, 200, 20), "2n7000": (60, 0.2, 0.4, 20),
            "bs170": (60, 0.5, 0.83, 20), "irf510": (100, 5.6, 43, 20), "irf530": (100, 14, 88, 20), "irf540": (100, 28, 150, 20), "irf630": (200, 9, 74, 20), "6n60": (600, 6, 125, 30),
            "12n65": (650, 12, 150, 30), "2n7002": (60, 0.115, 0.2, 20), "nmos-power": (100, 30, 100, 20)}
    pmos = {"irf9540": (100, 19, 150, 20), "irf9z24n": (55, 12, 45, 20), "irf5210": (100, 40, 200, 20), "pmos-power": (100, 30, 100, 20)}
    for k, (v, i, p, g) in nmos.items():
        t[k] = {"v": [rv("D", "S", v), rv("G", "S", g, -g)], "i": [ri("D", i)], "p": p}
    for k, (v, i, p, g) in pmos.items():
        t[k] = {"v": [rv("S", "D", v), rv("S", "G", g, -g)], "i": [ri("D", i)], "p": p}

    # ---- diodes: (reverse V, forward A) ----
    for k, (v, i) in {"1n4007": (1000, 1), "1n4148": (100, 0.2), "1n5819": (40, 1), "1n5817": (20, 1), "1n5822": (40, 3), "1n4001": (50, 1), "1n4004": (400, 1), "1n5408": (1000, 3),
                      "ba159": (1000, 1), "uf4007": (1000, 1), "bas16": (75, 0.2), "schottky": (40, 1)}.items():
        t[k] = {"v": [rv("A", "K", None, -v)], "i": [ri("A", i)]}
    t["zener"] = {"p": 1.0}
    for n in range(4727, 4757):
        t[f"1n{n}"] = {"p": 1.0}
    for k in ("led-green", "led-yellow", "led-blue", "led-white", "led-orange", "led-ir"):
        t[k] = {"v": [rv("A", "K", None, -5, "min")], "i": [ri("A", 0.03)]}
    for k in ("7seg-cc", "7seg-ca"):
        t[k] = {"i": [ri(s, 0.03) for s in ("a", "b", "c", "d", "e", "f", "g", "dp")]}
    for k, vce in {"optocoupler": 70, "4n25": 70, "4n35": 70, "el817": 80, "pc814": 80}.items():
        t[k] = {"v": [rv("A", "K", None, -6, "min"), rv("C", "E", vce, -0.5)], "i": [ri("A", 0.06)]}

    # ---- thyristors and triacs: (blocking V, current A) ----
    for k, (v, i) in {"scr-2n5060": (30, 0.8), "scr-bt151": (650, 12), "scr-tyn616": (600, 16), "scr-bt152": (650, 20), "scr-bt169": (500, 0.8)}.items():
        t[k] = {"v": [rv("A", "K", v, -v)], "i": [ri("A", i)]}
    for k, i in {"triac-bt136": 4, "triac-bt137": 8, "triac-bt138": 12, "triac-bt139": 16, "triac-bta16": 16, "triac-z0103": 1}.items():
        t[k] = {"v": [rv("MT2", "MT1", 600, -600)], "i": [ri("MT2", i)]}

    # ---- regulators ----
    for k, (vin, i) in {"lm7805": (35, 1.5), "lm7806": (35, 1.5), "lm7808": (35, 1.5), "lm7809": (35, 1.5), "lm7812": (35, 1.5), "lm7815": (35, 1.5), "lm7818": (35, 1.5), "lm7824": (40, 1.5),
                        "lm78m05": (35, 0.5), "lm78m12": (35, 0.5), "ka78t05": (35, 3), "lm78l05": (30, 0.1), "lm1117-3v3": (15, 0.8), "lm1117-5v": (15, 0.8), "ams1117-3v3": (15, 1),
                        "ams1117-5v": (15, 1), "ams1117-2v5": (15, 1), "ams1117-1v8": (15, 1), "ams1117-1v2": (15, 1), "lm2940-5": (26, 1), "mcp1700-3v3": (6, 0.25)}.items():
        t[k] = {"v": [supply("IN", "GND", vin)], "i": [ri("OUT", i)], "p": 15 if i >= 1 else 3}
    for k in ("lm7905", "lm7912"):
        t[k] = {"v": [supply("GND", "IN", 35)], "i": [ri("OUT", 1.5)], "p": 15}
    t["lm317"] = {"v": [rv("IN", "OUT", 40, -0.5, "min")], "i": [ri("OUT", 1.5)], "p": 20}

    # ---- integrated circuits: supply voltage ----
    t["lm555"] = {"v": [supply("VCC", "GND", 16)]}
    t["lm556"] = None
    t["lm358"] = {"v": [supply("VCC", "GND", 32)]}
    t["lm393"] = {"v": [supply("VCC", "GND", 36)]}
    t["lm339"] = {"v": [supply("VCC", "GND", 36)]}
    t["lm324"] = {"v": [supply("VCC", "GND", 32)]}
    for k in ("lm741", "ca3140", "tl072"):
        t[k] = {"v": [supply("V+", "V-", 36)]}
    for k in ("cd4001", "cd4011", "cd4071", "cd4081", "cd4070"):
        t[k] = {"v": [supply("VDD", "VSS", 18)]}
    for k in ("74hc00", "74hc08", "74hc32", "74hc86", "74hc02", "74hc04"):
        t[k] = {"v": [supply("VCC", "GND", 7)]}
    t["uln2003"] = {"v": [rv("COM", "GND", 50, -0.5)], "i": [ri(f"{n}C", 0.5) for n in range(1, 8)]}

    # ---- relays and drivers ----
    for k, v in {"relay-srd-5v-a": 7, "relay-srd-12v-c": 17, "relay-srd-12v-a": 17, "relay-srd-24v-c": 34, "relay-srd-24v-a": 34}.items():
        t[k] = {"v": [rv("COIL+", "COIL-", v, -v)], "i": [ri("COM", 10)]}
    for k, v in {"relay-g2rl-2-12v": 17, "relay-g2rl-2-24v": 34}.items():
        t[k] = {"v": [rv("COIL+", "COIL-", v, -v)], "i": [ri("COM1", 8), ri("COM2", 8)]}
    t["relay-module-1ch"] = {"v": [supply("DC+", "DC-", 7), rv("IN", "DC-", 7, -0.5)]}
    t["ssr-dc"] = {"v": [rv("IN+", "IN-", 32, -32)]}
    t["l298n"] = {"v": [supply("12V", "GND", 35), rv("5V", "GND", 7, -0.5)], "i": [ri(f"OUT{n}", 2) for n in range(1, 5)]}
    t["a4988"] = {"v": [supply("VMOT", "GND_M", 35), supply("VDD", "GND", 5.5)], "i": [ri(s, 2) for s in ("1A", "1B", "2A", "2B")]}
    t["servo-sg90"] = {"v": [supply("VCC", "GND", 7.2)]}

    # ---- modules and sensors ----
    t["hc-05"] = {"v": [supply("VCC", "GND", 6), rv("RXD", "GND", 3.6, -0.5), rv("STATE", "GND", 3.6, -0.5)]}
    t["hc-06"] = {"v": [supply("VCC", "GND", 6), rv("RXD", "GND", 3.6, -0.5)]}
    t["esp-01"] = {"v": [supply("VCC", "GND", 3.6)] + [rv(p, "GND", 3.6, -0.5) for p in ("RXD", "TXD", "GPIO0", "GPIO2", "CH_PD", "RST")]}
    t["nrf24l01"] = {"v": [supply("VCC", "GND", 3.6)]}
    t["neo-6m"] = {"v": [supply("VCC", "GND", 5.5)]}
    t["rc522"] = {"v": [supply("3V3", "GND", 3.6)] + [rv(p, "GND", 3.6, -0.5) for p in ("SDA", "SCK", "MOSI", "MISO", "RST")]}
    for k in ("oled-ssd1306", "lcd1602-i2c", "tm1637", "sd-card", "ds3231", "mpu6050", "hx711", "dht11", "dht22", "hc-sr04", "ds18b20"):
        pins = {"oled-ssd1306": ("VCC", "GND"), "lcd1602-i2c": ("VCC", "GND"), "tm1637": ("VCC", "GND"), "sd-card": ("VCC", "GND"), "ds3231": ("VCC", "GND"), "mpu6050": ("VCC", "GND"),
                "hx711": ("VCC", "GND"), "dht11": ("VCC", "GND"), "dht22": ("VCC", "GND"), "hc-sr04": ("VCC", "GND"), "ds18b20": ("VDD", "GND")}[k]
        t[k] = {"v": [supply(pins[0], pins[1], 5.5)]}
    t["bmp280"] = {"v": [supply("VCC", "GND", 3.6)]}
    t["lm35"] = {"v": [supply("+VS", "GND", 30, -0.2)]}
    t["tmp36"] = {"v": [supply("+VS", "GND", 6, -0.3)]}
    t["pir-hc-sr501"] = {"v": [supply("VCC", "GND", 20)]}
    t["tsop1838"] = {"v": [supply("VCC", "GND", 6)]}
    t["joystick"] = {"v": [supply("+5V", "GND", 6)]}
    for k in ("ldr-module", "mq2-module", "soil-moisture", "sound-sensor", "rain-sensor", "mq3-module", "mq4-module", "mq5-module", "mq7-module", "mq9-module", "mq135-module"):
        t[k] = {"v": [supply("VCC", "GND", 6)]}
    for k, i in {"acs712-5a": 5, "acs712-20a": 20, "acs712-30a": 30}.items():
        t[k] = {"v": [supply("VCC", "GND", 6)], "i": [ri("IP+", i * 1.2)]}
    t["nextion-display"] = {"v": [supply("5V", "GND", 7)]}
    t["esp32-devkit"] = {"v": [supply("VIN", "GND", 12), rv("3V3", "GND", 3.6, -0.5)]}
    t["wemos-d1-mini"] = {"v": [supply("5V", "GND", 5.5), rv("3V3", "GND", 3.6, -0.5)]}

    # ---- motors, fans, valves, capacitors ----
    for k in ("fan-5v-50mm", "fan-12v-80mm", "fan-12v-120mm", "fan-24v-80mm"):
        t[k] = {"v": [rv("+", "-", "$vrated*1.25", -1.0, "min")]}
    for k in ("dc-motor", "pump-12v"):
        t[k] = {"v": [rv("A", "B", "$vrated*1.3", "-$vrated*1.3")]}
    for k in ("valve-12v", "valve-24v"):
        t[k] = {"v": [rv("+", "-", "$vopen/0.6*1.25", -0.5, "min")]}
    t["cap-electrolytic"] = {"v": [rv("+", "-", "$v", -1, "min")]}
    t["cap-tantalum"] = {"v": [rv("+", "-", "$v", -0.3, "min")]}
    return {k: v for k, v in t.items() if v}


def apply(files):
    """Adds `ratings` to every part of `files` (file name -> list of parts) that has an entry in the table and none yet."""
    table = build_table()
    n = 0
    for parts in files.values():
        for spec in parts:
            r = table.get(spec["id"])
            if r and "ratings" not in spec:
                spec["ratings"] = r
                n += 1
    return n


if __name__ == "__main__":
    files = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in sorted(OUT.glob("*.json"))}
    n = apply(files)
    for name, parts in files.items():
        (OUT / name).write_text(json.dumps(parts, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"ratings added to {n} parts")
