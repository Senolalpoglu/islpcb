"""Parts added after studying the component catalogue of direnc.net: more transistors, MOSFETs, diodes, the whole
1N47xx zener series, thyristors, regulators, op-amps, comparators, an instrumentation amplifier, CMOS logic,
timers, optocouplers, gas and current sensor modules, crystals and other passives, and Tunik (Molex KK type) headers.
Imported by gen-library.py, which owns the helper functions.

Everything here is a circuit of the simulator's primitives with values taken from the maker's datasheet, not a
placeholder: the parameters are chosen so that the numbers a datasheet quotes come out of the simulation.

  * bipolar transistors: the saturation current is set from Vbe at a quoted collector current, bf is the typical hFE;
  * MOSFETs: beta = 1 / (Rds(on) * (Vgs - Vth)) at the Vgs of the Rds(on) figure, plus the body diode;
  * diodes: n, series resistance and Is are fitted to two points of the forward curve; zeners to Vz at Izt and Zzt;
  * thyristors: on-state resistance from the quoted VT at IT, holding current IH, gate threshold VGT;
  * regulators: output voltage, dropout and quiescent current; op-amps: gain, output swing, supply current;
  * comparators: open-collector outputs (a switch to ground) with the datasheet's saturation resistance;
  * AD620: the real three-op-amp topology, so the gain really is 1 + 49.4 k / Rg;
  * sensors: ACS712 senses real current through its 1.2 mOhm conductor and outputs Vcc/2 + sensitivity * I.

What is NOT modelled (and the notes say so where it matters): switching times, reverse recovery, current limiting of
the regulators, temperature, and the digital protocol of "smart" modules.
"""
import math

VT = 0.025852


