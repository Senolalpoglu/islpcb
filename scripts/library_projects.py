"""Parts for the project examples: inverter, FM transmitter, AM radio, Bluetooth and sensor boards, an ultrasonic
transducer driver. Imported by gen-library.py (or run on its own: `python scripts/library_projects.py` writes only
library/parts/projects.json).

  * Transformers with centre taps (push-pull inverter, mains transformer with a 12-0-12 secondary). Every winding is a
    Thevenin source (turns x the voltage per turn) behind its own resistance; the "core" is one node that carries the
    voltage per turn, a magnetising inductance to ground, and the reflected current of every winding. So a load on a
    secondary really loads the primary, and power in equals power out.
  * Lamps (incandescent AC and DC, glowing with the power), a neon lamp (holds about 65 V), the 220 V mains supply
    and an inlet with fuse and switch.
  * Ultrasonic transducers as a Butterworth-Van Dyke circuit: the clamped capacitance in parallel with the series
    R-L-C of the mechanical resonance (R is the acoustic load, so the power it takes is the power radiated).
  * Radio parts: variable capacitor, trimmer, varicap, antenna, ferrite rod antenna with a station in it, electret
    microphone, ZN414 / TA7642 radio chip, LM386 audio amplifier.
  * CD4047 (astable mode), TC4427 gate driver.
"""

TWO_PI_SQ = 39.4784176


