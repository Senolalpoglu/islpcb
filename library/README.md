# Part library

Every part in the palette that is not built into the editor is a small JSON file. The parts in `parts/` ship with
the program; you can add your own with **Import library…** at the top of the part list (a file may hold one part,
a list of parts, or `{ "parts": [...] }`). Imported parts are remembered on your computer and are copied into
every project file that uses them, so a project opens on another machine without the library file.
Right-click an imported part to remove it.

A part is a symbol (what you see and wire) plus a model (what the simulator solves). The `//` notes below are
explanations only; real JSON has no comments.

```json
{
  "id": "rc-lowpass",                    // lowercase letters, digits, - or _
  "label": { "en": "…", "tr": "…" },     // "tr" is optional
  "category": "misc",                    // passive source semi ic logic mcu switch electromech meter power misc
  "prefix": "U",                         // reference designator: U1, U2 …
  "symbol": { "kind": "box", "left": ["IN", "GND"], "right": ["OUT"], "title": "RC LPF" },
  "params": [ { "name": "r", "label": { "en": "Resistance (Ω)" }, "default": 1000 } ],
  "model": { "elements": [ { "type": "R", "nodes": ["IN", "OUT"], "value": "$r" } ] },
  "footprint": "SIP_3",                  // optional PCB footprint id
  "padMap": ["A", "W", "B"]              // optional: the pin each pad of the footprint connects to, in pad order
}
```

* **symbol** – `box` (pin names on the left and right), `like` (reuse a built-in symbol such as `D`, `R`, `NMOS`
  with your own pin names), `glyph` (a drawn symbol with its own pins: `scr`, `triac`, `diac`, `transformer`,
  `pushbutton`, `spdt`, `pot`, `ldr`, `ntc`, `ptc`, `varistor`, `fuse`, `cell`, `zener`, `schottky`, `speaker`,
  `motor`, `ind-core`, `cap-polar` (polarised capacitor, pins `+` and `-`); the pin names default to the usual ones and `"pins"` renames them) or `opamp5` (op-amp
  with supply pins).
* **model** – primitives wired by node name. A node is a pin name, an internal name you invent, or `0` for ground.
  Terminal order: `R C L V I D SW` → `[a, b]`; `Q` → `[collector, emitter, base]`; `M` → `[drain, source, gate]`;
  `OA` → `[out, in-, in+]` plus `p`/`n` supply nodes for a real op-amp; `VSW` and `G` → `[a, b, control+, control-]`.
* **values** – numbers, or expressions in text: `"$r * (1 - $pos)"`, `"4.7k"`, `max($r, 1)`, comparisons that give 1 or 0
  (`$x > 0.5`). `$name` refers to a parameter, which the user edits in the properties panel.
* `props` carries element options: diode `is`, `n`, `bv` (Zener); MOSFET `nmos`, `beta`, `vth`; BJT `npn`, `bf`;
  op-amp `gain`, `headroom`, `headroomLo`, `rout`; switch `ron`, `roff`, `vth`.
* `meter` (`"voltage"` or `"current"`) makes a part show its live reading on the schematic.
* **footprint and padMap** – the footprint id is one of the program's packages (`DIP8`, `TO220`, `TO92`, `SOT223`,
  `SIP_n`, `AXIAL_x`, `MOD_*` for hobby modules, ...). Pads are wired to symbol pins by position unless `padMap`
  lists, pad by pad in the footprint's own order, the pin each one connects to (`"-"` leaves a pad unconnected).
  Use it whenever the physical pin order differs from the symbol, so the PCB matches the real part: a BC547 is
  C-B-E, a 2N3904 is E-B-C, a potentiometer is A-W-B.
* `"footprints": ["CAP_RADIAL_D8_P3.5", ...]` lists other packages the same part can be built in; the PCB panel offers
  them next to `footprint` (the electrolytic capacitor has one per can size: `CAP_RADIAL_D<diameter>_P<lead spacing>`).
  Only packages with a pad for every pin are offered.
* A boolean parameter named `closed` can be flipped by double-clicking the part on the schematic (switches,
  relays modules ...); with a second boolean parameter `momentary` set, the part is closed only while the mouse
  button is held down (push buttons).
* Besides `THY` (thyristor / triac, set `bidir` for a triac) the model primitives are listed in the table above.
* **visual** – something that moves while the circuit runs, shown on the schematic: `{"kind": "fan" | "motor" | "relay" | "turbine" | "valve", "pins": [0, 1], "threshold": 4.5, "rated": "vrated", "speed": "flow"}`.
  Fans and motors turn faster as the voltage between the two `pins` (default the first two) approaches `rated`
  (a number or a parameter name); a relay or valve is drawn pulled in once that voltage reaches `threshold`
  (a number or a parameter name); a turbine (flow sensor) turns with the parameter named by `speed` once powered.
  A `glyph` of `fan` or `motor` carries the blades or the rotor, a `box` symbol gets the picture in its middle.
