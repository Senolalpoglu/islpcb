"""Generates the shipped part library (library/parts/*.json) from compact Python descriptions.

Run: python scripts/gen-library.py

Every part is a sub-circuit of the simulator's primitives (see src/editor/customParts.ts for the format).
Logic is transistor-level CMOS, so gates, flip-flops and the 555 really are circuits, not look-up tables.
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "library" / "parts"
BETA = 0.02
VTH = 1.0


def txt(en, tr=None):
    return {"en": en, "tr": tr or en}


def part(id, label, category, prefix, symbol, elements=None, params=None, footprint=None, meter=None, footprints=None):
    spec = {"id": id, "label": label, "category": category, "prefix": prefix, "symbol": symbol, "builtin": True}
    if params:
        spec["params"] = params
    spec["model"] = {"elements": elements or []}
    if footprint:
        spec["footprint"] = footprint
    if footprints:
        spec["footprints"] = footprints
    if meter:
        spec["meter"] = meter
    return spec


def box(left, right, title=None):
    s = {"kind": "box", "left": left, "right": right}
    if title:
        s["title"] = title
    return s


def like(name, pins=None):
    s = {"kind": "like", "like": name}
    if pins:
        s["pins"] = pins
    return s


def param(name, en, tr, default, kind=None):
    p = {"name": name, "label": txt(en, tr), "default": default}
    if kind:
        p["kind"] = kind
    return p


def el(type, nodes, value=None, **props):
    e = {"type": type, "nodes": nodes}
    if value is not None:
        e["value"] = value
    if props:
        e["props"] = props
    return e


# ---- CMOS building blocks ---------------------------------------------------------------------
def nm(d, s, g):
    return el("M", [d, s, g], nmos=True, beta=BETA, vth=VTH)


def pm(d, s, g):
    return el("M", [d, s, g], nmos=False, beta=BETA, vth=VTH)


def inv(a, y, vdd, vss):
    return [nm(y, vss, a), pm(y, vdd, a)]


def nand2(a, b, y, vdd, vss, pre):
    n = f"{pre}_n"
    return [pm(y, vdd, a), pm(y, vdd, b), nm(y, n, a), nm(n, vss, b)]


def nor2(a, b, y, vdd, vss, pre):
    p = f"{pre}_p"
    return [pm(p, vdd, a), pm(y, p, b), nm(y, vss, a), nm(y, vss, b)]


def nor3(a, b, c, y, vdd, vss, pre):
    p1, p2 = f"{pre}_p1", f"{pre}_p2"
    return [pm(p1, vdd, a), pm(p2, p1, b), pm(y, p2, c), nm(y, vss, a), nm(y, vss, b), nm(y, vss, c)]


def buf(a, y, vdd, vss, pre):
    return inv(a, f"{pre}_m", vdd, vss) + inv(f"{pre}_m", y, vdd, vss)


def and2(a, b, y, vdd, vss, pre):
    return nand2(a, b, f"{pre}_m", vdd, vss, f"{pre}a") + inv(f"{pre}_m", y, vdd, vss)


def or2(a, b, y, vdd, vss, pre):
    return nor2(a, b, f"{pre}_m", vdd, vss, f"{pre}a") + inv(f"{pre}_m", y, vdd, vss)


def xor2(a, b, y, vdd, vss, pre):
    m, p, q = f"{pre}_m", f"{pre}_p", f"{pre}_q"
    return (
        nand2(a, b, m, vdd, vss, f"{pre}1")
        + nand2(a, m, p, vdd, vss, f"{pre}2")
        + nand2(b, m, q, vdd, vss, f"{pre}3")
        + nand2(p, q, y, vdd, vss, f"{pre}4")
    )


def xnor2(a, b, y, vdd, vss, pre):
    return xor2(a, b, f"{pre}_x", vdd, vss, f"{pre}x") + inv(f"{pre}_x", y, vdd, vss)


GATES = {
    "nand": (nand2, "NAND", "NAND kapısı"),
    "nor": (nor2, "NOR", "NOR kapısı"),
    "and": (and2, "AND", "AND kapısı"),
    "or": (or2, "OR", "OR kapısı"),
    "xor": (xor2, "XOR", "XOR kapısı"),
    "xnor": (xnor2, "XNOR", "XNOR kapısı"),
}

SUPPLY = el("V", ["vdd", "0"], 5)


def d_latch(d, e, q, qb, vdd, vss, pre):
    """Gated D latch from NAND gates; q follows d while e is high."""
    nd, s, r = f"{pre}_nd", f"{pre}_s", f"{pre}_r"
    return (
        inv(d, nd, vdd, vss)
        + nand2(d, e, s, vdd, vss, f"{pre}1")
        + nand2(nd, e, r, vdd, vss, f"{pre}2")
        + nand2(s, qb, q, vdd, vss, f"{pre}3")
        + nand2(r, q, qb, vdd, vss, f"{pre}4")
    )


def logic_parts():
    out = []
    for key, (fn, name, tr) in GATES.items():
        out.append(
            part(
                f"gate-{key}",
                txt(f"{name} gate (5 V)", f"{tr} (5 V)"),
                "logic",
                "U",
                box(["A", "B"], ["Y"], name),
                [SUPPLY, *fn("A", "B", "Y", "vdd", "0", "g")],
            )
        )
    out.append(part("gate-inv", txt("Inverter (5 V)", "Evirici (5 V)"), "logic", "U", box(["A"], ["Y"], "NOT"), [SUPPLY, *inv("A", "Y", "vdd", "0")]))
    out.append(part("gate-buf", txt("Buffer (5 V)", "Tampon (5 V)"), "logic", "U", box(["A"], ["Y"], "BUF"), [SUPPLY, *buf("A", "Y", "vdd", "0", "g")]))
    # Edge-triggered D flip-flop: master latch open while CLK is low, slave latch open while it is high.
    out.append(
        part(
            "dff",
            txt("D flip-flop (5 V)", "D flip-flop (5 V)"),
            "logic",
            "U",
            box(["D", "CLK"], ["Q", "QN"], "D-FF"),
            [
                SUPPLY,
                *inv("CLK", "nclk", "vdd", "0"),
                *d_latch("D", "nclk", "mq", "mqn", "vdd", "0", "m"),
                *d_latch("mq", "CLK", "Q", "QN", "vdd", "0", "s"),
            ],
        )
    )

    # 74-series DIP-14 chips: physical pins 1..7 down the left, 14..8 up the right.
    def quad(id, label, fn, left, right, groups):
        elements = []
        for i, (a, b, y) in enumerate(groups):
            elements += fn(a, b, y, "VCC", "GND", f"g{i}")
        out.append(part(id, label, "logic", "U", box(left, right, label["en"].split()[0]), elements, footprint="DIP14"))

    std_left = ["1A", "1B", "1Y", "2A", "2B", "2Y", "GND"]
    std_right = ["VCC", "4B", "4A", "4Y", "3B", "3A", "3Y"]
    std_groups = [("1A", "1B", "1Y"), ("2A", "2B", "2Y"), ("3A", "3B", "3Y"), ("4A", "4B", "4Y")]
    quad("74hc00", txt("74HC00 quad NAND", "74HC00 dörtlü NAND"), nand2, std_left, std_right, std_groups)
    quad("74hc08", txt("74HC08 quad AND", "74HC08 dörtlü AND"), and2, std_left, std_right, std_groups)
    quad("74hc32", txt("74HC32 quad OR", "74HC32 dörtlü OR"), or2, std_left, std_right, std_groups)
    quad("74hc86", txt("74HC86 quad XOR", "74HC86 dörtlü XOR"), xor2, std_left, std_right, std_groups)
    quad(
        "74hc02",
        txt("74HC02 quad NOR", "74HC02 dörtlü NOR"),
        nor2,
        ["1Y", "1A", "1B", "2Y", "2A", "2B", "GND"],
        ["VCC", "4Y", "4B", "4A", "3Y", "3B", "3A"],
        [("1A", "1B", "1Y"), ("2A", "2B", "2Y"), ("3A", "3B", "3Y"), ("4A", "4B", "4Y")],
    )
    hex_el = []
    for i, (a, y) in enumerate([("1A", "1Y"), ("2A", "2Y"), ("3A", "3Y"), ("4A", "4Y"), ("5A", "5Y"), ("6A", "6Y")]):
        hex_el += inv(a, y, "VCC", "GND")
    out.append(
        part(
            "74hc04",
            txt("74HC04 hex inverter", "74HC04 altılı evirici"),
            "logic",
            "U",
            box(["1A", "1Y", "2A", "2Y", "3A", "3Y", "GND"], ["VCC", "6A", "6Y", "5A", "5Y", "4A", "4Y"], "74HC04"),
            hex_el,
            footprint="DIP14",
        )
    )
    return out


def timer555():
    v, g = "VCC", "GND"
    return part(
        "ne555",
        txt("555 timer", "555 zamanlayıcı"),
        "ic",
        "U",
        box(["GND", "TRIG", "OUT", "RESET"], ["VCC", "DISCH", "THR", "CTRL"], "NE555"),
        [
            # Divider: CTRL sits at 2/3 VCC, the lower node n2 at 1/3 VCC.
            el("R", [v, "CTRL"], 5000),
            el("R", ["CTRL", "n2"], 5000),
            el("R", ["n2", g], 5000),
            # Comparators: c1 goes high when THR > CTRL (reset), c2 when TRIG < 1/3 VCC (set).
            {"type": "OA", "nodes": ["c1", "CTRL", "THR"], "p": v, "n": g, "props": {"rout": 100}},
            {"type": "OA", "nodes": ["c2", "TRIG", "n2"], "p": v, "n": g, "props": {"rout": 100}},
            # Reset input is active low.
            *inv("RESET", "rn", v, g),
            # SR latch: Q = NOR(reset sources, QN), QN = NOR(set, Q).
            *nor3("c1", "rn", "QN", "Q", v, g, "q"),
            *nor2("c2", "Q", "QN", v, g, "qn"),
            # Output stage and discharge transistor (on while the output is low).
            *inv("QN", "OUT", v, g),
            el("M", ["DISCH", g, "QN"], nmos=True, beta=0.05, vth=VTH),
        ],
        footprint="DIP8",
    )


def components():
    out = []
    def led(id, en, tr, is_, n):
        return part(id, txt(en, tr), "semi", "D", like("LED"), [{"type": "D", "nodes": ["A", "K"], "props": {"is": is_, "n": n}}])

    out.append(part("zener", txt("Zener diode", "Zener diyot"), "semi", "D", like("D", ["A", "K"]), [{"type": "D", "nodes": ["A", "K"], "props": {"bv": "$vz"}}], [param("vz", "Zener voltage (V)", "Zener gerilimi (V)", 5.1)]))
    out.append(part("schottky", txt("Schottky diode", "Schottky diyot"), "semi", "D", like("D", ["A", "K"]), [{"type": "D", "nodes": ["A", "K"], "props": {"is": 1e-7, "n": 1.05}}]))
    out.append(led("led-green", "LED green", "LED yeşil", 1e-19, 2))
    out.append(led("led-yellow", "LED yellow", "LED sarı", 3e-20, 2))
    out.append(led("led-blue", "LED blue", "LED mavi", 1e-22, 2.5))
    out.append(led("led-white", "LED white", "LED beyaz", 5e-23, 2.5))
    out.append(
        part(
            "bridge",
            txt("Bridge rectifier", "Köprü diyot"),
            "semi",
            "BR",
            box(["AC1", "AC2"], ["DC+", "DC-"], "BRIDGE"),
            [el("D", ["AC1", "DC+"]), el("D", ["AC2", "DC+"]), el("D", ["DC-", "AC1"]), el("D", ["DC-", "AC2"])],
            footprint="SIP_4",
        )
    )
    out.append(part("nmos-power", txt("N-MOSFET power (IRF540)", "N-MOSFET güç (IRF540)"), "semi", "Q", like("NMOS", ["D", "G", "S"]), [{"type": "M", "nodes": ["D", "S", "G"], "props": {"nmos": True, "beta": 8, "vth": 3.5}}], footprint="TO92_MOS"))
    out.append(part("pmos-power", txt("P-MOSFET power (IRF9540)", "P-MOSFET güç (IRF9540)"), "semi", "Q", like("PMOS", ["D", "G", "S"]), [{"type": "M", "nodes": ["D", "S", "G"], "props": {"nmos": False, "beta": 4, "vth": 3.5}}], footprint="TO92_MOS"))

    out.append(
        part(
            "potentiometer",
            txt("Potentiometer", "Potansiyometre"),
            "passive",
            "RV",
            box(["A", "B"], ["W"], "POT"),
            [el("R", ["A", "W"], "max($r*$pos,0.01)"), el("R", ["W", "B"], "max($r*(1-$pos),0.01)")],
            [param("r", "Total resistance (Ω)", "Toplam direnç (Ω)", 10000), param("pos", "Wiper position (0-1)", "Kayar konumu (0-1)", 0.5)],
            footprint="SIP_3",
        )
    )
    out.append(part("ldr", txt("Photoresistor (LDR)", "Fotodirenç (LDR)"), "passive", "R", like("R", ["1", "2"]), [el("R", ["1", "2"], "$r")], [param("r", "Resistance in the light (Ω)", "Aydınlıktaki direnç (Ω)", 10000)]))
    out.append(part("ntc", txt("Thermistor (NTC)", "Termistör (NTC)"), "passive", "RT", like("R", ["1", "2"]), [el("R", ["1", "2"], "$r")], [param("r", "Resistance at the temperature (Ω)", "Sıcaklıktaki direnç (Ω)", 10000)]))
    out.append(
        part(
            "cap-electrolytic",
            txt("Electrolytic capacitor", "Elektrolitik kondansatör"),
            "passive",
            "C",
            {"kind": "glyph", "glyph": "cap-polar"},
            [el("C", ["+", "i"], "$c", ic="$ic"), el("R", ["i", "-"], "$esr")],
            [param("c", "Capacitance (F)", "Kapasite (F)", 1e-4), param("v", "Rated voltage (V)", "Anma gerilimi (V)", 25), param("esr", "ESR (Ω)", "ESR (Ω)", 0.1), param("ic", "Initial voltage (V)", "Başlangıç gerilimi (V)", 0)],
            footprint="CAP_RADIAL_D6.3_P2.5",
            footprints=["CAP_RADIAL_D5_P2", "CAP_RADIAL_D8_P3.5", "CAP_RADIAL_D10_P5", "CAP_RADIAL_D12.5_P5", "CAP_RADIAL_D16_P7.5"],
        )
    )
    out.append(part("speaker", txt("Speaker / buzzer", "Hoparlör / buzzer"), "passive", "LS", like("R", ["+", "-"]), [el("R", ["+", "-"], "$r")], [param("r", "Impedance (Ω)", "Empedans (Ω)", 8)], footprint="HDR_1X2"))
    out.append(
        part(
            "dc-motor",
            txt("DC motor", "DC motor"),
            "electromech",
            "M",
            box(["A"], ["B"], "M"),
            [el("R", ["A", "i"], "$r"), el("L", ["i", "B"], "$l")],
            [param("r", "Winding resistance (Ω)", "Sargı direnci (Ω)", 8), param("l", "Inductance (H)", "Endüktans (H)", 0.005)],
            footprint="HDR_1X2",
        )
    )

    out.append(
        part(
            "battery",
            txt("Battery with internal resistance", "İç dirençli pil"),
            "source",
            "BT",
            like("VDC", ["+", "-"]),
            [el("V", ["i", "-"], "$v"), el("R", ["+", "i"], "$esr")],
            [param("v", "Voltage (V)", "Gerilim (V)", 9), param("esr", "Internal resistance (Ω)", "İç direnç (Ω)", 0.5)],
            footprint="TERM_5.08",
        )
    )
    out.append(
        part(
            "vtri",
            txt("Triangle voltage source", "Üçgen dalga kaynağı"),
            "source",
            "V",
            like("VAC", ["+", "-"]),
            [{"type": "V", "nodes": ["+", "-"], "wave": {"kind": "tri", "low": "$low", "high": "$high", "freq": "$freq"}}],
            [param("low", "Low level (V)", "Alt seviye (V)", 0), param("high", "High level (V)", "Üst seviye (V)", 5), param("freq", "Frequency (Hz)", "Frekans (Hz)", 1000)],
            footprint="TERM_5.08",
        )
    )

    out.append(part("voltmeter", txt("Voltmeter", "Voltmetre"), "meter", "VM", box(["+"], ["-"], "V"), [el("R", ["+", "-"], 1e7)], meter="voltage", footprint="HDR_1X2"))
    out.append(part("ammeter", txt("Ammeter", "Ampermetre"), "meter", "AM", box(["+"], ["-"], "A"), [el("R", ["+", "-"], 0.001)], meter="current", footprint="HDR_1X2"))

    out.append(
        part(
            "spdt",
            txt("SPDT switch", "SPDT anahtar"),
            "switch",
            "S",
            box(["COM"], ["NC", "NO"], "SPDT"),
            [el("SW", ["COM", "NO"], closed="$pos>0.5"), el("SW", ["COM", "NC"], closed="$pos<=0.5")],
            [param("pos", "Position (0 = NC, 1 = NO)", "Konum (0 = NC, 1 = NO)", 0)],
            footprint="SIP_3",
        )
    )
    out.append(
        part(
            "relay",
            txt("Relay SPDT", "Röle SPDT"),
            "electromech",
            "K",
            box(["COIL+", "COIL-"], ["COM", "NC", "NO"], "RELAY"),
            [
                el("R", ["COIL+", "m"], "$rcoil"),
                el("L", ["m", "COIL-"], 0.05),
                {"type": "VSW", "nodes": ["COM", "NO", "COIL+", "COIL-"], "props": {"vth": "$vpull", "vhys": 0.6}},
                {"type": "VSW", "nodes": ["COM", "NC", "COIL+", "COIL-"], "props": {"vth": "$vpull", "vhys": 0.6, "inv": True}},
            ],
            [param("rcoil", "Coil resistance (Ω)", "Bobin direnci (Ω)", 200), param("vpull", "Pull-in voltage (V)", "Çekme gerilimi (V)", 3.5)],
            footprint="SIP_5",
        )
    )

    seg = ["a", "b", "c", "d", "e", "f", "g", "dp"]
    out.append(part("7seg-cc", txt("7-segment display, common cathode", "7 segment gösterge, ortak katot"), "semi", "DS", box(seg, ["COM"], "7SEG CC"), [{"type": "D", "nodes": [s, "COM"], "props": {"is": 1e-18, "n": 2}} for s in seg], footprint="SIP_9"))
    out.append(part("7seg-ca", txt("7-segment display, common anode", "7 segment gösterge, ortak anot"), "semi", "DS", box(seg, ["COM"], "7SEG CA"), [{"type": "D", "nodes": ["COM", s], "props": {"is": 1e-18, "n": 2}} for s in seg], footprint="SIP_9"))
    out.append(
        part(
            "led-rgb",
            txt("RGB LED, common cathode", "RGB LED, ortak katot"),
            "semi",
            "D",
            box(["R", "G", "B"], ["COM"], "RGB"),
            [
                {"type": "D", "nodes": ["R", "COM"], "props": {"is": 1e-18, "n": 2}},
                {"type": "D", "nodes": ["G", "COM"], "props": {"is": 1e-19, "n": 2}},
                {"type": "D", "nodes": ["B", "COM"], "props": {"is": 1e-22, "n": 2.5}},
            ],
            footprint="SIP_4",
        )
    )
    out.append(
        part(
            "optocoupler",
            txt("Optocoupler (PC817)", "Optokuplör (PC817)"),
            "semi",
            "U",
            box(["A", "K"], ["C", "E"], "OPTO"),
            [
                {"type": "D", "nodes": ["A", "s"], "props": {"is": 1e-18, "n": 2}},
                el("R", ["s", "K"], 0.1),
                # Base current = CTR / bf of the LED current: collector current = CTR * LED current.
                el("G", ["E", "b", "s", "K"], "$ctr/100/0.1"),
                el("R", ["b", "E"], 1e8),
                {"type": "Q", "nodes": ["C", "E", "b"], "props": {"npn": True, "bf": 100, "is": 1e-14}},
            ],
            [param("ctr", "Current transfer ratio", "Akım aktarım oranı", 1.0)],
        )
    )
    return out


def ics():
    out = [timer555()]
    out.append(
        part(
            "lm358",
            txt("LM358 dual op-amp", "LM358 çift op-amp"),
            "ic",
            "U",
            box(["OUT1", "IN1-", "IN1+", "GND"], ["VCC", "OUT2", "IN2-", "IN2+"], "LM358"),
            [
                {"type": "OA", "nodes": ["OUT1", "IN1-", "IN1+"], "p": "VCC", "n": "GND", "props": {"headroom": 1.5, "headroomLo": 0.02, "rout": 100}},
                {"type": "OA", "nodes": ["OUT2", "IN2-", "IN2+"], "p": "VCC", "n": "GND", "props": {"headroom": 1.5, "headroomLo": 0.02, "rout": 100}},
            ],
            footprint="DIP8",
        )
    )
    out.append(
        part(
            "lm741",
            txt("LM741 op-amp", "LM741 op-amp"),
            "ic",
            "U",
            box(["NULL", "IN-", "IN+", "V-"], ["NC", "V+", "OUT", "NULL2"], "LM741"),
            [{"type": "OA", "nodes": ["OUT", "IN-", "IN+"], "p": "V+", "n": "V-", "props": {"headroom": 2, "rout": 75}}],
            footprint="DIP8",
        )
    )
    out.append(
        part(
            "opamp-supply",
            txt("Op-amp with supply pins", "Besleme uçlu op-amp"),
            "ic",
            "U",
            {"kind": "opamp5"},
            [{"type": "OA", "nodes": ["OUT", "-", "+"], "p": "V+", "n": "V-", "props": {"headroom": "$headroom", "headroomLo": "$headroom"}}],
            [param("headroom", "Output headroom to the rails (V)", "Raylara çıkış payı (V)", 1.0)],
            footprint="SIP_5",
        )
    )
    out.append(
        part(
            "regulator",
            txt("Linear regulator (78xx)", "Lineer regülatör (78xx)"),
            "power",
            "U",
            box(["IN", "GND"], ["OUT"], "78xx"),
            [
                el("V", ["ref", "GND"], "$vout/2"),
                el("R", ["OUT", "fb"], 10000),
                el("R", ["fb", "GND"], 10000),
                {"type": "OA", "nodes": ["drv", "fb", "ref"], "p": "IN", "n": "GND", "props": {"headroom": 1.5, "headroomLo": 0, "rout": 20}},
                {"type": "Q", "nodes": ["IN", "OUT", "drv"], "props": {"npn": True, "bf": 50, "is": 1e-14}},
            ],
            [param("vout", "Output voltage (V)", "Çıkış gerilimi (V)", 5)],
            footprint="SIP_3",
        )
    )
    for n in (2, 3, 4, 6, 8):
        out.append(part(f"conn-{n}", txt(f"Connector {n} pins", f"Konnektör {n} pin"), "misc", "J", box([str(i) for i in range(1, n + 1)], [], f"CONN{n}"), footprint=f"SIP_{n}"))
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    import library_connectors
    import library_direnc
    import library_modules
    import library_more
    import library_motion
    import library_projects
    import library_ratings

    helpers = {"txt": txt, "part": part, "box": box, "like": like, "param": param, "el": el, "inv": inv, "nand2": nand2, "nor2": nor2, "nor3": nor3, "and2": and2, "or2": or2, "xor2": xor2}
    more = {**library_more.build(helpers), **library_modules.build(helpers), **library_motion.build(helpers), **library_connectors.build(helpers), **library_direnc.build(helpers), **library_projects.build(helpers)}
    replaced = {p["id"] for parts in more.values() for p in parts}
    fixes = {
        "potentiometer": ("SIP_3", ["A", "W", "B"]),
        "bridge": ("DIP4", ["DC+", "AC1", "DC-", "AC2"]),
        "led-rgb": ("SIP_4", ["R", "COM", "G", "B"]),
        "optocoupler": ("DIP4", None),
        "7seg-cc": ("SEG7", ["e", "d", "COM", "c", "dp", "g", "f", "COM", "a", "b"]),
        "7seg-ca": ("SEG7", ["e", "d", "COM", "c", "dp", "g", "f", "COM", "a", "b"]),
        "regulator": ("TO220", ["IN", "GND", "OUT"]),
        "nmos-power": ("TO220", ["G", "D", "S"]),
        "pmos-power": ("TO220", ["G", "D", "S"]),
        "speaker": ("HDR_1X2", None),
        # 741 pinout in a DIP-8: pin 6 output, 2 inverting, 3 non-inverting, 7 V+, 4 V-; "@n" is the symbol pin with that index.
        "opamp-supply": ("DIP8", ["NC", "@1", "@2", "@4", "NC", "@3", "@0", "NC"]),
    }

    def fixed_up(spec):
        # Idealised gates and the flip-flop have no package: they exist in the simulation only.
        if spec["id"].startswith("conn-"):
            spec["category"] = "connector"
        if spec["id"].startswith("gate-") or spec["id"] == "dff":
            spec["virtual"] = True
        if spec["id"] in fixes:
            fp, pad_map = fixes[spec["id"]]
            spec["footprint"] = fp
            if pad_map:
                spec["padMap"] = pad_map
        return spec

    files = {"components.json": [fixed_up(p) for p in components() if p["id"] not in replaced], "logic.json": [fixed_up(p) for p in logic_parts()], "ics.json": [fixed_up(p) for p in ics()], **more}
    library_ratings.apply(files)
    total = 0
    for name, parts in files.items():
        (OUT / name).write_text(json.dumps(parts, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        total += len(parts)
        print(f"{name}: {len(parts)} parts")
    print("total", total)


if __name__ == "__main__":
    main()
