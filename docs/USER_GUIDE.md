# ISL PCB user guide

This guide walks through the application from the first circuit to a finished board. The interface is available in
English and Turkish (the **TR** / **EN** buttons at the top right); every name below is the English one.

## 1. The window

| Area | What it holds |
| --- | --- |
| Top toolbar | files (New, Open, Save), examples, undo / redo, tools, simulation controls, view options, theme and language |
| Left | the **part library**: search box, categories, *Import library...* |
| Centre | the **schematic sheet**; below it the **Oscilloscope**, **Timing** and **Serial monitor** tabs |
| Right | **Properties** of the selected part (values, labels, program for microcontrollers) |
| Status bar | the run state, the simulated time, and hints for the tool in use |

The top bar also switches between the three views: **Schematic**, **PCB** and **3D**.

The left and right columns can be made wider by dragging their edges (double-click an edge to reset it). This helps most
when you are editing a microcontroller program in the Properties column.

## 2. Drawing a circuit

1. **Place parts.** Click a part in the library (or drag it) and click the sheet. Families such as *Diodes* or *Timers*
   open a list of the parts they contain. Right click or `Esc` stops placing.
2. **Move and turn.** Drag a part to move it; the wires attached to it follow. `R` or `Space` rotates the selected
   part, `M` mirrors it.
3. **Wire.** Choose **Wire** (or press `W`) and click on a pin, then on the next pin. Wires are horizontal and vertical;
   click on empty grid points to make a corner. A wire ends when it reaches a pin or another wire. Wires that merely
   cross are *not* connected; a dot marks a junction of three or more.
4. **Ground.** A circuit needs at least one **GND** symbol; without it the simulator reports that no ground was found.
5. **Edit values.** Select a part and change its parameters in the Properties column. Numbers accept SI prefixes
   (`4.7k`, `100n`, `2.2u`).
6. **Select blocks.** Drag a box on empty space. From left to right it takes what lies completely inside, from right to
   left everything it touches. A selected block moves and deletes as one.
7. **Texts.** The reference and value labels next to a part can be dragged to a better place.

## 3. Running a simulation

| Button | What it does |
| --- | --- |
| **Run** / **Stop** | start or pause the transient simulation |
| **Reset** | go back to time zero |
| **DC operating point** | solve the steady state once, without running |
| **Time step**, **Steps / frame** | the accuracy and the speed of the run |

Use a smaller time step for fast circuits (a radio frequency oscillator needs nanoseconds) and a larger one for slow
ones. The examples choose sensible values for themselves.

Edits while the simulation runs are applied live: flipping a switch does not restart it; changing the structure of the
circuit does.

### Reading the circuit while it runs

The **Flow** group in the toolbar controls how the sheet shows the state of the circuit:

- **Flow** turns the live view on or off.
- **Electrons** draws the dashes in the direction the electrons move instead of the conventional current.
- **Click** makes a single click flip a switch (otherwise double-click). Push buttons always close while the mouse button
  is held down.
- **Voltage colours** colours each wire by its own voltage (blue at ground up to red at the highest voltage) instead
  of the simple red = live, blue = 0 V.

Hover a wire to see its voltage and current. A part that goes beyond its ratings gets a red exclamation mark; hover it for
the explanation.

**Select a part while the circuit runs** and a card tells you whether it is on or off and why: the voltage across it, the
current through it, the open switches that keep a branch dead, or a reversed LED.

### Oscilloscope and timing

- Place a **probe** on a net and wire it; its voltage is drawn in the **Oscilloscope** tab.
- The **Timing** tab records the ON / OFF state of switches, LEDs, lamps, relays and motors over the simulated time,
  one row each, so you can see the order in which things happen.

## 4. Microcontrollers

Place an **Arduino Uno**, **Nano**, **Mega**, a **Raspberry Pi Pico** or a **PIC16** chip from the microcontroller boards
in the library. Select it to open its **Program** panel in the Properties column.

