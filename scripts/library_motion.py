"""Parts whose moving parts show during a simulation: fans, motors, pumps, solenoid valves and flow sensors.
Imported by gen-library.py. Each part carries a "visual" entry that tells the schematic what to animate:

  fan / motor  turns, faster as the voltage across it rises towards its rated voltage (param vrated)
  valve        opens when the voltage across the coil reaches the opening voltage (param vopen)
  turbine      a flow sensor's rotor spins with the flow (param flow, litres per minute) once it is powered

The electrical models are simple and honest: a fan or motor is its winding resistance (rated voltage over rated
current) and inductance, so current follows the voltage; a flow sensor puts out a pulse train at the frequency
the maker gives (YF-S201: 7.5 Hz per litre per minute).
"""


def build(h):
    txt, part, box, param, el = h["txt"], h["part"], h["box"], h["param"], h["el"]
    out = {"motion.json": []}

    def glyph(name):
        return {"kind": "glyph", "glyph": name}

    def add(spec, visual):
        spec["visual"] = visual
        out["motion.json"].append(spec)

    # ---- motors and pumps -----------------------------------------------------------------------------------
    add(
        part("dc-motor", txt("DC motor", "DC motor"), "electromech", "M", glyph("motor"), [el("R", ["A", "m"], "$r"), el("L", ["m", "B"], "$l")], [param("r", "Winding resistance (Ω)", "Sargı direnci (Ω)", 8), param("l", "Inductance (H)", "Endüktans (H)", 0.005), param("vrated", "Rated voltage (V, for the animation)", "Anma gerilimi (V, animasyon için)", 12)], footprint="HDR_1X2"),
        {"kind": "motor", "rated": "vrated"},
    )
    add(
        part("pump-12v", txt("Mini water pump 12 V (0.5 A)", "Mini su pompası 12 V (0,5 A)"), "electromech", "M", glyph("motor"), [el("R", ["A", "m"], "$vrated/$irated"), el("L", ["m", "B"], 0.003)], [param("vrated", "Rated voltage (V)", "Anma gerilimi (V)", 12), param("irated", "Rated current (A)", "Anma akımı (A)", 0.5)], footprint="HDR_1X2"),
        {"kind": "motor", "rated": "vrated"},
    )

    # ---- fans: a winding, drawn as turning blades ------------------------------------------------------------
    def fan(id, en, tr, v, i):
        add(
            part(id, txt(en, tr), "electromech", "FAN", glyph("fan"), [el("R", ["+", "m"], "$vrated/$irated"), el("L", ["m", "-"], 0.002)], [param("vrated", "Rated voltage (V)", "Anma gerilimi (V)", v), param("irated", "Rated current (A)", "Anma akımı (A)", i)], footprint="HDR_1X2"),
            {"kind": "fan", "rated": "vrated"},
        )

    fan("fan-5v-50mm", "DC fan 5 V, 50 mm blower (0.2 A)", "DC fan 5 V, 50 mm blower (0,2 A)", 5, 0.2)
    fan("fan-12v-80mm", "DC fan 12 V, 80 mm (0.15 A)", "DC fan 12 V, 80 mm (0,15 A)", 12, 0.15)
    fan("fan-12v-120mm", "DC fan 12 V, 120 mm (0.25 A)", "DC fan 12 V, 120 mm (0,25 A)", 12, 0.25)
    fan("fan-24v-80mm", "DC fan 24 V, 80 mm (0.15 A)", "DC fan 24 V, 80 mm (0,15 A)", 24, 0.15)

    # ---- solenoid valves: a coil that opens the valve -----------------------------------------------------------
    def valve(id, en, tr, v, watts):
        coil = round(v * v / watts, 1)
        add(
            part(id, txt(en, tr), "electromech", "YV", box(["+"], ["-"], "VALVE"), [el("R", ["+", "m"], "$rcoil"), el("L", ["m", "-"], 0.08)], [param("rcoil", "Coil resistance (Ω)", "Bobin direnci (Ω)", coil), param("vopen", "Opening voltage (V)", "Açma gerilimi (V)", round(0.6 * v, 1))], footprint="HDR_1X2"),
            {"kind": "valve", "threshold": "vopen"},
        )

    valve("valve-12v", "Solenoid valve 12 V (6 W)", "Selenoid valf 12 V (6 W)", 12, 6)
    valve("valve-24v", "Solenoid valve 24 V (6 W)", "Selenoid valf 24 V (6 W)", 24, 6)

    # ---- flow sensors: a turbine and a Hall sensor that pulses ------------------------------------------------
    def flow(id, en, tr, k, flow_default):
        elems = [
            {"type": "V", "nodes": ["c", "GND"], "wave": {"kind": "pulse", "low": 0, "high": "$flow>0", "freq": "max($flow*$k,0.001)", "duty": 0.5}},
            {"type": "VSW", "nodes": ["VCC", "SIG", "c", "GND"], "props": {"vth": 0.5, "vhys": 0.2, "ron": 60}},
            {"type": "VSW", "nodes": ["SIG", "GND", "c", "GND"], "props": {"vth": 0.5, "vhys": 0.2, "ron": 60, "inv": True}},
            el("R", ["VCC", "GND"], 500),
        ]
        spec = part(id, txt(en, tr), "sensor", "FS", box(["VCC", "GND"], ["SIG"], "FLOW"), elems, [param("flow", "Flow (litres per minute)", "Debi (litre / dakika)", flow_default), param("k", "Pulses per second per L/min", "Darbe / saniye başına L/dk", k)], footprint="SIP_3")
        add(spec, {"kind": "turbine", "speed": "flow", "threshold": 3})

    flow("flow-yfs201", "Water flow sensor YF-S201 (1-30 L/min)", "Su debi sensörü YF-S201 (1-30 L/dk)", 7.5, 5)
    flow("flow-fs300a", "Water flow sensor FS300A (1-60 L/min)", "Su debi sensörü FS300A (1-60 L/dk)", 5.5, 10)

    return out