def build(h):
    txt, part, box, like, param, el = h["txt"], h["part"], h["box"], h["like"], h["param"], h["el"]
    inv, nand2, nor2, nor3, and2, or2, xor2 = h["inv"], h["nand2"], h["nor2"], h["nor3"], h["and2"], h["or2"], h["xor2"]
    out = {"semis2.json": [], "analog2.json": [], "digital2.json": [], "sensors2.json": [], "passives2.json": [], "connectors2.json": []}

    def glyph(name):
        return {"kind": "glyph", "glyph": name}

    def add(file, spec, pad_map=None, note=None):
        if pad_map:
            spec["padMap"] = pad_map
        if note:
            spec["note"] = note
        out[file].append(spec)
        return spec

    def diode_el(a, k, is_, n, **extra):
        return {"type": "D", "nodes": [a, k], "props": {"is": is_, "n": n, **extra}}

    # ---- bipolar transistors: Is from Vbe at Ic, bf = typical hFE ------------------------------------------------
    def bjt(id, label, npn, bf, vbe, ic, fp, pad_map, note):
        is_ = ic / math.exp(vbe / VT)
        add("semis2.json", part(id, txt(label, label), "semi", "Q", like("QNPN" if npn else "QPNP", ["C", "B", "E"]), [{"type": "Q", "nodes": ["C", "E", "B"], "props": {"npn": npn, "bf": bf, "is": float(f"{is_:.3g}")}}], footprint=fp), pad_map, note)

    bjt("bc107", "BC107 NPN (45 V, 0.1 A, TO-18)", True, 250, 0.65, 2e-3, "TO18", ["E", "B", "C"], "hFE 110-450 (typ. 250), Vbe 0.65 V at 2 mA. TO-18 can: E, B, C.")
    bjt("bc108", "BC108 NPN (20 V, 0.1 A, TO-18)", True, 300, 0.65, 2e-3, "TO18", ["E", "B", "C"], "hFE 110-800 (typ. 300), Vbe 0.65 V at 2 mA. TO-18 can: E, B, C.")
    bjt("bc140", "BC140 NPN (40 V, 1 A, TO-39)", True, 100, 0.72, 0.1, "TO39", ["E", "B", "C"], "hFE 40-250 (typ. 100), Vbe 0.72 V at 100 mA. TO-39 can: E, B, C.")
    bjt("bd138", "BD138 PNP (60 V, 1.5 A, TO-126)", False, 100, 0.8, 0.5, "TO126", ["E", "C", "B"], "hFE 40-250 (typ. 100), Vbe 0.8 V at 0.5 A. TO-126: E, C, B.")
    bjt("tip29c", "TIP29C NPN power (100 V, 1 A)", True, 40, 0.9, 1.0, "TO220", ["B", "C", "E"], "hFE 15-75 (typ. 40), Vbe 0.9 V at 1 A. TO-220: B, C, E.")
    bjt("bu508a", "BU508A NPN high-voltage (1500 V, 8 A, TO-247)", True, 10, 1.0, 4.5, "TO247", ["B", "C", "E"], "Horizontal-deflection switch: hFE about 10 at 4.5 A, Vbe 1 V. TO-247: B, C, E.")
    bjt("bc856b", "BC856B PNP (65 V, 0.1 A, SOT-23)", False, 330, 0.65, 2e-3, "SOT23", ["B", "E", "C"], "hFE 220-475 (typ. 330). SOT-23: 1 B, 2 E, 3 C.")
    bjt("mmbt2907a", "MMBT2907A PNP (60 V, 0.6 A, SOT-23)", False, 150, 0.75, 0.15, "SOT23", ["B", "E", "C"], "hFE 100-300 (typ. 150). SOT-23: 1 B, 2 E, 3 C.")

    # ---- MOSFETs: beta from Rds(on) at the quoted Vgs, with the body diode ----------------------------------------
    def mos(id, label, nmos, rds, id_test, vth, vgs, fp, pad_map, note, lam=0.01):
        # The square-law channel is fitted so that Id = id_test at Vds = Rds(on) * id_test, the datasheet's test point.
        v = rds * id_test
        beta = round(id_test / (((vgs - vth) * v - v * v / 2) * (1 + lam * v)), 5)
        body = diode_el("S", "D", 2e-11, 1.5) if nmos else diode_el("D", "S", 2e-11, 1.5)
        elems = [{"type": "M", "nodes": ["D", "S", "G"], "props": {"nmos": nmos, "beta": beta, "vth": vth, "lambda": lam}}, body]
        add("semis2.json", part(id, txt(label, label), "semi", "Q", like("NMOS" if nmos else "PMOS", ["D", "G", "S"]), elems, footprint=fp), pad_map, note)

    to220 = ["G", "D", "S"]
    mos("irf510", "IRF510 N-MOSFET (100 V, 5.6 A)", True, 0.54, 3.4, 3.0, 10, "TO220", to220, "Rds(on) 0.54 ohm at Vgs 10 V, Vth 2-4 V. TO-220: G, D, S. Body diode included.")
    mos("irf530", "IRF530 N-MOSFET (100 V, 14 A)", True, 0.16, 8.4, 3.0, 10, "TO220", to220, "Rds(on) 0.16 ohm at Vgs 10 V, Vth 2-4 V. TO-220: G, D, S. Body diode included.")
    mos("irf540", "IRF540 N-MOSFET (100 V, 28 A)", True, 0.077, 17, 3.0, 10, "TO220", to220, "Rds(on) 77 mohm at Vgs 10 V, Vth 2-4 V. TO-220: G, D, S. Body diode included.")
    mos("irf630", "IRF630 N-MOSFET (200 V, 9 A)", True, 0.4, 5.4, 3.0, 10, "TO220", to220, "Rds(on) 0.4 ohm at Vgs 10 V, Vth 2-4 V. TO-220: G, D, S. Body diode included.")
    mos("irf9z24n", "IRF9Z24N P-MOSFET (55 V, 12 A)", False, 0.175, 7.2, 3.0, 10, "TO220", to220, "Rds(on) 0.175 ohm at Vgs -10 V, Vth -2 to -4 V. TO-220: G, D, S. Body diode included.")
    mos("irf5210", "IRF5210 P-MOSFET (100 V, 40 A)", False, 0.06, 21, 3.0, 10, "TO220", to220, "Rds(on) 60 mohm at Vgs -10 V, Vth -2 to -4 V. TO-220: G, D, S. Body diode included.")
    mos("6n60", "6N60 N-MOSFET (600 V, 6 A)", True, 1.2, 3, 3.5, 10, "TO220", to220, "Rds(on) 1.2 ohm at Vgs 10 V. TO-220: G, D, S. Body diode included.")
    mos("6n90", "6N90 N-MOSFET (900 V, 6 A)", True, 2.0, 3, 3.5, 10, "TO220", to220, "Rds(on) about 2 ohm at Vgs 10 V. TO-220: G, D, S. Body diode included.")
    mos("12n65", "12N65 N-MOSFET (650 V, 12 A)", True, 0.7, 6, 3.5, 10, "TO220", to220, "Rds(on) about 0.7 ohm at Vgs 10 V. TO-220: G, D, S. Body diode included.")
    mos("2n7002", "2N7002 N-MOSFET (60 V, 0.3 A, SOT-23)", True, 2.0, 0.5, 2.1, 10, "SOT23", ["G", "S", "D"], "Rds(on) about 2 ohm at Vgs 10 V, Vth 1-2.5 V (also covers 2N7002K / CK / KW). SOT-23: 1 G, 2 S, 3 D.")

    # ---- diodes: two points of the forward curve -----------------------------------------------------------------
    def fit(vf1, i1, vf2, i2, n):
        rs = max((vf2 - vf1 - n * VT * math.log(i2 / i1)) / (i2 - i1), 1e-3)
        is_ = i1 / math.exp((vf1 - i1 * rs) / (n * VT))
        return float(f"{is_:.3g}"), round(rs, 4)

    def diode(id, label, n, vf1, i1, vf2, i2, fp, glyph_name=None, bv=None, note=None):
        is_, rs = fit(vf1, i1, vf2, i2, n)
        props = {"is": is_, "n": n}
        if bv:
            props["bv"] = bv
        add("semis2.json", part(id, txt(label, label), "semi", "D", glyph(glyph_name) if glyph_name else like("D", ["A", "K"]), [{"type": "D", "nodes": ["A", "m"], "props": props}, el("R", ["m", "K"], rs)], footprint=fp), None, note)

    diode("1n5817", "1N5817 Schottky (20 V, 1 A)", 1.05, 0.34, 1.0, 0.55, 3.0, "AXIAL_10.16", "schottky", None, "Typical forward curve: 0.34 V at 1 A, 0.55 V at 3 A.")
    diode("1n5822", "1N5822 Schottky (40 V, 3 A)", 1.05, 0.35, 1.0, 0.46, 3.0, "AXIAL_12.7", "schottky", None, "Typical forward curve: 0.35 V at 1 A, 0.46 V at 3 A.")
    diode("1n4001", "1N4001 rectifier (50 V, 1 A)", 1.8, 0.88, 1.0, 1.05, 3.0, "AXIAL_10.16", None, 55, "Forward 0.88 V at 1 A, 1.05 V at 3 A (typical).")
    diode("1n4004", "1N4004 rectifier (400 V, 1 A)", 1.8, 0.88, 1.0, 1.05, 3.0, "AXIAL_10.16", None, 450, "Forward 0.88 V at 1 A, 1.05 V at 3 A (typical).")
    diode("1n5408", "1N5408 rectifier (1000 V, 3 A)", 1.8, 0.85, 1.0, 1.0, 3.0, "AXIAL_12.7", None, 1100, "Forward 0.85 V at 1 A, 1.0 V at 3 A (typical).")
    diode("ba159", "BA159 fast rectifier (1000 V, 1 A, 500 ns)", 1.9, 1.0, 1.0, 1.25, 3.0, "AXIAL_10.16", None, 1100, "Forward about 1 V at 1 A. Reverse recovery time is not simulated.")
    diode("uf4007", "UF4007 ultrafast rectifier (1000 V, 1 A, 75 ns)", 2.0, 1.25, 1.0, 1.5, 3.0, "AXIAL_10.16", None, 1100, "Forward about 1.25 V at 1 A. Reverse recovery time is not simulated.")
    is_s, rs_s = fit(0.9, 0.05, 1.25, 0.15, 2.0)
    add("semis2.json", part("bas16", txt("BAS16 switching diode (85 V, 0.2 A, SOT-23)", "BAS16 anahtarlama diyodu (85 V, 0,2 A, SOT-23)"), "semi", "D", like("D", ["A", "K"]), [diode_el("A", "m", is_s, 2.0, bv=95), el("R", ["m", "K"], rs_s)], footprint="SOT23"), ["A", "-", "K"], "SOT-23: 1 anode, 3 cathode (pin 2 unused). Forward 0.9 V at 50 mA, 1.25 V at 150 mA.")
    for id, label, left, right, pad_map, pairs in [
        ("baw56", "BAW56 dual switching diode, common anode (SOT-23)", ["K1", "K2"], ["A"], ["K1", "K2", "A"], [("A", "K1"), ("A", "K2")]),
        ("bav70", "BAV70 dual switching diode, common cathode (SOT-23)", ["A1", "A2"], ["K"], ["A1", "A2", "K"], [("A1", "K"), ("A2", "K")]),
    ]:
        elems = []
        for k, (a, kk) in enumerate(pairs):
            elems += [diode_el(a, f"m{k}", is_s, 2.0, bv=95), el("R", [f"m{k}", kk], rs_s)]
        add("semis2.json", part(id, txt(label, label), "semi", "D", box(left, right, id.upper()), elems, footprint="SOT23"), pad_map, "SOT-23 dual diode (NXP pinout). Forward 0.9 V at 50 mA.")

    # ---- zener diodes 1N4727A ... 1N4757A (1 W): Vz at Izt, dynamic impedance Zzt ----------------------------------
    zeners = [
        (4727, 3.0, 85, 10), (4728, 3.3, 76, 10), (4729, 3.6, 69, 10), (4730, 3.9, 64, 9), (4731, 4.3, 58, 9), (4732, 4.7, 53, 8), (4733, 5.1, 49, 7),
        (4734, 5.6, 45, 5), (4735, 6.2, 41, 2), (4736, 6.8, 37, 3.5), (4737, 7.5, 34, 4), (4738, 8.2, 31, 4.5), (4739, 9.1, 28, 5), (4740, 10, 25, 7),
        (4741, 11, 23, 8), (4742, 12, 21, 9), (4743, 13, 19, 10), (4744, 15, 17, 14), (4745, 16, 15.5, 16), (4746, 18, 14, 20), (4747, 20, 12.5, 22),
        (4748, 22, 11.5, 23), (4749, 24, 10.5, 25), (4750, 27, 9.5, 35), (4751, 30, 8.5, 40), (4752, 33, 7.5, 45), (4753, 36, 7, 50), (4754, 39, 6.5, 60),
        (4755, 43, 6, 70), (4756, 47, 5.5, 80), (4757, 51, 5, 95),
    ]
    for num, vz, izt, zzt in zeners:
        izt_a = izt * 1e-3
        rz = max(zzt - VT / izt_a, 0.1)
        bv = round(vz - izt_a * rz, 3)
        v = f"{vz:g}"
        add("semis2.json", part(f"1n{num}", txt(f"Zener 1N{num}A ({v} V, 1 W)", f"Zener 1N{num}A ({v.replace('.', ',')} V, 1 W)"), "semi", "D", glyph("zener"), [{"type": "D", "nodes": ["A", "m"], "props": {"is": 1e-14, "n": 1, "bv": bv, "ibv": izt_a}}, el("R", ["m", "K"], round(rz, 3))], footprint="AXIAL_7.62"), None, f"Vz {v} V at {izt:g} mA, dynamic impedance {zzt:g} ohm (Fairchild 1N47xxA series).")

    # ---- thyristors and triacs ---------------------------------------------------------------------------------
    # A conducting thyristor has a knee of about 0.85 V plus a resistance. The switch element is only a resistance, so the
    # knee is a diode in series (two antiparallel ones for a triac) and the resistance is what is left of VT at IT.
    knee_n = 1.5
    knee_is = float(f"{1.0 / math.exp(0.85 / (knee_n * VT)):.3g}")

    def knee_ron(vt, it):
        return round((vt - (0.85 + knee_n * VT * math.log(max(it, 1.0)))) / it, 4)

    def triac(id, label, vt, it, ih, vgt, rg, fp, pad_map, note):
        elems = [
            el("R", ["G", "MT1"], "$rg"),
            diode_el("MT2", "x", knee_is, knee_n),
            diode_el("x", "MT2", knee_is, knee_n),
            {"type": "THY", "nodes": ["x", "MT1", "G"], "props": {"vgt": vgt, "ih": ih, "ron": knee_ron(vt, it), "bidir": True}},
        ]
        add("semis2.json", part(id, txt(label, label), "semi", "Q", glyph("triac"), elems, [param("rg", "Gate resistance (Ω)", "Gate direnci (Ω)", rg)], footprint=fp), pad_map, note)

    def scr(id, label, vt, it, ih, vgt, rg, fp, pad_map, note):
        elems = [
            el("R", ["G", "K"], "$rg"),
            diode_el("A", "x", knee_is, knee_n),
            {"type": "THY", "nodes": ["x", "K", "G"], "props": {"vgt": vgt, "ih": ih, "ron": knee_ron(vt, it)}},
        ]
        add("semis2.json", part(id, txt(label, label), "semi", "Q", glyph("scr"), elems, [param("rg", "Gate-cathode resistance (Ω)", "Gate-katot direnci (Ω)", rg)], footprint=fp), pad_map, note)

    t220 = ["MT1", "MT2", "G"]
    triac("triac-bt137", "Triac BT137-600 (8 A, 600 V)", 1.65, 10, 15e-3, 1.0, 100, "TO220", t220, "VT 1.65 V at 10 A, IGT about 10 mA. TO-220: MT1, MT2, G.")
    triac("triac-bt138", "Triac BT138-600 (12 A, 600 V)", 1.65, 15, 15e-3, 1.0, 100, "TO220", t220, "VT 1.65 V at 15 A, IGT about 10 mA. TO-220: MT1, MT2, G.")
    triac("triac-bt139", "Triac BT139-600 (16 A, 600 V)", 1.65, 20, 15e-3, 1.0, 100, "TO220", t220, "VT 1.65 V at 20 A, IGT about 10 mA. TO-220: MT1, MT2, G.")
    scr("scr-bt152", "Thyristor SCR BT152-600 (13 A)", 1.75, 20, 20e-3, 1.0, 100, "TO220", ["K", "A", "G"], "VT 1.75 V at 20 A, IH about 20 mA. TO-220: K, A, G.")
    scr("scr-bt169", "Thyristor SCR BT169 (0.8 A, sensitive gate)", 1.35, 1.6, 2e-3, 0.5, 10000, "TO92", ["K", "G", "A"], "IGT about 50 uA, VGT 0.5 V, IH 2 mA. TO-92: K, G, A.")

    # ---- linear regulators --------------------------------------------------------------------------------------
    def reg(id, label, vout, dropout, iq_ma, fp, pad_map, note=""):
        hr = max(dropout - 0.7, 0)
        elems = [
            el("V", ["ref", "GND"], vout / 2),
            el("R", ["OUT", "fb"], 10000),
            el("R", ["fb", "GND"], 10000),
            {"type": "OA", "nodes": ["drv", "fb", "ref"], "p": "IN", "n": "GND", "props": {"headroom": hr, "headroomLo": 0, "rout": 20}},
            {"type": "Q", "nodes": ["IN", "OUT", "drv"], "props": {"npn": True, "bf": 50, "is": 1e-14}},
            el("R", ["IN", "GND"], round((vout + 3) / (iq_ma * 1e-3), 1)),
        ]
        add("analog2.json", part(id, txt(label, label), "power", "U", box(["IN", "GND"], ["OUT"], id.upper()), elems, footprint=fp), pad_map, f"Dropout about {dropout:g} V, quiescent current about {iq_ma:g} mA, no current limit. {note}".strip())

    for v in (6, 8, 18, 24):
        reg(f"lm78{v:02d}", f"LM78{v:02d} regulator +{v} V (1 A)", v, 2.0, 5.0, "TO220", ["IN", "GND", "OUT"], "TO-220: IN, GND, OUT.")
    reg("lm78m05", "78M05 regulator +5 V (0.5 A)", 5, 2.0, 4.5, "TO220", ["IN", "GND", "OUT"], "TO-220: IN, GND, OUT.")
    reg("lm78m12", "78M12 regulator +12 V (0.5 A)", 12, 2.0, 4.5, "TO220", ["IN", "GND", "OUT"], "TO-220: IN, GND, OUT.")
    reg("ka78t05", "KA78T05 regulator +5 V (3 A)", 5, 2.5, 6.0, "TO220", ["IN", "GND", "OUT"], "TO-220: IN, GND, OUT.")

    def ldo(id, label, vout, iq_ma, fp, pad_map, note):
        elems = [
            el("V", ["ref", "GND"], vout / 2),
            el("R", ["OUT", "fb"], 10000),
            el("R", ["fb", "GND"], 10000),
            {"type": "OA", "nodes": ["drv", "fb", "ref"], "p": "IN", "n": "GND", "props": {"headroom": 0.5, "headroomLo": 0, "rout": 20}},
            {"type": "Q", "nodes": ["IN", "OUT", "drv"], "props": {"npn": True, "bf": 50, "is": 1e-14}},
            el("R", ["IN", "GND"], round((vout + 1.2) / (iq_ma * 1e-3), 1)),
        ]
        add("analog2.json", part(id, txt(label, label), "power", "U", box(["IN", "GND"], ["OUT"], id.upper()), elems, footprint=fp), pad_map, note)

    for v, tag in ((5, "5v"), (2.5, "2v5"), (1.8, "1v8"), (1.2, "1v2")):
        ldo(f"ams1117-{tag}", f"AMS1117-{v:g} LDO regulator (1 A)", v, 5.0, "SOT223", ["GND", "OUT", "IN", "OUT"], "Dropout about 1.2 V, quiescent current about 5 mA, no current limit. SOT-223: 1 GND, 2 OUT, 3 IN, tab OUT.")
    add("analog2.json", part("lm337", txt("LM337 adjustable negative regulator (1.5 A)", "LM337 ayarlı negatif regülatör (1,5 A)"), "power", "U", box(["ADJ", "IN"], ["OUT"], "LM337"), [el("V", ["ref", "ADJ"], -1.25), {"type": "OA", "nodes": ["drv", "OUT", "ref"], "p": "ADJ", "n": "IN", "props": {"headroom": 1.3, "headroomLo": 0, "rout": 20}}, {"type": "Q", "nodes": ["IN", "OUT", "drv"], "props": {"npn": False, "bf": 50, "is": 1e-14}}], footprint="TO220"), ["ADJ", "IN", "OUT"], "Vadj - Vout = 1.25 V: with R1 from OUT to ADJ and R2 from ADJ to ground, Vout = -1.25 V * (1 + R2 / R1). TO-220: 1 ADJ, 2 IN, 3 OUT.")

    # ---- op-amps -------------------------------------------------------------------------------------------------
    def opamp_single(id, label, gain, hi, lo, rout, icc_ma, note):
        oa = {"type": "OA", "nodes": ["OUT", "IN-", "IN+"], "p": "V+", "n": "V-", "props": {"gain": gain, "headroom": hi, "headroomLo": lo, "rout": rout}}
        add("analog2.json", part(id, txt(label, label), "ic", "U", box(["NULL", "IN-", "IN+", "V-"], ["STROBE", "V+", "OUT", "NULL2"], id.upper()), [oa, el("R", ["V+", "V-"], round(30 / (icc_ma * 1e-3), 1))], footprint="DIP8"), None, note)

    opamp_single("ca3140", "CA3140 MOSFET-input op-amp", 1e5, 2.0, 0.6, 60, 4, "100 dB open-loop gain, output swings to V+ -2 V / V- +0.6 V, 4 mA supply current at +-15 V. DIP-8: 741 pinout (offset null and strobe pins are not simulated).")
    opamp_single("ca3130", "CA3130 CMOS op-amp", 3.2e5, 1.7, 0.02, 100, 10, "110 dB open-loop gain, output to within 0.02 V of V- and 1.7 V of V+. DIP-8: 741 pinout (offset null and strobe pins are not simulated).")

    def opamp_dual(id, label, gain, hi, lo, rout, icc_ma, note, single_supply=False):
        names = ("VCC", "GND") if single_supply else ("V+", "V-")
        elems = [{"type": "OA", "nodes": [f"OUT{k}", f"IN{k}-", f"IN{k}+"], "p": names[0], "n": names[1], "props": {"gain": gain, "headroom": hi, "headroomLo": lo, "rout": rout}} for k in (1, 2)]
        if icc_ma:
            elems.append(el("R", [names[0], names[1]], round(30 / (icc_ma * 1e-3), 1)))
        add("analog2.json", part(id, txt(label, label), "ic", "U", box(["OUT1", "IN1-", "IN1+", names[1]], [names[0], "OUT2", "IN2-", "IN2+"], id.upper()), elems, footprint="DIP8"), None, note)

    opamp_dual("ca3240", "CA3240 dual MOSFET-input op-amp", 1e5, 2.0, 0.6, 60, 5, "Two CA3140-class amplifiers, 100 dB gain. DIP-8: 1 OUT1 ... 8 V+.")
    opamp_dual("lm833", "LM833 dual audio op-amp", 3.2e5, 1.1, 1.1, 30, 4, "110 dB gain, 15 MHz, output +-13.9 V at +-15 V, 4 mA. DIP-8: 1 OUT1 ... 8 V+.")
    opamp_dual("lm258", "LM258 dual op-amp (single supply)", 1e5, 1.5, 0.02, 100, 0, "Same amplifier as the LM358. Output to the negative rail, V+ -1.5 V. DIP-8.", True)
    quad = [{"type": "OA", "nodes": [f"{k}OUT", f"{k}IN-", f"{k}IN+"], "p": "VCC", "n": "GND", "props": {"headroom": 1.5, "headroomLo": 0.02, "rout": 100}} for k in (1, 2, 3, 4)]
    add("analog2.json", part("lm224", txt("LM224 quad op-amp (single supply)", "LM224 dörtlü op-amp (tek besleme)"), "ic", "U", box(["1OUT", "1IN-", "1IN+", "VCC", "2IN+", "2IN-", "2OUT"], ["4OUT", "4IN-", "4IN+", "GND", "3IN+", "3IN-", "3OUT"], "LM224"), quad, footprint="DIP14"), None, "Same amplifiers as the LM324. Output to the negative rail, V+ -1.5 V. DIP-14.")

    # AD620: two input buffers around the gain resistor and a unity difference amplifier, as inside the chip.
    def ad_oa(out_, inn, inp, hi, lo, rout):
        return {"type": "OA", "nodes": [out_, inn, inp], "p": "V+", "n": "V-", "props": {"gain": 3e5, "headroom": hi, "headroomLo": lo, "rout": rout}}

    ad = [
        ad_oa("a1", "RG1", "IN+", 1.0, 1.0, 10), el("R", ["a1", "RG1"], 24700),
        ad_oa("a2", "RG2", "IN-", 1.0, 1.0, 10), el("R", ["a2", "RG2"], 24700),
        el("R", ["a1", "pb"], 10000), el("R", ["pb", "REF"], 10000), el("R", ["a2", "pa"], 10000), el("R", ["pa", "OUT"], 10000),
        ad_oa("OUT", "pa", "pb", 1.4, 1.2, 10),
        el("R", ["V+", "V-"], 11000),
    ]
    add("analog2.json", part("ad620", txt("AD620 instrumentation amplifier (gain = 1 + 49.4 k / Rg)", "AD620 enstrümantasyon yükselticisi (kazanç = 1 + 49,4 k / Rg)"), "ic", "U", box(["RG1", "IN-", "IN+", "V-"], ["RG2", "V+", "OUT", "REF"], "AD620"), ad, footprint="DIP8"), None, "Put the gain resistor Rg between RG1 and RG2 (open: gain 1). DIP-8: 1 RG, 2 -IN, 3 +IN, 4 -Vs, 5 REF, 6 OUT, 7 +Vs, 8 RG. Output is referenced to REF.")

    # ---- comparators: open-collector outputs ---------------------------------------------------------------------
    def sink(outp, gnd, inm, inp, ron=40):
        return {"type": "VSW", "nodes": [outp, gnd, inm, inp], "props": {"vth": 0, "vhys": 0.002, "ron": ron}}

    add("analog2.json", part("lm393", txt("LM393 dual comparator (open collector)", "LM393 çift karşılaştırıcı (açık kollektör)"), "ic", "U", box(["OUT1", "IN1-", "IN1+", "GND"], ["VCC", "OUT2", "IN2-", "IN2+"], "LM393"), [sink("OUT1", "GND", "IN1-", "IN1+"), sink("OUT2", "GND", "IN2-", "IN2+"), el("R", ["VCC", "GND"], 6250)], footprint="DIP8"), None, "The output pulls to ground while IN- is above IN+ and is open otherwise: add a pull-up resistor. Saturation about 40 ohm (0.16 V at 4 mA), 0.8 mA supply current. DIP-8.")
    quad_c = [sink("1OUT", "GND", "1IN-", "1IN+"), sink("2OUT", "GND", "2IN-", "2IN+"), sink("3OUT", "GND", "3IN-", "3IN+"), sink("4OUT", "GND", "4IN-", "4IN+"), el("R", ["VCC", "GND"], 5000)]
    left339 = ["2OUT", "1OUT", "VCC", "1IN-", "1IN+", "2IN-", "2IN+"]
    right339 = ["3OUT", "4OUT", "GND", "4IN+", "4IN-", "3IN+", "3IN-"]
    for id, label in (("lm339", "LM339 quad comparator (open collector)"), ("lm239", "LM239 quad comparator (open collector)")):
        add("analog2.json", part(id, txt(label, label), "ic", "U", box(left339, right339, id.upper()), quad_c, footprint="DIP14"), None, "Outputs pull to ground while IN- is above IN+, open otherwise: add pull-up resistors. About 40 ohm saturation, 1 mA supply current. DIP-14: 1 OUT2, 2 OUT1, 3 VCC, 4 IN1- ... 12 GND, 13 OUT4, 14 OUT3.")
    for id, label in (("lm311", "LM311 voltage comparator (single, open collector)"), ("lm211", "LM211 voltage comparator (single, open collector)")):
        elems = [
            {"type": "VSW", "nodes": ["OUT", "x", "IN-", "IN+"], "props": {"vth": 0, "vhys": 0.002, "ron": 40}},
            {"type": "VSW", "nodes": ["x", "GND", "STROBE", "GND"], "props": {"vth": 0.7, "vhys": 0.1, "ron": 1}},
            el("R", ["STROBE", "V+"], 100000),
            el("R", ["V+", "V-"], 6000),
        ]
        add("analog2.json", part(id, txt(label, label), "ic", "U", box(["GND", "IN+", "IN-", "V-"], ["V+", "OUT", "STROBE", "BAL"], id.upper()), elems, footprint="DIP8"), None, "Output transistor between OUT and GND: on while IN- is above IN+. Pulling STROBE to ground switches it off. The balance pin is not simulated. DIP-8: 1 GND, 2 IN+, 3 IN-, 4 V-, 5 BAL, 6 STROBE, 7 OUT, 8 V+.")

    # ---- CMOS logic CD4000 series and timers ------------------------------------------------------------------------
    def cd(id, label, fn, title):
        elems = []
        for k, (a, b, y) in enumerate([("A", "B", "J"), ("C", "D", "K"), ("E", "F", "L"), ("G", "H", "M")]):
            elems += fn(a, b, y, "VDD", "VSS", f"g{k}")
            elems += [el("R", [a, "VSS"], 1e9), el("R", [b, "VSS"], 1e9)]  # unused inputs read low instead of floating
        add("digital2.json", part(id, txt(label, label), "logic", "U", box(["A", "B", "J", "K", "C", "D", "VSS"], ["VDD", "H", "G", "M", "L", "F", "E"], title), elems, footprint="DIP14"), None, "CMOS gates built from transistors; works from 3 V to 15 V (VDD to VSS). Inputs have 1 Gohm to VSS, so unused ones read low. DIP-14: 1 A, 2 B, 3 J, 4 K, 5 C, 6 D, 7 VSS, 8 E, 9 F, 10 L, 11 M, 12 G, 13 H, 14 VDD.")

    cd("cd4001", "CD4001 quad 2-input NOR", nor2, "CD4001")
    cd("cd4011", "CD4011 quad 2-input NAND", nand2, "CD4011")
    cd("cd4071", "CD4071 quad 2-input OR", or2, "CD4071")
    cd("cd4081", "CD4081 quad 2-input AND", and2, "CD4081")
    cd("cd4070", "CD4070 quad 2-input XOR", xor2, "CD4070")

    def timer(p, trig, thr, ctrl, reset, disch, outp, vcc, gnd):
        n2, c1, c2, rn, q, qn = (f"{p}{s}" for s in ("n2", "c1", "c2", "rn", "Q", "QN"))
        return [
            el("R", [vcc, ctrl], 5000), el("R", [ctrl, n2], 5000), el("R", [n2, gnd], 5000),
            {"type": "OA", "nodes": [c1, ctrl, thr], "p": vcc, "n": gnd, "props": {"rout": 100}},
            {"type": "OA", "nodes": [c2, trig, n2], "p": vcc, "n": gnd, "props": {"rout": 100}},
            *inv(reset, rn, vcc, gnd),
            *nor3(c1, rn, qn, q, vcc, gnd, f"{p}q"),
            *nor2(c2, q, qn, vcc, gnd, f"{p}qn"),
            *inv(qn, outp, vcc, gnd),
            {"type": "M", "nodes": [disch, gnd, qn], "props": {"nmos": True, "beta": 0.05, "vth": 1.0}},
        ]

    add("digital2.json", part("lm555", txt("LM555 timer", "LM555 zamanlayıcı"), "ic", "U", box(["GND", "TRIG", "OUT", "RESET"], ["VCC", "DISCH", "THR", "CTRL"], "LM555"), timer("", "TRIG", "THR", "CTRL", "RESET", "DISCH", "OUT", "VCC", "GND"), footprint="DIP8"), None, "Same internals as the NE555: three 5 k resistors, two comparators, SR latch and discharge transistor. DIP-8.")
    add("digital2.json", part("lm556", txt("LM556 dual timer", "LM556 çift zamanlayıcı"), "ic", "U", box(["DISCH1", "THR1", "CTRL1", "RESET1", "OUT1", "TRIG1", "GND"], ["VCC", "DISCH2", "THR2", "CTRL2", "RESET2", "OUT2", "TRIG2"], "LM556"), timer("a", "TRIG1", "THR1", "CTRL1", "RESET1", "DISCH1", "OUT1", "VCC", "GND") + timer("b", "TRIG2", "THR2", "CTRL2", "RESET2", "DISCH2", "OUT2", "VCC", "GND"), footprint="DIP14"), None, "Two independent 555 timers sharing the supply. DIP-14: 1 DISCH1, 2 THR1, 3 CTRL1, 4 RESET1, 5 OUT1, 6 TRIG1, 7 GND, 8 TRIG2 ... 14 VCC.")

    # ---- optocouplers ---------------------------------------------------------------------------------------------
    led_is = float(f"{0.01 / math.exp(1.2 / (1.8 * VT)):.3g}")  # forward drop 1.2 V at 10 mA

    def photo(prefix, a, k, e, b):
        """LED a -> k with a 1 ohm sense resistor; its current drives the base so that Ic = CTR * If."""
        return [diode_el(a, f"{prefix}s", led_is, 1.8), el("R", [f"{prefix}s", k], 1), el("G", [e, b, f"{prefix}s", k], "$ctr/100")]

    for id, label, ctr, note in (
        ("4n25", "4N25 optocoupler (phototransistor, with base pin)", 0.5, "CTR 20 % minimum, about 50 % typical at 10 mA. DIP-6: 1 A, 2 K, 3 NC, 4 E, 5 C, 6 B."),
        ("4n35", "4N35 optocoupler (phototransistor, with base pin)", 1.0, "CTR 100 % minimum at 10 mA. DIP-6: 1 A, 2 K, 3 NC, 4 E, 5 C, 6 B."),
    ):
        elems = photo("", "A", "K", "E", "B") + [{"type": "Q", "nodes": ["C", "E", "B"], "props": {"npn": True, "bf": 100, "is": 1e-14}}, el("R", ["B", "E"], 1e8)]
        add("digital2.json", part(id, txt(label, label), "semi", "U", box(["A", "K"], ["C", "E", "B"], id.upper()), elems, [param("ctr", "Current transfer ratio (1 = 100 %)", "Akım aktarım oranı (1 = %100)", ctr)], footprint="DIP6"), ["A", "K", "-", "B", "C", "E"], note)
    ctr1 = [param("ctr", "Current transfer ratio (1 = 100 %)", "Akım aktarım oranı (1 = %100)", 1.0)]
    elems = photo("", "A", "K", "E", "b") + [{"type": "Q", "nodes": ["C", "E", "b"], "props": {"npn": True, "bf": 100, "is": 1e-14}}, el("R", ["b", "E"], 1e8)]
    add("digital2.json", part("el817", txt("EL817 optocoupler (CTR 50-600 %)", "EL817 optokuplör (CTR %50-600)"), "semi", "U", box(["A", "K"], ["C", "E"], "EL817"), elems, ctr1, footprint="DIP4"), None, "Equivalent of the PC817. DIP-4: 1 A, 2 K, 3 E, 4 C.")
    elems = (
        photo("p", "A", "K", "E", "b")
        + photo("q", "K", "A", "E", "b")
        + [{"type": "Q", "nodes": ["C", "E", "b"], "props": {"npn": True, "bf": 100, "is": 1e-14}}, el("R", ["b", "E"], 1e8)]
    )
    add("digital2.json", part("pc814", txt("PC814 optocoupler (AC input, two antiparallel LEDs)", "PC814 optokuplör (AC giriş, ters paralel iki LED)"), "semi", "U", box(["A", "K"], ["C", "E"], "PC814"), elems, ctr1, footprint="DIP4"), None, "Either polarity of the input lights the transmitter. DIP-4: 1 and 2 input, 3 E, 4 C.")

    def moc(id, label, ift_ma, note):
        # The LED current fires an internal triac; it stays on until the current falls below its 100 uA holding current.
        elems = [
            diode_el("A", "s", led_is, 1.8),
            el("R", ["s", "K"], 1),
            {"type": "VSW", "nodes": ["T2", "g", "s", "K"], "props": {"vth": ift_ma * 1e-3, "vhys": ift_ma * 2e-4, "ron": 100}},
            el("R", ["g", "T1"], 10000),
            {"type": "THY", "nodes": ["T2", "T1", "g"], "props": {"vgt": 0.5, "ih": 1e-4, "ron": 30, "bidir": True}},
        ]
        add("digital2.json", part(id, txt(label, label), "semi", "U", box(["A", "K"], ["T1", "T2"], id.upper()), elems, footprint="DIP6"), ["A", "K", "-", "T2", "-", "T1"], note)

    moc("moc3010", "MOC3010 opto-triac driver (IFT 15 mA)", 15, "Random-phase triac driver, LED trigger current 15 mA, on-state about 3 V at 100 mA. DIP-6: 1 A, 2 K, 4 T2, 6 T1.")
    moc("moc3020", "MOC3020 opto-triac driver (IFT 30 mA)", 30, "Random-phase triac driver, LED trigger current 30 mA. DIP-6: 1 A, 2 K, 4 T2, 6 T1.")
    moc("moc3023", "MOC3023 opto-triac driver (IFT 5 mA)", 5, "Random-phase triac driver, LED trigger current 5 mA. DIP-6: 1 A, 2 K, 4 T2, 6 T1.")

    elems = [
        diode_el("A", "s", led_is, 1.8),
        el("R", ["s", "K"], 1),
        {"type": "VSW", "nodes": ["VO", "x", "s", "K"], "props": {"vth": 5e-3, "vhys": 1e-3, "ron": 40}},
        {"type": "VSW", "nodes": ["x", "GND", "VE", "GND"], "props": {"vth": 1.4, "vhys": 0.2, "ron": 1}},
        el("R", ["VE", "VCC"], 100000),
        el("R", ["VCC", "GND"], 625),
    ]
    add("digital2.json", part("6n137", txt("6N137 high-speed logic optocoupler", "6N137 hızlı lojik optokuplör"), "semi", "U", box(["NC1", "A", "K", "NC4"], ["VCC", "VE", "VO", "GND"], "6N137"), elems, footprint="DIP8"), None, "Open-collector output goes low while the LED current exceeds 5 mA; VE low disables the output (left open it is enabled). Propagation delay is not simulated. DIP-8: 2 A, 3 K, 5 GND, 6 VO, 7 VE, 8 VCC.")

    def gate_driver(id, label, ron_hi, ron_lo, note):
        elems = [
            diode_el("A", "s", led_is, 1.8),
            el("R", ["s", "K"], 1),
            {"type": "VSW", "nodes": ["VCC", "VO1", "s", "K"], "props": {"vth": 5e-3, "vhys": 1e-3, "ron": ron_hi}},
            {"type": "VSW", "nodes": ["VO1", "GND", "s", "K"], "props": {"vth": 5e-3, "vhys": 1e-3, "ron": ron_lo, "inv": True}},
            el("R", ["VO1", "VO2"], 0.001),
            el("R", ["VCC", "GND"], 1700),
        ]
        add("digital2.json", part(id, txt(label, label), "semi", "U", box(["NC1", "A", "K", "NC4"], ["VCC", "VO1", "VO2", "GND"], id.upper()), elems, footprint="DIP8"), None, note)

    gate_driver("tlp250", "TLP250 MOSFET/IGBT gate-drive optocoupler", 5, 2, "Totem-pole output swings to VCC while the LED current is above 5 mA and to GND below it (about 5 ohm high, 2 ohm low). 10-35 V supply. DIP-8: 2 A, 3 K, 5 GND, 6 and 7 VO, 8 VCC.")
    gate_driver("tlp251", "TLP251 MOSFET gate-drive optocoupler", 8, 4, "Totem-pole output: VCC while the LED current is above 5 mA, GND below it (about 8 ohm high, 4 ohm low). DIP-8: 2 A, 3 K, 5 GND, 6 and 7 VO, 8 VCC.")

    # ---- sensor modules ---------------------------------------------------------------------------------------------
    def mq(id, label_en, label_tr, gas_en, gas_tr, title):
        elems = [
            el("R", ["VCC", "AO"], 10000),
            el("R", ["AO", "GND"], "max(10000*$level/(1-min($level,0.99)),1)"),
            el("R", ["VCC", "thr"], "max(20000*(1-$thr),1)"),
            el("R", ["thr", "GND"], "max(20000*$thr,1)"),
            {"type": "OA", "nodes": ["DO", "thr", "AO"], "p": "VCC", "n": "GND", "props": {"headroom": 0.1, "headroomLo": 0.02, "rout": 100}},
            el("R", ["VCC", "GND"], 33),
        ]
        params = [param("level", gas_en, gas_tr, 0.2), param("thr", "DO threshold trimmer (0-1 of Vcc)", "DO eşik trimpotu (Vcc'nin 0-1'i)", 0.5)]
        add("sensors2.json", part(id, txt(label_en, label_tr), "sensor", "U", box(["VCC", "GND", "DO", "AO"], [], title), elems, params, footprint="MOD_SENSOR4"), None, "The heater draws about 150 mA from 5 V (33 ohm). AO = Vcc * RL / (Rs + RL) with RL 10 k; DO goes high when AO passes the trimmer threshold. The level is approximate, not calibrated in ppm.")

    mq("mq3-module", "MQ-3 alcohol sensor module", "MQ-3 alkol sensörü modülü", "Alcohol level (0 clean - 1 heavy)", "Alkol düzeyi (0 temiz - 1 yoğun)", "MQ-3")
    mq("mq4-module", "MQ-4 methane sensor module", "MQ-4 metan sensörü modülü", "Methane level (0 clean - 1 heavy)", "Metan düzeyi (0 temiz - 1 yoğun)", "MQ-4")
    mq("mq5-module", "MQ-5 LPG / natural gas sensor module", "MQ-5 LPG / doğal gaz sensörü modülü", "Gas level (0 clean - 1 heavy)", "Gaz düzeyi (0 temiz - 1 yoğun)", "MQ-5")
    mq("mq7-module", "MQ-7 carbon monoxide sensor module", "MQ-7 karbonmonoksit sensörü modülü", "CO level (0 clean - 1 heavy)", "CO düzeyi (0 temiz - 1 yoğun)", "MQ-7")
    mq("mq9-module", "MQ-9 CO / flammable gas sensor module", "MQ-9 CO / yanıcı gaz sensörü modülü", "Gas level (0 clean - 1 heavy)", "Gaz düzeyi (0 temiz - 1 yoğun)", "MQ-9")
    mq("mq135-module", "MQ-135 air quality sensor module", "MQ-135 hava kalitesi sensörü modülü", "Pollution level (0 clean - 1 heavy)", "Kirlilik düzeyi (0 temiz - 1 yoğun)", "MQ-135")

    def acs712(id, label_en, label_tr, amps, sens):
        # The conductor is 1.2 mohm; its voltage drives a current into the Vcc/2 divider, the output follows that node.
        gm = round(sens / (0.0012 * 5000), 6)
        elems = [
            el("R", ["IP+", "IP-"], 0.0012),
            el("R", ["VCC", "mid"], 10000),
            el("R", ["mid", "GND"], 10000),
            el("G", ["GND", "mid", "IP+", "IP-"], gm),
            {"type": "OA", "nodes": ["OUT", "OUT", "mid"], "p": "VCC", "n": "GND", "props": {"headroom": 0.3, "headroomLo": 0.3, "rout": 1}},
            el("R", ["VCC", "GND"], 500),
        ]
        add("sensors2.json", part(id, txt(label_en, label_tr), "sensor", "U", box(["VCC", "OUT", "GND", "IP+", "IP-"], [], "ACS712"), elems, footprint="MOD_ACS712"), None, f"Output = Vcc / 2 + {sens * 1000:g} mV per ampere through IP+ -> IP-, both directions (+-{amps} A). 10 mA supply current.")

    acs712("acs712-5a", "ACS712-05B current sensor module (+-5 A, 185 mV/A)", "ACS712-05B akım sensörü modülü (+-5 A, 185 mV/A)", 5, 0.185)
    acs712("acs712-20a", "ACS712-20A current sensor module (+-20 A, 100 mV/A)", "ACS712-20A akım sensörü modülü (+-20 A, 100 mV/A)", 20, 0.100)
    acs712("acs712-30a", "ACS712-30A current sensor module (+-30 A, 66 mV/A)", "ACS712-30A akım sensörü modülü (+-30 A, 66 mV/A)", 30, 0.066)

    add("sensors2.json", part("e18-d80nk", txt("E18-D80NK infrared obstacle sensor (NPN output)", "E18-D80NK kızılötesi engel sensörü (NPN çıkış)"), "sensor", "U", box(["VCC", "OUT", "GND"], [], "E18-D80NK"), [el("SW", ["OUT", "GND"], closed="$detected"), el("R", ["VCC", "GND"], 200)], [param("detected", "Object in range (double-click)", "Cisim algılandı (çift tıkla)", False, "bool")], footprint="SIP_3"), None, "Open-collector NPN output pulls to GND while an object is within range (up to 80 cm); add a pull-up. 25 mA supply current.")

    # ---- passives ---------------------------------------------------------------------------------------------------
    for mhz, cm_ff, rm in ((4, 20, 100), (8, 20, 60), (12, 15, 50), (16, 15, 40), (20, 12, 30)):
        f = mhz * 1e6
        cm = cm_ff * 1e-15
        lm = 1.0 / ((2 * math.pi * f) ** 2 * cm)
        elems = [el("R", ["1", "a"], rm), el("L", ["a", "b"], float(f"{lm:.5g}")), el("C", ["b", "2"], cm), el("C", ["1", "2"], 4e-12)]
        add("passives2.json", part(f"xtal-{mhz}mhz", txt(f"Crystal {mhz} MHz (HC-49)", f"Kristal {mhz} MHz (HC-49)"), "passive", "Y", box(["1", "2"], [], f"{mhz} MHz"), elems, footprint="HC49"), None, f"Motional model: Rm {rm} ohm, Lm {lm * 1000:.2f} mH, Cm {cm_ff} fF in series (resonates at {mhz} MHz), 4 pF shunt capacitance.")

    add("passives2.json", part("cap-tantalum", txt("Tantalum capacitor", "Tantal kondansatör"), "passive", "C", glyph("cap-polar"), [el("C", ["+", "i"], "$c", ic="$ic"), el("R", ["i", "-"], "$esr")], [param("c", "Capacitance (F)", "Kapasite (F)", 1e-5), param("v", "Rated voltage (V)", "Anma gerilimi (V)", 16), param("esr", "ESR (Ω)", "ESR (Ω)", 1.5), param("ic", "Initial voltage (V)", "Başlangıç gerilimi (V)", 0)], footprint="CAP_RADIAL_2.54", footprints=["CAP_RADIAL_5.08"]))

    for n in (5, 6, 7, 8, 9, 10):
        names = ["COM"] + [f"R{i}" for i in range(1, n)]
        elems = [el("R", ["COM", f"R{i}"], "$r") for i in range(1, n)]
        add("passives2.json", part(f"rnet-sil-{n}", txt(f"Resistor network SIL-{n} (common pin, {n - 1} resistors)", f"Sıra direnç SIL-{n} (ortak uçlu, {n - 1} direnç)"), "passive", "RN", box(names, [], f"SIL{n}"), elems, [param("r", "Resistance of each (Ω)", "Her direncin değeri (Ω)", 10000)], footprint=f"SIP_{n}"), None, "Pin 1 is the common pin of the bussed network.")

    for n in (2, 3, 4, 7, 8):
        left = [str(k) for k in range(1, n + 1)]
        right = [str(2 * n + 1 - k) for k in range(1, n + 1)]
        elems = [el("SW", [str(k), str(2 * n + 1 - k)], closed=f"$s{k}") for k in range(1, n + 1)]
        params = [param(f"s{k}", f"Switch {k} on", f"Anahtar {k} açık", False, "bool") for k in range(1, n + 1)]
        add("passives2.json", part(f"dip-switch-{n}", txt(f"DIP switch {n} positions", f"DIP anahtar {n} konumlu"), "switch", "SW", box(left, right, f"DIP {n}"), elems, params, footprint=f"DIP{2 * n}"), None, f"Switch k joins pin k to pin {2 * n + 1}-k.")

    # ---- Tunik (Molex KK type) male headers, 2 to 12 poles -----------------------------------------------------------
    def names(n):
        return ["+", "-"] if n == 2 else [str(i) for i in range(1, n + 1)]

    for pitch, tag, fp in ((2.54, "254", "TUNIK254"), (3.96, "396", "TUNIK396"), (2.5, "250", "JSTXH")):
        for n in range(2, 13):
            add("connectors2.json", part(f"tunik-{tag}-{n}", txt(f"Tunik male header {n} poles ({pitch:g} mm)", f"Tunik erkek header {n} kutuplu ({str(pitch).replace('.', ',')} mm)"), "connector", "J", box(names(n), [], f"TUNIK {n}"), footprint=f"{fp}_{n}"), None, "The PCB side of a Tunik (Molex KK type) connector; the female housing with crimped pins plugs onto it.")

    return out