1. Pick a ready-made program from the list, or type your own code in the text box (drag the lower edge of the box to make it
   taller, drag the column edge to make it wider).
2. **Compile** builds Arduino and Pico code with `arduino-cli` (see the README for installing it); PIC assembly is
   assembled inside the app. Or choose **Load hex** to use a file you built elsewhere.
3. Wire the pins to LEDs (with a resistor), buttons, sensors and modules. Press **Run**.

While it runs, the board's pins drive the circuit (including PWM) and read voltages back, so a button with a pull-up works
and an LED on a pin lights.

### Serial monitor

The **Serial monitor** tab shows what the board prints on `Serial`. Type text and press Enter to send it to the first board.
In the desktop app you can bridge the monitor to a **real COM port**, for example a USB-serial adapter.

### Two boards and Bluetooth

HC-05, HC-06 and HC-12 have a **link** property. Give two modules the same link name and wire each module the way the real one is
wired (the board's TX through a divider to the module's RXD, the module's TXD to the board's RX): everything one board
prints on its serial port is delivered to the other, in both directions. A module without power does not pass anything.
Only the hardware serial port (D0 / D1) is paired. With more than one board the serial monitor writes each board's lines
whole and puts the board's reference in front of them (`[A1] #CAR F v=7`); text you type goes to the first board.

Try the examples **Two Arduino Nanos: remote control and car talk over Bluetooth** (type `F`, `B`, `L`, `R`, `S` or a speed digit
`0`-`9` in the serial monitor: the remote passes it on, the car drives its four motors and answers), **Arduino Nano: 4-motor
Bluetooth car** and **Arduino Nano: Bluetooth remote control** (the same two, drawn separately), and **digital clock
HH:MM:SS on six 7-segment digits** (type `T123456` in the serial monitor to set the time).

## 5. PCB design

1. Switch to **PCB**. Press **Update from schematic** to bring the parts and the connections over.
2. **Auto-place and route** arranges the footprints and lays the tracks; **Auto-route** only routes. You can also move
   footprints by hand and draw tracks yourself.
3. Set the board size, the layers, the clearance and the track width, and add a copper **pour** (for example ground).
4. **Run DRC** checks clearances, track widths and unconnected nets and lists the problems; click one to jump to it.
5. **Export Gerber (ZIP)** writes the copper, mask, silkscreen, outline and drill files for a board house.
6. The **3D** view shows the finished board.

Single-sided boards are supported; choose the board type before routing.

## 6. The part library

Every part that is not built into the editor is a small JSON file, so adding a part needs no programming:
see [`library/README.md`](../library/README.md) for the format. **Import library...** at the top of the part list adds your
own files; imported parts are saved inside every project that uses them, so projects open on other computers.

## 7. Files, printing and themes

- **Save** writes a project file with the schematic, the board and any imported parts.
- **Sheet** shows the drawing sheet, **Center** moves the circuit to its middle, and **Print...** (`Ctrl` + `P`) prints the
  sheet or saves it as a PDF at the paper size you choose.
- The theme menu offers light and dark themes; the choice and the language are remembered.

## 8. Working with Claude (optional)

The **Claude** button opens an assistant that can build and explain circuits. You can use your own Anthropic API key, or let
**Claude Desktop** drive the app through the bundled MCP server (no API key; see `electron/claude-config.cjs` and the
`mcp/` folder).

## 9. Troubleshooting

| Message or symptom | What to do |
| --- | --- |
| "No ground" | add a GND symbol and connect it to the circuit |
| "Singular circuit" | a node has no path to ground, or two ideal sources are in parallel; add a resistor |
| "Did not converge" | lower the time step, or add a series resistance to diodes and sources |
| The sketch will not compile | install the Arduino IDE 2 / `arduino-cli`, or load a `.hex` file |
| Nothing arrives from a Bluetooth pair | both modules need the same link name and a supply, and the boards must use `Serial` (D0 / D1) |
| Everything runs slowly | raise the time step or lower *Steps / frame*; big circuits with many transistors cost more |