* Relay, power and module footprints (`RELAY_SRD_C`, `RELAY_SRD_A`, `RELAY_G2RL_2`, `MOD_*`) follow the makers'
  drawings; the relay hole positions are those of the KiCad library footprints of the same relays (CC-BY-SA 4.0).
* Categories now include `sensor`, `module` (wireless, drivers, displays) and `connector` (screw terminal blocks,
  male and female pin headers, JST XH, 2-row headers; footprints `TB508_n`, `TB350_n`, `SIP_n`, `FHDR_n`,
  `JSTXH_n`, `HDR2Xn`). `virtual: true` marks a part that exists only in the simulation (no package, no PCB footprint).
* **Datasheet models** – the parts taken from direnc.net (`scripts/library_direnc.py`) are fitted to their
  datasheets: transistor Is and hFE from Vbe at Ic, MOSFET beta from Rds(on) at the datasheet's test current (with
  body diode), diode curves and zener Vz/Zzt, thyristor VT/IH/VGT, regulator dropout and quiescent current,
  comparators with open-collector outputs, an AD620 built from its real three-op-amp topology, an ACS712 that
  senses current through its 1.2 mohm conductor. `tests/direnc.test.ts` reads those numbers back from the
  simulation. Switching times, reverse recovery, current limiting and temperature are not simulated.
* **Polarity on the board** – a pin named `+` (or ending in `+`), and the anode `A` of a part that also has a `K`,
  is the positive pin: its pad is always square, every other pad of that part is round, and a plus sign is printed
  beside a `+` pad. The cathode end of a diode or LED gets a bar on the silkscreen. Name the pins accordingly
  (`+`/`-` for a 2-pole connector or a battery) and the board follows.

* **Ratings (warnings in the schematic)** – `"ratings"` lists what the part is rated for; while the circuit runs, a part that
  goes beyond it gets a red exclamation mark beside it, with the explanation when the mouse is over it (over voltage, over
  current, overheating, reversed polarity). Voltages and currents are instantaneous peaks, `p` is the average power in watts;
  numbers, or expressions over the parameters (`"$vrated * 1.2"`):

  ```json
  "ratings": {
    "v": [ { "a": "+", "b": "-", "max": "$v", "min": -1, "polar": "min" } ],   // pin a minus pin b; "0" is the circuit ground
    "i": [ { "pin": "A", "max": 0.03 } ],                                       // current into a pin, either direction
    "p": 0.25                                                                    // power turned into heat
  }
  ```

  `polar` says which bound being crossed means the part is connected the wrong way round (an electrolytic capacitor or an LED
  with a negative `+` pin). The parts built into the program (resistor power, capacitor voltage, LED, diode, transistors,
  MOSFETs and every microcontroller pin) have their limits in `src/editor/limits.ts`; the resistor and the capacitor take
  them from their `prated` and `vrated` parameters. `scripts/library_ratings.py` holds the limits of the shipped parts.
* **Lamps** – `"visual": {"kind": "lamp", "pins": [0, 1], "rated": "vrated"}` lights the glass of a `lamp` or `neon` symbol: the
  brightness follows the power, `(V / rated)^2`, smoothed like a filament; with a `threshold` it is a gas lamp that is simply
  on once the voltage across it passes that value.
* **Transformers with taps** – the glyphs `transformer-pct` (centre-tapped primary, pins `P1 PC P2 S1 S2`), `transformer-sct`
  (centre-tapped secondary) and `transformer-ct` (both) draw the symbol; `scripts/library_projects.py` shows a model with
  one node that carries the voltage per turn, so a load on a secondary loads the primary. Other glyphs: `lamp`, `neon`,
  `piezo` (ultrasonic transducer), `mic`, `cap-var`, `cap-trim`, `varicap`, `antenna`, `loopstick`.
* **AM wave** – a source can be an amplitude-modulated carrier: `"wave": {"kind": "am", "amp": ..., "freq": ..., "mod": ...,
  "depth": ...}` (`amp * (1 + depth * sin(2 pi mod t)) * sin(2 pi freq t)`).

Problems in a file are listed when you import it; nothing is added from a part that does not validate.
`examples/rc-filter.json` is a complete working example; `projects.json` holds the parts of the project examples (inverter, FM transmitter, AM radio, Bluetooth, sensor station, ultrasonic driver). The shipped library is generated by
`scripts/gen-library.py`, which is also a good source of examples (gates built from MOSFETs, a 555, regulators).
