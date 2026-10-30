import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, NX, NextionDisplay, cssColor, parseLayout, rgb565 } from '../core/mcu/nextion';

/** A powered display whose answers are collected as bytes. */
function display(layout = DEFAULT_LAYOUT) {
  const d = new NextionDisplay(layout);
  const out: number[] = [];
  d.output = (b) => out.push(b);
  d.setPower(true);
  out.length = 0; // the ready byte is tested on its own
  const say = (cmd: string): void => {
    for (const ch of cmd) d.feed(ch.charCodeAt(0));
    d.feed(0xff);
    d.feed(0xff);
    d.feed(0xff);
  };
  const take = (): number[] => out.splice(0, out.length);
  return { d, say, take, out };
}

const ff = [0xff, 0xff, 0xff];

describe('virtual Nextion display', () => {
  it('announces that it is ready when it gets power, and ignores everything before', () => {
    const d = new NextionDisplay();
    const out: number[] = [];
    d.output = (b) => out.push(b);
    for (const ch of 't1.txt="x"') d.feed(ch.charCodeAt(0));
    for (let i = 0; i < 3; i++) d.feed(0xff);
    expect(d.current.components[1].txt).toBe('LED: OFF'); // no power: nothing happened
    d.setPower(true);
    expect(out).toEqual([0x88, ...ff]);
  });

  it('sets texts and numbers, and shows them', () => {
    const { d, say } = display();
    say('t1.txt="LED: ON"');
    say('n0.val=42');
    expect(d.current.components[1].txt).toBe('LED: ON');
    expect(d.current.components[2].val).toBe(42);
    say('n0.val+=8');
    expect(d.current.components[2].val).toBe(50);
    say('t1.txt+="!"');
    expect(d.current.components[1].txt).toBe('LED: ON!');
  });

  it('copes with an instruction that arrives in pieces, and with several in a row', () => {
    const { d } = display();
    const send = (s: string) => [...s].forEach((c) => d.feed(c.charCodeAt(0)));
    send('n0.va');
    send('l=7');
    d.feed(0xff);
    d.feed(0xff);
    expect(d.current.components[2].val).toBe(0); // not finished yet
    d.feed(0xff);
    expect(d.current.components[2].val).toBe(7);
    send('n0.val=8');
    [0xff, 0xff, 0xff].forEach((b) => d.feed(b));
    send('t0.txt="two"');
    [0xff, 0xff, 0xff].forEach((b) => d.feed(b));
    expect(d.current.components[2].val).toBe(8);
    expect(d.current.components[0].txt).toBe('two');
  });

  it('answers with return codes according to bkcmd (default: failures only)', () => {
    const { say, take } = display();
    say('n0.val=1');
    expect(take()).toEqual([]); // success is quiet by default
    say('nosuch.txt="x"');
    expect(take()).toEqual([NX.badComponent, ...ff]);
    say('page 9');
    expect(take()).toEqual([NX.badPage, ...ff]);
    say('what is this');
    expect(take()).toEqual([NX.invalid, ...ff]);
    say('t0.val=3'); // a text has no value
    expect(take()).toEqual([NX.badAttribute, ...ff]);
    say('n0.val="abc"'); // wrong kind of value
    expect(take()).toEqual([NX.badOperation, ...ff]);
    say('bkcmd=3');
    expect(take()).toEqual([NX.ok, ...ff]);
    say('n0.val=2');
    expect(take()).toEqual([NX.ok, ...ff]);
    say('bkcmd=0');
    take();
    say('page 9');
    expect(take()).toEqual([]);
    say('bkcmd=1');
    take(); // the display answers the bkcmd instruction itself under the new setting
    say('n0.val=2');
    expect(take()).toEqual([NX.ok, ...ff]);
    say('page 9');
    expect(take()).toEqual([]);
  });

  it('get returns a text as 0x70 ... or a number as 0x71 and four bytes, little endian', () => {
    const { say, take } = display();
    say('get t1.txt');
    expect(take()).toEqual([0x70, ...[...'LED: OFF'].map((c) => c.charCodeAt(0)), ...ff]);
    say('n0.val=300');
    say('get n0.val');
    expect(take()).toEqual([0x71, 0x2c, 0x01, 0x00, 0x00, ...ff]);
    say('n0.val=-2');
    say('get n0.val');
    expect(take()).toEqual([0x71, 0xfe, 0xff, 0xff, 0xff, ...ff]);
    say('get nosuch.val');
    expect(take()).toEqual([NX.badAttribute, ...ff]);
  });

  it('sends touch events of the buttons: 0x65 page component state', () => {
    const { d, take } = display();
    d.touch(4, true); // b0 is component 4
    expect(take()).toEqual([0x65, 0, 4, 1, ...ff]);
    expect(d.pressed).toBe(4);
    d.touch(4, false);
    expect(take()).toEqual([0x65, 0, 4, 0, ...ff]);
    expect(d.pressed).toBeNull();
    d.touch(1, true); // a text does not react
    expect(take()).toEqual([]);
    d.touch(9, true); // there is no such component
    expect(take()).toEqual([]);
  });

  it('tsw switches touch off and on, vis hides a component', () => {
    const { d, say, take } = display();
    say('tsw b0,0');
    d.touch(4, true);
    expect(take()).toEqual([]);
    say('tsw b0,1');
    d.touch(4, true);
    expect(take()).toHaveLength(7);
    say('vis b1,0');
    d.touch(5, true);
    expect(take()).toEqual([]);
  });

  it('click sends the same event as a touch', () => {
    const { say, take } = display();
    say('click b1,1');
    expect(take()).toEqual([0x65, 0, 5, 1, ...ff]);
    say('click nosuch,1');
    expect(take()).toEqual([NX.badComponent, ...ff]);
  });

  it('sendme gives the current page, page changes it by number or by name', () => {
    const layout = parseLayout(JSON.stringify({ pages: [{ name: 'home', components: [] }, { name: 'settings', components: [{ type: 'text', name: 't0', txt: 'S' }] }] })).layout;
    const { d, say, take } = display(layout);
    say('sendme');
    expect(take()).toEqual([0x66, 0, ...ff]);
    say('page settings');
    expect(d.page).toBe(1);
    say('sendme');
    expect(take()).toEqual([0x66, 1, ...ff]);
    say('page 0');
    expect(d.page).toBe(0);
    say('get t0.txt');
    expect(take()).toEqual([NX.badAttribute, ...ff]); // t0 lives on the other page
  });

  it('printh sends raw bytes, rest starts over, harmless commands are accepted', () => {
    const { d, say, take } = display();
    say('printh 41 0A');
    expect(take()).toEqual([0x41, 0x0a]);
    say('t1.txt="changed"');
    say('rest');
    expect(d.current.components[1].txt).toBe('LED: OFF');
    for (const c of ['dim=50', 'sleep=0', 'ref 0', 'cls 0']) {
      say(c);
      expect(take()).toEqual([]);
    }
  });

  it('keeps a short history of the instructions it got', () => {
    const { d, say } = display();
    say('n0.val=1');
    say('n0.val=2');
    expect(d.history.slice(-2)).toEqual(['n0.val=1', 'n0.val=2']);
  });
});

