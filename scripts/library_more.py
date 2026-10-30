"""The second half of the shipped part library: relays, thyristors, power semiconductors, regulators, switches,
coils and transformers, batteries and more ICs. Imported by gen-library.py, which owns the helper functions.

Packages (footprints) are wired to the symbol by pin name through "padMap": the list gives, for every pad of the
footprint in its own order, the symbol pin that pad connects to. Relay and transformer footprints are generic
(the pin positions of real parts differ between makers): check them against the part you buy.
"""


def build(h):
    txt, part, box, like, param, el = h["txt"], h["part"], h["box"], h["like"], h["param"], h["el"]
    out = {"relays.json": [], "power.json": [], "switches.json": [], "magnetics.json": [], "extra.json": []}

    def glyph(name, pins=None):
        s = {"kind": "glyph", "glyph": name}
        if pins:
            s["pins"] = pins
        return s

    def add(file, spec, pad_map=None):
        if pad_map:
            spec["padMap"] = pad_map
        out[file].append(spec)

    # ---- relays --------------------------------------------------------------------------------------------
    def coil():
        return [el("R", ["COIL+", "m"], "$rcoil"), el("L", ["m", "COIL-"], 0.05)]

    def pull(a, b, inv=False):
        props = {"vth": "$vpull", "vhys": 0.6}
        if inv:
            props["inv"] = True
        return {"type": "VSW", "nodes": [a, b, "COIL+", "COIL-"], "props": props}

    rparams = [param("rcoil", "Coil resistance (Ω)", "Bobin direnci (Ω)", 200), param("vpull", "Pull-in voltage (V)", "Çekme gerilimi (V)", 3.5)]

    add("relays.json", part("relay-spst-no", txt("Relay SPST-NO, generic (single contact)", "Röle SPST-NO, genel (tek kontak)"), "electromech", "K", box(["COIL+", "COIL-"], ["COM", "NO"], "RELAY NO"), coil() + [pull("COM", "NO")], rparams, footprint="RELAY_4"), ["COIL+", "COIL-", "COM", "NO"])
    add("relays.json", part("relay-spst-nc", txt("Relay SPST-NC, generic (single contact)", "Röle SPST-NC, genel (tek kontak)"), "electromech", "K", box(["COIL+", "COIL-"], ["COM", "NC"], "RELAY NC"), coil() + [pull("COM", "NC", True)], rparams, footprint="RELAY_4"), ["COIL+", "COIL-", "COM", "NC"])
    add("relays.json", part("relay-dpdt", txt("Relay DPDT, generic (double contact)", "Röle DPDT, genel (çift kontak)"), "electromech", "K", box(["COIL+", "COIL-", "COM1", "NC1", "NO1"], ["COM2", "NC2", "NO2"], "RELAY 2C"), coil() + [pull("COM1", "NO1"), pull("COM1", "NC1", True), pull("COM2", "NO2"), pull("COM2", "NC2", True)], rparams, footprint="RELAY_8"), ["COIL+", "COIL-", "COM1", "NC1", "NO1", "COM2", "NC2", "NO2"])
    c3l = ["COIL+", "COIL-", "COM1", "NC1", "NO1", "COM2"]
    c3r = ["NC2", "NO2", "COM3", "NC3", "NO3"]
    contacts3 = []
    for k in "123":
        contacts3 += [pull(f"COM{k}", f"NO{k}"), pull(f"COM{k}", f"NC{k}", True)]
    add("relays.json", part("relay-3pdt", txt("Relay 3PDT, generic (triple contact)", "Röle 3PDT, genel (üç kontak)"), "electromech", "K", box(c3l, c3r, "RELAY 3C"), coil() + contacts3, rparams, footprint="RELAY_11"), c3l + c3r)
    ssr_in = [{"type": "D", "nodes": ["IN+", "m"], "props": {"is": 1e-18, "n": 2}}, el("R", ["m", "IN-"], 100)]
    von = [param("von", "Turn-on input voltage (V)", "Açma giriş gerilimi (V)", 3)]
    add("relays.json", part("ssr-dc", txt("Solid-state relay, DC load", "Katı hal rölesi (SSR), DC yük"), "electromech", "K", box(["IN+", "IN-"], ["OUT+", "OUT-"], "SSR DC"), ssr_in + [{"type": "VSW", "nodes": ["OUT+", "OUT-", "IN+", "IN-"], "props": {"vth": "$von", "vhys": 0.4, "ron": 0.05}}], von, footprint="DIP4"))
    add("relays.json", part("ssr-ac", txt("Solid-state relay, AC load (SSR)", "Katı hal rölesi (SSR), AC yük"), "electromech", "K", box(["IN+", "IN-"], ["T1", "T2"], "SSR AC"), ssr_in + [{"type": "VSW", "nodes": ["T1", "T2", "IN+", "IN-"], "props": {"vth": "$von", "vhys": 0.4, "ron": 0.1}}], von, footprint="DIP4"))
    add("relays.json", part("moc3021", txt("MOC3021 opto-triac driver", "MOC3021 opto-triyak sürücü"), "semi", "U", box(["A", "K"], ["T1", "T2"], "MOC3021"), [{"type": "D", "nodes": ["A", "K"], "props": {"is": 1e-18, "n": 2}}, {"type": "VSW", "nodes": ["T2", "T1", "A", "K"], "props": {"vth": 1.1, "vhys": 0.2, "ron": 60}}], footprint="DIP6"), ["A", "K", "-", "T2", "-", "T1"])

    # ---- real power relays (dimensions: Songle SRD datasheet, KiCad library footprints, Omron G2RL) -------------
    def power_relay(id, en, tr, vnom, rcoil, kind, fp, pad_map, note):
        elems = [el("R", ["COIL+", "m"], "$rcoil"), el("L", ["m", "COIL-"], 0.05)]
        sw = {"vth": "($vpull+$vdrop)/2", "vhys": "$vpull-$vdrop"}

        def vsw(a, b, inv=False):
            props = dict(sw)
            if inv:
                props["inv"] = True
            return {"type": "VSW", "nodes": [a, b, "COIL+", "COIL-"], "props": props}

        if kind == "C":
            left, right = ["COIL+", "COIL-"], ["COM", "NC", "NO"]
            elems += [vsw("COM", "NO"), vsw("COM", "NC", True)]
            title = "RELAY SPDT"
        elif kind == "A":
            left, right = ["COIL+", "COIL-"], ["COM", "NO"]
            elems += [vsw("COM", "NO")]
            title = "RELAY SPST"
        else:
            left, right = ["COIL+", "COIL-", "COM1", "NC1", "NO1"], ["COM2", "NC2", "NO2"]
            elems += [vsw("COM1", "NO1"), vsw("COM1", "NC1", True), vsw("COM2", "NO2"), vsw("COM2", "NC2", True)]
            title = "RELAY DPDT"
        params = [param("rcoil", "Coil resistance (Ω)", "Bobin direnci (Ω)", rcoil), param("vpull", "Pull-in voltage (V)", "Çekme gerilimi (V)", round(0.75 * vnom, 2)), param("vdrop", "Drop-out voltage (V)", "Bırakma gerilimi (V)", round(0.1 * vnom, 2))]
        spec = part(id, txt(en, tr), "electromech", "K", box(left, right, title), elems, params, footprint=fp)
        spec["padMap"] = pad_map
        spec["note"] = note
        out["relays.json"].append(spec)

    srd_c = ["COM", "COIL+", "NO", "NC", "COIL-"]
    srd_a = ["COM", "COIL+", "NO", "COIL-"]
    g2rl = ["COIL+", "NO1", "NC1", "COM1", "COM2", "NC2", "NO2", "COIL-"]
    srd_note = "Songle SRD-xxVDC-SL, 10 A 250 VAC. Pins: 1 COM, 2 and 5 coil, 3 NO, 4 NC."
    for v, r in ((5, 70), (12, 400), (24, 1600)):
        power_relay("relay" if v == 5 else f"relay-srd-{v}v-c", f"Relay SPDT {v} V 10 A (SRD-{v:02d}VDC-SL-C)", f"Röle SPDT {v} V 10 A (SRD-{v:02d}VDC-SL-C)", v, r, "C", "RELAY_SRD_C", srd_c, srd_note)
        power_relay(f"relay-srd-{v}v-a", f"Relay SPST-NO {v} V 10 A (SRD-{v:02d}VDC-SL-A)", f"Röle SPST-NO {v} V 10 A (SRD-{v:02d}VDC-SL-A)", v, r, "A", "RELAY_SRD_A", srd_a, srd_note)
    for v, r in ((12, 360), (24, 1440)):
        power_relay(f"relay-g2rl-2-{v}v", f"Relay DPDT {v} V 8 A (Omron G2RL-2)", f"Röle DPDT {v} V 8 A (Omron G2RL-2)", v, r, "2C", "RELAY_G2RL_2", g2rl, "Omron G2RL-2, 8 A 250 VAC. Pins 1 and 8 coil; 4/3/2 are COM/NC/NO of pole 1 and 5/6/7 of pole 2 (check against the datasheet of your maker).")

    # ---- thyristors ----------------------------------------------------------------------------------------
    def scr(id, en, tr, vgt, ih, ron, fp, pad_map):
        add("power.json", part(id, txt(en, tr), "semi", "Q", glyph("scr"), [el("R", ["G", "K"], "$rg"), {"type": "THY", "nodes": ["A", "K", "G"], "props": {"vgt": vgt, "ih": ih, "ron": ron}}], [param("rg", "Gate-cathode resistance (Ω)", "Gate-katot direnci (Ω)", 1000)], footprint=fp), pad_map)

    def triac(id, en, tr, vgt, ih, ron, fp, pad_map):
        add("power.json", part(id, txt(en, tr), "semi", "Q", glyph("triac"), [el("R", ["G", "MT1"], "$rg"), {"type": "THY", "nodes": ["MT2", "MT1", "G"], "props": {"vgt": vgt, "ih": ih, "ron": ron, "bidir": True}}], [param("rg", "Gate resistance (Ω)", "Gate direnci (Ω)", 100)], footprint=fp), pad_map)

    scr("scr-2n5060", "Thyristor SCR 2N5060 (0.8 A)", "Tristör SCR 2N5060 (0,8 A)", 0.8, 5e-3, 0.5, "TO92", ["K", "G", "A"])
    scr("scr-bt151", "Thyristor SCR BT151 (12 A)", "Tristör SCR BT151 (12 A)", 1.0, 20e-3, 0.05, "TO220", ["K", "A", "G"])
    scr("scr-tyn616", "Thyristor SCR TYN616 (16 A)", "Tristör SCR TYN616 (16 A)", 1.0, 40e-3, 0.04, "TO220", ["K", "A", "G"])
    triac("triac-bt136", "Triac BT136 (4 A)", "Triyak BT136 (4 A)", 1.0, 15e-3, 0.15, "TO220", ["MT1", "MT2", "G"])
    triac("triac-bta16", "Triac BTA16-600 (16 A)", "Triyak BTA16-600 (16 A)", 1.0, 30e-3, 0.06, "TO220", ["MT1", "MT2", "G"])
    triac("triac-z0103", "Triac Z0103 (1 A, sensitive gate)", "Triyak Z0103 (1 A, hassas gate)", 0.8, 5e-3, 0.4, "TO92", ["MT1", "G", "MT2"])
    add("power.json", part("diac-db3", txt("Diac DB3 (32 V)", "Diyak DB3 (32 V)"), "semi", "D", glyph("diac"), [{"type": "D", "nodes": ["A1", "m"], "props": {"bv": "$vbo", "is": 1e-12}}, {"type": "D", "nodes": ["A2", "m"], "props": {"bv": "$vbo", "is": 1e-12}}], [param("vbo", "Breakover voltage (V)", "Kırılma gerilimi (V)", 31.3)], footprint="AXIAL_7.62"))

    # ---- bipolar transistors -------------------------------------------------------------------------------
    def bjt(id, en, npn, bf, is_, fp, pad_map):
        add("power.json", part(id, txt(en, en), "semi", "Q", like("QNPN" if npn else "QPNP", ["C", "B", "E"]), [{"type": "Q", "nodes": ["C", "E", "B"], "props": {"npn": npn, "bf": bf, "is": is_}}], footprint=fp), pad_map)

    bjt("2n2222", "2N2222 NPN (0.8 A)", True, 200, 1e-14, "TO92", ["E", "B", "C"])
    bjt("2n3904", "2N3904 NPN (0.2 A)", True, 150, 6.7e-15, "TO92", ["E", "B", "C"])
    bjt("2n3906", "2N3906 PNP (0.2 A)", False, 150, 1.1e-14, "TO92", ["E", "B", "C"])
    bjt("bc547", "BC547 NPN (0.1 A)", True, 300, 7e-15, "TO92", ["C", "B", "E"])
    bjt("bc557", "BC557 PNP (0.1 A)", False, 250, 7e-15, "TO92", ["C", "B", "E"])
    bjt("bc337", "BC337 NPN (0.8 A)", True, 250, 1e-14, "TO92", ["C", "B", "E"])
    bjt("bc327", "BC327 PNP (0.8 A)", False, 250, 1e-14, "TO92", ["C", "B", "E"])
    bjt("bd139", "BD139 NPN power (1.5 A)", True, 100, 5e-13, "TO126", ["E", "C", "B"])
    bjt("bd140", "BD140 PNP power (1.5 A)", False, 100, 5e-13, "TO126", ["E", "C", "B"])
    bjt("tip31c", "TIP31C NPN power (3 A)", True, 40, 1e-12, "TO220", ["B", "C", "E"])
    bjt("tip32c", "TIP32C PNP power (3 A)", False, 40, 1e-12, "TO220", ["B", "C", "E"])
    bjt("2n3055", "2N3055 NPN power (15 A)", True, 50, 5e-12, "TO3", ["B", "E", "C", "-"])
    bjt("mj2955", "MJ2955 PNP power (15 A)", False, 50, 5e-12, "TO3", ["B", "E", "C", "-"])

    def darlington(id, en, npn, fp):
        def q(c, e, b):
            return {"type": "Q", "nodes": [c, e, b], "props": {"npn": npn, "bf": 80, "is": 1e-13}}

        add("power.json", part(id, txt(en, en), "semi", "Q", like("QNPN" if npn else "QPNP", ["C", "B", "E"]), [q("C", "x", "B"), q("C", "E", "x"), el("R", ["x", "E"], 8000)], footprint=fp), ["B", "C", "E"])

    darlington("tip120", "TIP120 NPN Darlington (5 A)", True, "TO220")
    darlington("tip125", "TIP125 PNP Darlington (5 A)", False, "TO220")

    # ---- MOSFETs -------------------------------------------------------------------------------------------
    def mos(id, en, nmos, beta, vth, fp, pad_map):
        add("power.json", part(id, txt(en, en), "semi", "Q", like("NMOS" if nmos else "PMOS", ["D", "G", "S"]), [{"type": "M", "nodes": ["D", "S", "G"], "props": {"nmos": nmos, "beta": beta, "vth": vth}}], footprint=fp), pad_map)

    mos("irf540n", "IRF540N N-MOSFET (33 A, 100 V)", True, 12, 3.5, "TO220", ["G", "D", "S"])
    mos("irf520", "IRF520 N-MOSFET (9 A, 100 V)", True, 4, 3.5, "TO220", ["G", "D", "S"])
    mos("irfz44n", "IRFZ44N N-MOSFET (49 A, 55 V)", True, 20, 3.5, "TO220", ["G", "D", "S"])
    mos("irlz44n", "IRLZ44N logic-level N-MOSFET (47 A)", True, 25, 1.8, "TO220", ["G", "D", "S"])
    mos("irf3205", "IRF3205 N-MOSFET (110 A, 55 V)", True, 40, 3.5, "TO220", ["G", "D", "S"])
    mos("irf9540", "IRF9540 P-MOSFET (19 A, 100 V)", False, 5, 3.5, "TO220", ["G", "D", "S"])
    mos("2n7000", "2N7000 N-MOSFET (0.2 A)", True, 0.1, 2.1, "TO92", ["S", "G", "D"])
    mos("bs170", "BS170 N-MOSFET (0.5 A)", True, 0.15, 2.1, "TO92", ["D", "G", "S"])

    # ---- regulators ----------------------------------------------------------------------------------------
    def fixed(id, en, vout, dropout, fp, pad_map, neg=False, ldo=False):
        divider = [el("R", ["OUT", "fb"], 10000), el("R", ["fb", "GND"], 10000)]
        if neg:
            elems = [el("V", ["ref", "GND"], -vout / 2)] + divider + [{"type": "OA", "nodes": ["drv", "fb", "ref"], "p": "GND", "n": "IN", "props": {"headroom": max(dropout - 0.7, 0), "headroomLo": 0, "rout": 20}}, {"type": "Q", "nodes": ["IN", "OUT", "drv"], "props": {"npn": False, "bf": 50, "is": 1e-14}}]
            sym = box(["GND", "IN"], ["OUT"], id.upper())
        elif ldo:
            elems = [el("V", ["ref", "GND"], vout / 2)] + divider + [{"type": "OA", "nodes": ["drv", "ref", "fb"], "p": "IN", "n": "GND", "props": {"headroom": 0, "headroomLo": 0, "rout": 20}}, {"type": "Q", "nodes": ["OUT", "IN", "drv"], "props": {"npn": False, "bf": 30, "is": 1e-14}}]
            sym = box(["IN", "GND"], ["OUT"], id.upper())
        else:
            elems = [el("V", ["ref", "GND"], vout / 2)] + divider + [{"type": "OA", "nodes": ["drv", "fb", "ref"], "p": "IN", "n": "GND", "props": {"headroom": max(dropout - 0.7, 0), "headroomLo": 0, "rout": 20}}, {"type": "Q", "nodes": ["IN", "OUT", "drv"], "props": {"npn": True, "bf": 50, "is": 1e-14}}]
            sym = box(["IN", "GND"], ["OUT"], id.upper())
        add("power.json", part(id, txt(en, en), "power", "U", sym, elems, footprint=fp), pad_map)

    fixed("lm7805", "LM7805 regulator +5 V (1 A)", 5, 2.0, "TO220", ["IN", "GND", "OUT"])
    fixed("lm7809", "LM7809 regulator +9 V (1 A)", 9, 2.0, "TO220", ["IN", "GND", "OUT"])
    fixed("lm7812", "LM7812 regulator +12 V (1 A)", 12, 2.0, "TO220", ["IN", "GND", "OUT"])
    fixed("lm7815", "LM7815 regulator +15 V (1 A)", 15, 2.0, "TO220", ["IN", "GND", "OUT"])
    fixed("lm78l05", "78L05 regulator +5 V (0.1 A)", 5, 1.7, "TO92", ["OUT", "GND", "IN"])
    fixed("lm7905", "LM7905 regulator -5 V (1 A)", 5, 2.0, "TO220", ["GND", "IN", "OUT"], neg=True)
    fixed("lm7912", "LM7912 regulator -12 V (1 A)", 12, 2.0, "TO220", ["GND", "IN", "OUT"], neg=True)
    fixed("lm1117-3v3", "LM1117-3.3 LDO regulator (0.8 A)", 3.3, 1.2, "SOT223", ["GND", "OUT", "IN", "OUT"])
    fixed("lm1117-5v", "LM1117-5.0 LDO regulator (0.8 A)", 5, 1.2, "SOT223", ["GND", "OUT", "IN", "OUT"])
    fixed("ams1117-3v3", "AMS1117-3.3 LDO regulator (1 A)", 3.3, 1.2, "SOT223", ["GND", "OUT", "IN", "OUT"])
    fixed("lm2940-5", "LM2940-5.0 low-dropout regulator (1 A)", 5, 0.5, "TO220", ["IN", "GND", "OUT"], ldo=True)
    fixed("mcp1700-3v3", "MCP1700-3.3 low-dropout regulator (0.25 A)", 3.3, 0.2, "TO92", ["GND", "IN", "OUT"], ldo=True)
    add("power.json", part("lm317", txt("LM317 adjustable regulator (1.5 A)", "LM317 ayarlı regülatör (1,5 A)"), "power", "U", box(["ADJ", "IN"], ["OUT"], "LM317"), [el("V", ["ref", "ADJ"], 1.25), {"type": "OA", "nodes": ["drv", "OUT", "ref"], "p": "IN", "n": "ADJ", "props": {"headroom": 1.3, "headroomLo": 0, "rout": 20}}, {"type": "Q", "nodes": ["IN", "OUT", "drv"], "props": {"npn": True, "bf": 50, "is": 1e-14}}], footprint="TO220"), ["ADJ", "OUT", "IN"])

    # ---- switches ------------------------------------------------------------------------------------------
    def closed_param(en, tr):
        return param("closed", en, tr, False, "bool")

    momentary = param("momentary", "Momentary (hold the mouse button)", "Anlık (fare tuşunu basılı tut)", True, "bool")
    add("switches.json", part("toggle-spst", txt("Toggle switch SPST", "Toggle anahtar SPST"), "switch", "S", like("SW"), [el("SW", ["1", "2"], closed="$closed")], [closed_param("Closed (double-click to toggle)", "Kapalı (çift tıkla)")], footprint="HDR_1X2"))
    add("switches.json", part("pushbutton", txt("Push button (normally open)", "Buton (normalde açık)"), "switch", "S", glyph("pushbutton"), [el("SW", ["1", "2"], closed="$closed")], [closed_param("Pressed", "Basılı"), momentary], footprint="PUSH_6MM"), ["1", "-", "2", "-"])
    add("switches.json", part("pushbutton-nc", txt("Push button (normally closed)", "Buton (normalde kapalı)"), "switch", "S", glyph("pushbutton"), [el("SW", ["1", "2"], closed="$closed<0.5")], [closed_param("Pressed", "Basılı"), momentary], footprint="PUSH_6MM"), ["1", "-", "2", "-"])
    add("switches.json", part("spdt", txt("SPDT switch (changeover)", "SPDT anahtar (değiştirmeli)"), "switch", "S", glyph("spdt"), [el("SW", ["COM", "NO"], closed="$closed"), el("SW", ["COM", "NC"], closed="$closed<0.5")], [closed_param("Thrown to NO (double-click to toggle)", "NO konumunda (çift tıkla)")], footprint="SIP_3"), ["NO", "COM", "NC"])
    add("switches.json", part("dpdt", txt("DPDT switch (double changeover)", "DPDT anahtar (çift değiştirmeli)"), "switch", "S", box(["COM1", "NO1", "NC1"], ["COM2", "NO2", "NC2"], "DPDT"), [el("SW", ["COM1", "NO1"], closed="$closed"), el("SW", ["COM1", "NC1"], closed="$closed<0.5"), el("SW", ["COM2", "NO2"], closed="$closed"), el("SW", ["COM2", "NC2"], closed="$closed<0.5")], [closed_param("Thrown to NO (double-click to toggle)", "NO konumunda (çift tıkla)")], footprint="DIP6"))
    add("switches.json", part("reed-switch", txt("Reed switch", "Reed anahtar"), "switch", "S", like("SW"), [el("SW", ["1", "2"], closed="$closed")], [closed_param("Magnet present (double-click)", "Mıknatıs var (çift tıkla)")], footprint="AXIAL_12.7"))

    # ---- coils, transformers, thermistors, protection ------------------------------------------------------
    add("magnetics.json", part("coil", txt("Coil with winding resistance", "Bobin (sargı dirençli)"), "passive", "L", like("L", ["1", "2"]), [el("L", ["1", "m"], "$l"), el("R", ["m", "2"], "$rdc")], [param("l", "Inductance (H)", "Endüktans (H)", 0.01), param("rdc", "Winding resistance (Ω)", "Sargı direnci (Ω)", 2)], footprint="AXIAL_10.16"))
    add("magnetics.json", part("choke", txt("Choke with iron core", "Çekirdekli şok bobini"), "passive", "L", glyph("ind-core"), [el("L", ["1", "m"], "$l"), el("R", ["m", "2"], "$rdc")], [param("l", "Inductance (H)", "Endüktans (H)", 0.1), param("rdc", "Winding resistance (Ω)", "Sargı direnci (Ω)", 5)], footprint="AXIAL_12.7"))
    add("magnetics.json", part("transformer", txt("Transformer (ratio model)", "Trafo (oran modeli)"), "passive", "TR", glyph("transformer"), [el("R", ["P1", "m"], "$rp"), el("L", ["m", "P2"], "$lp"), {"type": "G", "nodes": ["S2", "S1", "P1", "P2"], "value": "$n/$rs"}, el("R", ["S1", "S2"], "$rs")], [param("n", "Turns ratio (secondary / primary)", "Sarım oranı (ikincil / birincil)", 0.1), param("lp", "Primary inductance (H)", "Birincil endüktans (H)", 5), param("rp", "Primary resistance (Ω)", "Birincil direnç (Ω)", 1), param("rs", "Secondary resistance (Ω)", "İkincil direnç (Ω)", 1)], footprint="TRAFO_4"), ["P1", "P2", "S1", "S2"])
    add("magnetics.json", part("ptc", txt("PTC thermistor", "PTC termistör"), "passive", "RT", glyph("ptc"), [el("R", ["1", "2"], "$r")], [param("r", "Resistance at the temperature (Ω)", "Sıcaklıktaki direnç (Ω)", 50)], footprint="AXIAL_7.62"))
    add("magnetics.json", part("varistor", txt("Varistor (MOV)", "Varistör (MOV)"), "passive", "RV", glyph("varistor"), [{"type": "D", "nodes": ["1", "m"], "props": {"bv": "$vclamp", "is": 1e-12}}, {"type": "D", "nodes": ["2", "m"], "props": {"bv": "$vclamp", "is": 1e-12}}], [param("vclamp", "Clamping voltage (V)", "Kıskaç gerilimi (V)", 275)], footprint="HDR_1X2"))
    add("magnetics.json", part("fuse", txt("Fuse", "Sigorta"), "passive", "F", glyph("fuse"), [el("R", ["1", "2"], "$r")], [param("r", "Resistance (Ω)", "Direnç (Ω)", 0.05)], footprint="AXIAL_22.5"))
    add("magnetics.json", part("trimpot", txt("Trimmer potentiometer", "Trimpot"), "passive", "RV", glyph("pot"), [el("R", ["A", "W"], "max($r*$pos,0.01)"), el("R", ["W", "B"], "max($r*(1-$pos),0.01)")], [param("r", "Total resistance (Ω)", "Toplam direnç (Ω)", 10000), param("pos", "Wiper position (0-1)", "Kayar konumu (0-1)", 0.5)], footprint="SIP_3"), ["A", "W", "B"])

    # ---- diodes and LEDs -----------------------------------------------------------------------------------
    def diode(id, en, tr, is_, n, fp="AXIAL_10.16", extra=None, glyph_name=None):
        props = {"is": is_, "n": n}
        props.update(extra or {})
        add("extra.json", part(id, txt(en, tr), "semi", "D", glyph(glyph_name) if glyph_name else like("D", ["A", "K"]), [{"type": "D", "nodes": ["A", "K"], "props": props}], footprint=fp))

    diode("1n4148", "1N4148 signal diode", "1N4148 sinyal diyodu", 2.5e-9, 1.75, "AXIAL_7.62")
    diode("1n4007", "1N4007 rectifier diode (1 A, 1000 V)", "1N4007 doğrultucu diyot (1 A, 1000 V)", 7e-9, 1.8)
    diode("1n5819", "1N5819 Schottky diode (1 A)", "1N5819 Schottky diyot (1 A)", 3e-6, 1.0, glyph_name="schottky")
    for id, en, tr, is_, n in [("led-orange", "LED orange", "LED turuncu", 5e-20, 2), ("led-ir", "IR LED (940 nm)", "IR LED (940 nm)", 1e-16, 1.8)]:
        add("extra.json", part(id, txt(en, tr), "semi", "D", like("LED"), [{"type": "D", "nodes": ["A", "K"], "props": {"is": is_, "n": n}}], footprint="LED_5MM"))

    # ---- batteries and sources -----------------------------------------------------------------------------
    def cell(id, en, tr, v, r):
        add("extra.json", part(id, txt(en, tr), "source", "BT", glyph("cell"), [el("V", ["+", "m"], "$v"), el("R", ["m", "-"], "$rint")], [param("v", "Voltage (V)", "Gerilim (V)", v), param("rint", "Internal resistance (Ω)", "İç direnç (Ω)", r)], footprint="TERM_5.08"))

    cell("cell-aa", "AA cell 1.5 V", "AA pil 1,5 V", 1.5, 0.2)
    cell("cell-9v", "9 V battery", "9 V pil", 9, 1.7)
    cell("cell-cr2032", "CR2032 coin cell 3 V", "CR2032 düğme pil 3 V", 3, 15)
    cell("cell-lipo", "Li-Po cell 3.7 V", "Li-Po pil 3,7 V", 3.7, 0.15)
    cell("cell-lead-acid", "Lead-acid battery 12 V", "Akü 12 V", 12, 0.03)
    for id, en, tr, amp, f in [("mains-230v", "Mains 230 V / 50 Hz", "Şebeke 230 V / 50 Hz", 325.3, 50), ("mains-110v", "Mains 110 V / 60 Hz", "Şebeke 110 V / 60 Hz", 155.6, 60)]:
        add("extra.json", part(id, txt(en, tr), "source", "V", like("VAC"), [{"type": "V", "nodes": ["+", "-"], "wave": {"kind": "sin", "amp": amp, "freq": f}}], footprint="TERM_5.08"))

    # ---- more ICs ------------------------------------------------------------------------------------------
    def dual_opamp(id, en, tr, headroom):
        elems = [{"type": "OA", "nodes": [f"OUT{k}", f"IN{k}-", f"IN{k}+"], "p": "V+", "n": "V-", "props": {"headroom": headroom, "headroomLo": headroom, "rout": 80}} for k in (1, 2)]
        add("extra.json", part(id, txt(en, tr), "ic", "U", box(["OUT1", "IN1-", "IN1+", "V-"], ["V+", "OUT2", "IN2-", "IN2+"], id.upper()), elems, footprint="DIP8"))

    dual_opamp("tl072", "TL072 dual JFET op-amp", "TL072 çift JFET op-amp", 1.5)
    dual_opamp("ne5532", "NE5532 dual audio op-amp", "NE5532 çift ses op-amp", 1.5)
    quad = [{"type": "OA", "nodes": [f"{k}OUT", f"{k}IN-", f"{k}IN+"], "p": "VCC", "n": "GND", "props": {"headroom": 1.5, "headroomLo": 0.02, "rout": 100}} for k in (1, 2, 3, 4)]
    add("extra.json", part("lm324", txt("LM324 quad op-amp", "LM324 dörtlü op-amp"), "ic", "U", box(["1OUT", "1IN-", "1IN+", "VCC", "2IN+", "2IN-", "2OUT"], ["4OUT", "4IN-", "4IN+", "GND", "3IN+", "3IN-", "3OUT"], "LM324"), quad, footprint="DIP14"))
    chans = [str(k) for k in range(1, 8)]
    uln = []
    for k in chans:
        uln += [
            el("R", [f"{k}B", f"b{k}"], 2700),
            {"type": "Q", "nodes": [f"{k}C", f"x{k}", f"b{k}"], "props": {"npn": True, "bf": 100, "is": 1e-13}},
            {"type": "Q", "nodes": [f"{k}C", "GND", f"x{k}"], "props": {"npn": True, "bf": 40, "is": 1e-13}},
            el("R", [f"x{k}", "GND"], 8000),
            {"type": "D", "nodes": [f"{k}C", "COM"], "props": {"is": 1e-12, "n": 1.5}},
        ]
    add("extra.json", part("uln2003", txt("ULN2003 Darlington array (7 x 0.5 A)", "ULN2003 Darlington dizisi (7 x 0,5 A)"), "ic", "U", box([f"{k}B" for k in chans] + ["GND"], [f"{k}C" for k in chans] + ["COM"], "ULN2003"), uln, footprint="DIP16"))

    for spec in out["relays.json"]:
        if spec["id"].startswith("relay"):
            spec["visual"] = {"kind": "relay", "threshold": "vpull"}
        elif spec["id"].startswith("ssr"):
            spec["visual"] = {"kind": "relay", "threshold": "von"}
    return out