def build(h):
    txt, part, box, param, el, like = h["txt"], h["part"], h["box"], h["param"], h["el"], h["like"]
    inv, nand2, nor2 = h["inv"], h["nand2"], h["nor2"]
    out = {"projects.json": []}

    def glyph(name):
        return {"kind": "glyph", "glyph": name}

    def add(spec, pad_map=None, visual=None, note=None):
        if pad_map:
            spec["padMap"] = pad_map
        if visual:
            spec["visual"] = visual
        if note:
            spec["note"] = note
        out["projects.json"].append(spec)
        return spec

    # ---- transformers -----------------------------------------------------------------------------------------
    def tapped_model(prim_ct, sec_ct):
        """A transformer with a core node. Turns are counted with one turn per half of the primary (so 2 with a tap)."""
        np_ = 2 if prim_ct else 1
        ns = f"$n*{np_}"
        ws = []
        if prim_ct:
            ws += [("P1", "PC", "1", 0.5, "p"), ("PC", "P2", "1", 0.5, "p")]
        else:
            ws += [("P1", "P2", "1", 1.0, "p")]
        if sec_ct:
            ws += [("S1", "SC", f"{ns}/2", 0.5, "s"), ("SC", "S2", f"{ns}/2", 0.5, "s")]
        else:
            ws += [("S1", "S2", ns, 1.0, "s")]
        e = [el("L", ["core", "0"], f"$lp/{np_ * np_}")]
        for a, b, t, share, which in ws:
            r = f"max($r{which}*{share},0.001)"
            # Norton form of the winding: t x the voltage per turn over R flows into a and back through R across the winding.
            e.append({"type": "G", "nodes": [b, a, "core", "0"], "value": f"({t})/({r})"})
            e.append(el("R", [a, b], r))
            # What the winding does to the core: its conductance as seen in turns, and the reflected current of its terminal voltage.
            e.append(el("R", ["core", "0"], f"({r})/(({t})*({t}))"))
            e.append({"type": "G", "nodes": ["0", "core", a, b], "value": f"({t})/({r})"})
        pins = ["P1", "P2", "S1", "S2"] + (["PC"] if prim_ct else []) + (["SC"] if sec_ct else [])
        for p in pins:
            e.append(el("R", [p, "0"], 1e9))  # a floating winding still has a reference
        return e

    ratio_en, ratio_tr = "Voltage ratio (total secondary / total primary)", "Gerilim oranı (toplam ikincil / toplam birincil)"

    def trafo(id, en, tr, glyph_name, prim_ct, sec_ct, n, lp, rp, rs, body):
        """`n` is the voltage ratio: total secondary over total primary."""
        pins = {"transformer-pct": ["P1", "PC", "P2", "S1", "S2"], "transformer-sct": ["P1", "P2", "S1", "SC", "S2"], "transformer-ct": ["P1", "PC", "P2", "S1", "SC", "S2"]}[glyph_name]
        n_left = sum(1 for p in pins if p.startswith("P"))
        n_right = len(pins) - n_left
        rows = lambda k: [round((i - (k - 1) / 2) * 5.0, 2) for i in range(k)]
        pads = []
        for i, name in enumerate(pins):
            left = i < n_left
            pads.append({"name": name, "x": -10.0 if left else 10.0, "y": rows(n_left)[i] if left else rows(n_right)[i - n_left], "w": 2.4, "h": 1.4, "shape": "rect" if i == 0 else "oval", "drill": 1.1})
        spec = part(
            id, txt(en, tr), "passive", "TR", glyph(glyph_name), tapped_model(prim_ct, sec_ct),
            [param("n", ratio_en, ratio_tr, n), param("lp", "Primary magnetising inductance (H)", "Birincil mıknatıslanma endüktansı (H)", lp), param("rp", "Primary resistance (Ω)", "Birincil direnç (Ω)", rp), param("rs", "Secondary resistance (Ω)", "İkincil direnç (Ω)", rs)],
        )
        fid = f"TRAFO_{id.upper().replace('-', '_')}"
        spec["footprintDef"] = {"id": fid, "label": en, "body": body, "pads": pads}
        spec["footprint"] = fid
        return add(spec, note="The load on the secondary is reflected into the primary (ideal ratio plus winding resistance and magnetising inductance); there is no core saturation.")

    trafo("transformer-pct", "Transformer, centre-tapped primary (push-pull)", "Trafo, orta uçlu birincil (push-pull)", "transformer-pct", True, False, 10, 0.5, 0.05, 4, {"w": 36, "h": 30})
    trafo("transformer-sct", "Transformer, centre-tapped secondary", "Trafo, orta uçlu ikincil", "transformer-sct", False, True, 0.1, 20, 100, 1.5, {"w": 36, "h": 30})
    trafo("transformer-ct", "Transformer, both windings centre-tapped", "Trafo, iki sargısı da orta uçlu", "transformer-ct", True, True, 1, 1, 0.1, 0.1, {"w": 36, "h": 30})
    trafo("trafo-inverter-12v-230v", "Inverter transformer 12-0-12 V / 230 V (100 VA)", "İnverter trafosu 12-0-12 V / 230 V (100 VA)", "transformer-pct", True, False, round(230 / 24, 4), 0.4, 0.04, 4.5, {"w": 60, "h": 50})
    trafo("trafo-220v-2x12v", "Mains transformer 220 V / 12-0-12 V (50 VA)", "Şebeke trafosu 220 V / 12-0-12 V (50 VA)", "transformer-sct", False, True, round(24 / 220, 4), 25, 110, 1.4, {"w": 56, "h": 48})
    trafo("trafo-ultrasonic-1-5", "Ferrite driver transformer 12-0-12 V, 1:5 (ultrasonic)", "Ferrit sürücü trafosu 12-0-12 V, 1:5 (ultrasonik)", "transformer-pct", True, False, 5, 0.002, 0.05, 6, {"w": 32, "h": 28})

    # ---- lamps -------------------------------------------------------------------------------------------------
    lamp_visual = {"kind": "lamp", "pins": [0, 1], "rated": "vrated"}

    def lamp(id, en, tr, v, p):
        add(
            part(id, txt(en, tr), "electromech", "LA", glyph("lamp"), [el("R", ["1", "2"], "$vrated*$vrated/max($prated,0.001)")],
                 [param("vrated", "Rated voltage (V)", "Anma gerilimi (V)", v), param("prated", "Rated power (W)", "Anma gücü (W)", p)], footprint="TB508_2"),
            visual=lamp_visual,
            note="Hot resistance V^2 / P. The glass lights up with the power, (V / rated)^2; on AC the glow is smoothed like a filament.",
        )

    lamp("lamp", "Incandescent lamp (set the rating)", "Akkor lamba (değerleri ayarla)", 12, 5)
    lamp("lamp-12v-dc-5w", "DC lamp 12 V, 5 W", "DC lamba 12 V, 5 W", 12, 5)
    lamp("lamp-12v-dc-21w", "DC lamp 12 V, 21 W (car bulb)", "DC lamba 12 V, 21 W (araç ampulü)", 12, 21)
    lamp("lamp-24v-dc-10w", "DC lamp 24 V, 10 W", "DC lamba 24 V, 10 W", 24, 10)
    lamp("lamp-12v-ac-10w", "AC lamp 12 V, 10 W", "AC lamba 12 V, 10 W", 12, 10)
    lamp("lamp-220v-ac-25w", "AC lamp 220 V, 25 W", "AC lamba 220 V, 25 W", 220, 25)
    lamp("lamp-220v-ac-60w", "AC lamp 220 V, 60 W", "AC lamba 220 V, 60 W", 220, 60)
    lamp("lamp-220v-ac-100w", "AC lamp 220 V, 100 W", "AC lamba 220 V, 100 W", 220, 100)

    # Neon: two zener-like junctions back to back, so it conducts both ways once the voltage passes the holding voltage;
    # the 100 M resistors tie the middle node to the terminals (a floating node there makes the solver's job harder).
    zener = lambda a: {"type": "D", "nodes": [a, "m"], "props": {"bv": "$vsus", "is": 1e-12, "ibv": 1e-4}}
    vsus = param("vsus", "Holding voltage (V)", "Tutunma gerilimi (V)", 60)
    add(
        part("neon-lamp", txt("Neon lamp NE-2 (holds about 60 V, needs a series resistor)", "Neon lamba NE-2 (yaklaşık 60 V tutar, seri direnç ister)"), "electromech", "LA", glyph("neon"),
             [zener("1"), zener("2"), el("R", ["1", "m"], 1e8), el("R", ["2", "m"], 1e8)], [vsus], footprint="TB508_2"),
        visual={"kind": "lamp", "pins": [0, 1], "threshold": 55},
        note="Glows once the voltage across it passes about 60 V and then holds that voltage, so the current has to be limited from outside (100 k to 220 k at mains).",
    )
    add(
        part("neon-indicator-220v", txt("Neon indicator lamp 220 V (with series resistor)", "Neon gösterge lambası 220 V (seri dirençli)"), "electromech", "LA", glyph("neon"),
             [el("R", ["1", "k"], "$rs"), zener("k"), zener("2"), el("R", ["k", "m"], 1e8), el("R", ["2", "m"], 1e8)], [vsus, param("rs", "Series resistor (Ω)", "Seri direnç (Ω)", 220000)], footprint="TB508_2"),
        visual={"kind": "lamp", "pins": [0, 1], "threshold": 85},
        note="The panel-mount neon lamp with its resistor built in: connect it straight across the mains. (Across a switching inverter's output the solver may not converge: use it on the mains.)",
    )

    # ---- 220 V mains -------------------------------------------------------------------------------------------
    add(part("mains-220v", txt("Mains 220 V / 50 Hz", "Şebeke 220 V / 50 Hz"), "source", "V", like("VAC"), [{"type": "V", "nodes": ["+", "-"], "wave": {"kind": "sin", "amp": 311.13, "freq": 50}}], footprint="TERM_5.08"))
    add(
        part(
            "mains-inlet-220v",
            txt("220 V mains inlet with fuse and switch", "220 V şebeke girişi (sigorta ve anahtarlı)"),
            "source", "J", box([], ["L", "N", "PE"], "220 V AC"),
            [
                {"type": "V", "nodes": ["src", "N"], "wave": {"kind": "sin", "amp": "$vrms*1.41421356", "freq": "$freq"}},
                el("R", ["src", "sw"], 0.15),
                el("SW", ["sw", "fz"], closed="$closed", ron=0.01),
                el("R", ["fz", "L"], "$rfuse"),
                el("R", ["N", "0"], 1e8),
                el("R", ["PE", "0"], 1e3),
            ],
            [param("vrms", "Voltage (V rms)", "Gerilim (V rms)", 220), param("freq", "Frequency (Hz)", "Frekans (Hz)", 50), param("rfuse", "Fuse resistance (Ω)", "Sigorta direnci (Ω)", 0.1),
             param("closed", "Switch on (double-click to toggle)", "Anahtar açık (çift tıkla)", True, "bool")],
            footprint="TB508_3",
        ),
        note="Live (L), neutral (N) and protective earth (PE) as on a Schuko plug. PE is tied to the circuit ground through 1 k; neutral is referenced to ground through 100 M, so a mains circuit needs no extra ground symbol. Double-click switches it.",
    )

    # ---- ultrasonic transducers (Butterworth-Van Dyke) --------------------------------------------------------------
    bvd = [el("C", ["+", "-"], "$c0"), el("R", ["+", "a"], "$rm"), el("L", ["a", "b"], f"1/({TWO_PI_SQ}*$fs^2*$cm)"), el("C", ["b", "-"], "$cm")]

    def piezo(id, en, tr, fs, c0, cm, rm, note):
        add(
            part(id, txt(en, tr), "electromech", "BZ", glyph("piezo"), bvd,
                 [param("fs", "Series resonance (Hz)", "Seri rezonans (Hz)", fs), param("c0", "Clamped capacitance C0 (F)", "Kelepçeli kapasite C0 (F)", c0),
                  param("cm", "Motional capacitance Cm (F)", "Hareket kapasitesi Cm (F)", cm), param("rm", "Acoustic load Rm (Ω)", "Akustik yük Rm (Ω)", rm)], footprint="TB508_2"),
            note=note,
        )

    piezo("piezo-transducer", "Piezo ultrasonic transducer (set fs, C0, Cm, Rm)", "Piezo ultrasonik transdüser (fs, C0, Cm, Rm ayarlı)", 40000, 2e-9, 0.25e-9, 500,
          "Butterworth-Van Dyke model: C0 across the terminals, in parallel with Rm, Lm and Cm in series; Lm follows from fs and Cm. The power in Rm is the sound the transducer radiates.")
    piezo("ultrasonic-40k", "Ultrasonic transducer 40 kHz (16 mm, transmitter / receiver)", "Ultrasonik transdüser 40 kHz (16 mm, verici / alıcı)", 40000, 2e-9, 0.25e-9, 500,
          "Typical 16 mm 40 kHz capsule: about 2 nF, series resonance 40 kHz, a few hundred ohms there.")
    piezo("langevin-28k-50w", "Langevin power transducer 28 kHz (50 W, probe in water)", "Langevin güç transdüseri 28 kHz (50 W, probe suda)", 28000, 4.5e-9, 0.45e-9, 300,
          "Bolted Langevin stack, as in ultrasonic probes and cleaners, loaded by water: C0 4.5 nF, resonance 28 kHz. Drive it through an inductor of 1 / (w^2 C0), about 7 mH, to cancel C0.")
    piezo("piezo-1mhz-focus", "Focusing ceramic transducer 1 MHz", "Odaklayıcı seramik transdüser 1 MHz", 1000000, 1.5e-9, 0.08e-9, 40,
          "Bowl-shaped PZT ceramic of the kind used for focused ultrasound, 1 MHz: about 1.5 nF, 40 ohm at resonance.")

    # ---- electret microphone --------------------------------------------------------------------------------------
    add(
        part("mic-electret", txt("Electret microphone capsule (bias through a resistor)", "Elektret mikrofon kapsülü (dirençle beslenir)"), "sensor", "MK", glyph("mic"),
             [{"type": "I", "nodes": ["+", "-"], "wave": {"kind": "sin", "offset": "$ibias*0.001", "amp": "$level*0.000001", "freq": "$freq"}}, el("R", ["+", "-"], 100000)],
             [param("ibias", "Bias current (mA)", "Bias akımı (mA)", 0.5), param("level", "Sound level (µA peak)", "Ses düzeyi (µA tepe)", 20), param("freq", "Tone (Hz)", "Ton (Hz)", 1000)], footprint="SIP_2"),
        note="The capsule's built-in JFET is a current source: feed it from the supply through 2.2 k to 10 k and take the sound from the + pin through a capacitor. The tone is the sound it hears.",
    )

    # ---- variable capacitors, varicap, antenna ----------------------------------------------------------------------
    add(part("cap-variable", txt("Variable capacitor (tuning gang, set the value)", "Ayarlı kondansatör (tuning, değeri ayarla)"), "passive", "CV", glyph("cap-var"), [el("C", ["1", "2"], "$c")], [param("c", "Capacitance (F)", "Kapasite (F)", 100e-12)], footprint="SIP_2"))
    add(part("cap-trimmer", txt("Trimmer capacitor (5-30 pF)", "Trimer kondansatör (5-30 pF)"), "passive", "CV", glyph("cap-trim"), [el("C", ["1", "2"], "$c")], [param("c", "Capacitance (F)", "Kapasite (F)", 15e-12)], footprint="SIP_2"))
    add(
        part("varicap-bb910", txt("Varicap BB910 (capacitance set by a parameter)", "Varikap BB910 (kapasite parametreyle)"), "semi", "D", glyph("varicap"), [el("C", ["A", "K"], "$c"), el("R", ["A", "K"], 1e9)],
             [param("c", "Capacitance at the bias point (F)", "Çalışma noktasındaki kapasite (F)", 20e-12)], footprint="AXIAL_7.62"),
        note="The capacitance is the parameter; its dependence on the reverse voltage is not simulated.",
    )
    add(part("antenna", txt("Antenna (whip)", "Anten (çubuk)"), "passive", "ANT", glyph("antenna"), [el("C", ["ANT", "0"], 3e-12), el("R", ["ANT", "0"], 1e7)], footprint="SIP_1"))

    # ---- ferrite rod antenna with the received station in it -----------------------------------------------------------
    add(
        part(
            "ferrite-antenna",
            txt("Ferrite rod antenna (AM band) with a received station", "Ferrit çubuk anten (AM bandı), alınan istasyonlu"), "passive", "L", glyph("loopstick"),
            [
                {"type": "V", "nodes": ["L1", "e1"], "wave": {"kind": "am", "amp": "$emf*0.001", "freq": "$fc", "mod": "$fm", "depth": "$depth"}},
                el("R", ["e1", "e2"], "$rl"),
                el("L", ["e2", "L2"], "$l"),
                # Link winding C1-C2: the voltage across the coil times the turns ratio, behind 10 ohm, so it takes almost nothing back.
                {"type": "G", "nodes": ["C2", "C1", "e2", "L2"], "value": "$link/10"},
                el("R", ["C1", "C2"], 10),
                *[el("R", [p, "0"], 1e9) for p in ("L1", "L2", "C1", "C2")],
            ],
            [param("l", "Tuned winding L (H)", "Ayarlı sargı L (H)", 240e-6), param("rl", "Winding resistance (Ω)", "Sargı direnci (Ω)", 3),
             param("emf", "Station signal induced (mV peak)", "İndüklenen istasyon sinyali (mV tepe)", 5), param("fc", "Station carrier (Hz)", "İstasyon taşıyıcısı (Hz)", 1e6),
             param("fm", "Audio tone (Hz)", "Ses tonu (Hz)", 1000), param("depth", "Modulation depth (0-1)", "Modülasyon derinliği (0-1)", 0.6),
             param("link", "Coupling winding turns / tuned winding turns", "Bağlantı sargısı sarımı / ayarlı sargı sarımı", 0.1)],
            footprint="SIP_4",
        ),
        pad_map=["L1", "L2", "C1", "C2"],
        note="L1-L2 is the tuned winding with the AM station's induced voltage in series; C1-C2 is a few coupling turns. Tune with a variable capacitor from L1 to L2: f = 1 / (2 pi sqrt(L C)).",
    )

    # ---- ZN414 / TA7642 AM radio chip --------------------------------------------------------------------------------
    # Input amplifier, a diode detector with its filter, and a transistor that makes the supply current follow the audio.
    # The chip is powered through its output pin (a 1 k resistor from 1.5 V), which settles near 1.1 V.
    zn = [
        {"type": "OA", "nodes": ["rf", "fbn", "IN"], "props": {"vmax": 1.0, "rout": 50}},
        el("R", ["rf", "fbn"], "$gain*1000-1000"),
        el("R", ["fbn", "GND"], 1000),
        el("R", ["IN", "GND"], 1e6),
        {"type": "D", "nodes": ["rf", "det"], "props": {"is": 1e-9, "n": 1.1}},
        el("R", ["det", "GND"], 22000),
        el("C", ["det", "GND"], 1e-9),
        el("C", ["det", "ac"], 1e-7),
        el("R", ["ac", "b"], 47000),
        el("R", ["b", "OUT"], 100000),
        {"type": "Q", "nodes": ["OUT", "GND", "b"], "props": {"npn": True, "bf": 100, "is": 1e-14}},
    ]
    add(
        part("zn414", txt("ZN414 / TA7642 AM radio chip (3 pins)", "ZN414 / TA7642 AM radyo entegresi (3 pin)"), "ic", "U", box(["OUT", "GND", "IN"], [], "ZN414"), zn,
             [param("gain", "RF gain (x, 1 to 100)", "RF kazancı (x, 1 ile 100)", 8)], footprint="TO92"),
        pad_map=["OUT", "GND", "IN"],
        note="Power it through a 1 k resistor from 1.5 V into the OUT pin; the audio appears on OUT too (take it through a capacitor). Tune the input with a coil and a variable capacitor.",
    )

    # ---- LM386 audio amplifier ------------------------------------------------------------------------------------------
    # An op-amp with its gain set by 28.5 k of feedback over 1.35 k + 150 ohm: 20 with pins 1 and 8 open, about 190 with a
    # capacitor between them. The output rests at half the supply; the input is AC coupled inside.
    lm386 = [
        el("R", ["VS", "vm"], 10000),
        el("R", ["vm", "GND"], 10000),
        # A buffered half-supply is the rest level of the output; the input is added to it so no coupling capacitor is needed.
        {"type": "OA", "nodes": ["vmb", "vmb", "vm"], "p": "VS", "n": "GND", "props": {"headroom": 0.1, "headroomLo": 0.1, "rout": 1}},
        el("R", ["IN+", "GND"], 50000),
        el("R", ["pp", "vmb"], 1000),
        {"type": "G", "nodes": ["0", "pp", "IN+", "0"], "value": 0.001},
        {"type": "OA", "nodes": ["o", "g1", "pp"], "p": "VS", "n": "GND", "props": {"headroom": 0.9, "headroomLo": 0.15, "rout": 30}},
        el("R", ["o", "g1"], 28500),
        el("R", ["g1", "GAIN8"], 1350),
        el("R", ["GAIN8", "vmb"], 150),
        el("R", ["GAIN1", "g1"], 0.01),
        el("R", ["OUT", "o"], 0.01),
        el("R", ["IN-", "GND"], 50000),
        el("R", ["BYPASS", "vmb"], 15000),
        el("R", ["VS", "GND"], 5000),
    ]
    add(
        part("lm386", txt("LM386 audio power amplifier (0.5 W)", "LM386 ses güç yükselticisi (0,5 W)"), "ic", "U", box(["GAIN1", "IN-", "IN+", "GND"], ["GAIN8", "BYPASS", "VS", "OUT"], "LM386"), lm386, footprint="DIP8"),
        note="Gain 20; a 10 uF capacitor between GAIN1 and GAIN8 makes it about 190. Keep IN- at ground. The output rests at half the supply, so take it through 220 uF to the speaker.",
    )

    # ---- TC4427 dual MOSFET driver ------------------------------------------------------------------------------------------
    def mos(d, s, g, nmos, beta):
        return {"type": "M", "nodes": [d, s, g], "props": {"nmos": nmos, "beta": beta, "vth": 1.5}}

    def driver(vin, y, pre):
        # A comparator with a 1.5 V threshold (the TTL-compatible input) drives a strong CMOS output stage (about 0.2 ohm on).
        m, r = f"{pre}_m", f"{pre}_r"
        return [
            el("V", [r, "GND"], 1.5),
            {"type": "OA", "nodes": [m, vin, r], "p": "VDD", "n": "GND", "props": {"headroom": 0, "headroomLo": 0, "rout": 100}},
            mos(y, "GND", m, True, 0.5),
            mos(y, "VDD", m, False, 0.5),
        ]

    add(
        part("tc4427", txt("TC4427 dual 1.5 A MOSFET gate driver", "TC4427 çift 1,5 A MOSFET kapı sürücü"), "ic", "U", box(["NC1", "INA", "GND", "INB"], ["NC8", "OUTA", "VDD", "OUTB"], "TC4427"),
             driver("INA", "OUTA", "a") + driver("INB", "OUTB", "b") + [el("R", ["INA", "GND"], 1e7), el("R", ["INB", "GND"], 1e7), el("R", ["VDD", "GND"], 40000)], footprint="DIP8"),
        note="Non-inverting; 4.5 to 18 V supply. Wire the MOSFET gates to OUTA and OUTB through about 10 ohm.",
    )

    # ---- CD4047: astable multivibrator and divide-by-two ---------------------------------------------------------------------
    def d_latch(d, e, q, qb, pre):
        nd, s, r = f"{pre}_nd", f"{pre}_s", f"{pre}_r"
        return inv(d, nd, "VDD", "VSS") + nand2(d, e, s, "VDD", "VSS", f"{pre}1") + nand2(nd, e, r, "VDD", "VSS", f"{pre}2") + nand2(s, qb, q, "VDD", "VSS", f"{pre}3") + nand2(r, q, qb, "VDD", "VSS", f"{pre}4")

    def buf(a, y, beta):
        return [mos(f"{y}_x", "VSS", a, True, 0.1), mos(f"{y}_x", "VDD", a, False, 0.1), mos(y, "VSS", f"{y}_x", True, beta), mos(y, "VDD", f"{y}_x", False, beta)]

    cd = [
        # Relaxation oscillator: the Schmitt trigger's output (pin R) charges the capacitor (pin RC) through the outside
        # resistor; thresholds at 1/4 and 3/4 of the supply make the period 2.2 RC, as in the data sheet.
        el("R", ["VDD", "vm"], 100000),
        el("R", ["vm", "VSS"], 100000),
        {"type": "OA", "nodes": ["R", "RC", "ref"], "p": "VDD", "n": "VSS", "props": {"headroom": 0, "headroomLo": 0, "rout": 50}},
        el("R", ["R", "ref"], 100000),
        el("R", ["ref", "vm"], 50000),
        el("R", ["C", "VSS"], 1),
        *inv("R", "clkb", "VDD", "VSS"),
        *inv("clkb", "clk", "VDD", "VSS"),
        *inv("clk", "clkn", "VDD", "VSS"),
        # Toggle flip-flop: each rising edge of the oscillator flips Q, so Q and /Q run at half the oscillator frequency.
        *d_latch("QBi", "clkn", "mq", "mqb", "m"),
        *d_latch("mq", "clk", "Qi", "QBi", "s"),
        el("R", ["Qi", "VSS"], 2e7),
        *buf("Qi", "Q", 0.3),
        *buf("QBi", "/Q", 0.3),
        *buf("clk", "OSC", 0.3),
    ]
    add(
        part("cd4047", txt("CD4047 astable multivibrator (astable mode only)", "CD4047 astable multivibratör (yalnızca astable mod)"), "ic", "U",
             box(["C", "R", "RC", "/ASTABLE", "ASTABLE", "-TRIG", "VSS"], ["VDD", "OSC", "RETRIG", "/Q", "Q", "RESET", "+TRIG"], "CD4047"), cd, footprint="DIP14"),
        note="Astable mode: the outside resistor goes between R and RC, the capacitor between C and RC. Q and /Q are complementary square waves at 1 / (4.4 R C) with 50 % duty; OSC runs at twice that. The trigger, retrigger and reset inputs do nothing in this model.",
    )

    # ---- operating limits: what the part is rated for, checked against the simulation (see src/editor/limits.ts) -------------------
    # Voltages are instantaneous peaks. "polar" names the bound whose violation is a reversed connection.
    rv = lambda a, b, max=None, min=None, polar=None: {k: val for k, val in (("a", a), ("b", b), ("max", max), ("min", min), ("polar", polar)) if val is not None}
    ri = lambda pin, max: {"pin": pin, "max": max}
    ratings = {
        "trafo-inverter-12v-230v": {"v": [rv("P1", "PC", 40, -40), rv("PC", "P2", 40, -40), rv("S1", "S2", 420, -420)], "i": [ri("PC", 12)]},
        "trafo-220v-2x12v": {"v": [rv("P1", "P2", 390, -390), rv("S1", "S2", 45, -45)], "i": [ri("P1", 0.5)]},
        "trafo-ultrasonic-1-5": {"v": [rv("P1", "PC", 40, -40), rv("PC", "P2", 40, -40), rv("S1", "S2", 300, -300)], "i": [ri("PC", 15)]},
        "neon-lamp": {"i": [ri("1", 0.002)], "v": [rv("1", "2", 400, -400)]},
        "neon-indicator-220v": {"v": [rv("1", "2", 420, -420)]},
        "mains-inlet-220v": {"i": [ri("L", 10)]},
        "piezo-transducer": {"v": [rv("+", "-", 100, -100)]},
        "ultrasonic-40k": {"v": [rv("+", "-", 60, -60)]},
        "langevin-28k-50w": {"v": [rv("+", "-", 700, -700)], "i": [ri("+", 2)]},
        "piezo-1mhz-focus": {"v": [rv("+", "-", 100, -100)]},
        "mic-electret": {"v": [rv("+", "-", 10, -1, "min")]},
        "varicap-bb910": {"v": [rv("A", "K", 0.7, -30, "max")]},
        "zn414": {"v": [rv("OUT", "GND", 2.0, -0.5, "min")]},
        "lm386": {"v": [rv("VS", "GND", 15, -0.5, "min")], "i": [ri("OUT", 0.8)]},
        "tc4427": {"v": [rv("VDD", "GND", 18, -0.5, "min")], "i": [ri("OUTA", 1.5), ri("OUTB", 1.5)]},
        "cd4047": {"v": [rv("VDD", "VSS", 18, -0.5, "min")], "i": [ri("Q", 0.02), ri("/Q", 0.02)]},
    }
    for lid, factor in (("lamp", 1.2), ("lamp-12v-dc-5w", 1.2), ("lamp-12v-dc-21w", 1.2), ("lamp-24v-dc-10w", 1.2), ("lamp-12v-ac-10w", 1.62), ("lamp-220v-ac-25w", 1.62), ("lamp-220v-ac-60w", 1.62), ("lamp-220v-ac-100w", 1.62)):
        ratings[lid] = {"v": [rv("1", "2", f"$vrated*{factor}", f"-$vrated*{factor}")]}
    for spec in out["projects.json"]:
        if spec["id"] in ratings:
            spec["ratings"] = ratings[spec["id"]]

    return out


if __name__ == "__main__":
    import importlib.util
    import json
    from pathlib import Path

    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location("gen_library", here / "gen-library.py")
    gl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gl)
    helpers = {"txt": gl.txt, "part": gl.part, "box": gl.box, "like": gl.like, "param": gl.param, "el": gl.el, "inv": gl.inv, "nand2": gl.nand2, "nor2": gl.nor2}
    for name, parts in build(helpers).items():
        (gl.OUT / name).write_text(json.dumps(parts, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{name}: {len(parts)} parts")