describe('layouts', () => {
  it('an empty layout is the demo screen', () => {
    expect(parseLayout('').layout).toBe(DEFAULT_LAYOUT);
    expect(DEFAULT_LAYOUT.pages[0].components.map((c) => c.name)).toEqual(['t0', 't1', 'n0', 'b0', 'b1']);
  });

  it('reads a layout and fills in what is missing', () => {
    const { layout, error } = parseLayout(JSON.stringify({ width: 480, height: 272, pages: [{ components: [{ type: 'button', name: 'go', x: 5, y: 6, w: 70, h: 30, txt: 'GO' }, { type: 'progress', name: 'j0', val: 50 }] }] }));
    expect(error).toBe('');
    expect(layout.width).toBe(480);
    const [go, bar] = layout.pages[0].components;
    expect(go).toMatchObject({ type: 'button', x: 5, y: 6, txt: 'GO', tsw: true, vis: true });
    expect(bar).toMatchObject({ type: 'progress', val: 50, tsw: false });
  });

  it('refuses a broken layout with a message and falls back to the demo screen', () => {
    for (const text of ['not json', '{}', '{"pages":[]}', '{"pages":[{"components":[{"type":"gauge","name":"g"}]}]}', '{"pages":[{"components":[{"type":"text","name":"1bad"}]}]}', '{"pages":[{"components":[{"type":"text","name":"a"},{"type":"text","name":"a"}]}]}']) {
      const r = parseLayout(text);
      expect(r.error, text).not.toBe('');
      expect(r.layout).toBe(DEFAULT_LAYOUT);
    }
  });

  it('colours are 16-bit RGB565 like on the display', () => {
    expect(rgb565(255, 255, 255)).toBe(65535);
    expect(cssColor(65535)).toBe('rgb(255,255,255)');
    expect(cssColor(0)).toBe('rgb(0,0,0)');
    expect(cssColor(rgb565(255, 0, 0))).toBe('rgb(255,0,0)');
  });
});
