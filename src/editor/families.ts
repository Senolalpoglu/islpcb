// Part families: the groups the library shows ("Diodes", "NPN transistors", "Relays" ...). A family sits inside one
// category and collects the parts of one kind; the library panel shows one card per family and opens its members
// in a flyout. A part belongs to the first family whose rule accepts it; anything left over goes to a family named
// after its category, so a newly imported part always shows up somewhere.

import { PART_DEFS, type Category, type LocalText, type PartType } from './model';

export interface Family {
  /** Stable id, unique across categories. */
  id: string;
  label: LocalText;
  category: Category;
  members: PartType[];
}

interface Rule {
  id: string;
  category: Category;
  label: LocalText;
  /** Part ids (the part type, or the library id without the "x:"), or a pattern for a whole series. */
  ids: Array<string | RegExp>;
}

const t = (en: string, tr: string): LocalText => ({ en, tr });

const RULES: Rule[] = [
  // Passive components
  { id: 'resistors', category: 'passive', label: t('Resistors', 'Dirençler'), ids: ['R'] },
  { id: 'pots', category: 'passive', label: t('Potentiometers', 'Potansiyometreler'), ids: ['potentiometer', 'trimpot'] },
  { id: 'thermistors', category: 'passive', label: t('Light and temperature resistors', 'Işık ve sıcaklık dirençleri'), ids: ['ldr', 'ntc', 'ptc'] },
  { id: 'capacitors', category: 'passive', label: t('Capacitors', 'Kondansatörler'), ids: ['C', 'cap-electrolytic', 'cap-tantalum'] },
  { id: 'inductors', category: 'passive', label: t('Inductors and coils', 'Bobinler'), ids: ['L', 'coil', 'choke'] },
  { id: 'crystals', category: 'passive', label: t('Crystals', 'Kristaller'), ids: [/^xtal-/] },
  { id: 'rnets', category: 'passive', label: t('Resistor networks (SIL)', 'Sıra dirençler (SIL)'), ids: [/^rnet-/] },
  { id: 'transformers', category: 'passive', label: t('Transformers', 'Trafolar'), ids: ['transformer', /^transformer-/, /^trafo-/] },
  { id: 'protection', category: 'passive', label: t('Fuses and protection', 'Sigorta ve koruma'), ids: ['fuse', 'varistor'] },
  { id: 'rf-tuning', category: 'passive', label: t('Tuning capacitors and antennas', 'Ayar kondansatörleri ve antenler'), ids: ['cap-variable', 'cap-trimmer', 'antenna', 'ferrite-antenna'] },
  { id: 'speakers', category: 'passive', label: t('Speakers and buzzers', 'Hoparlör ve buzzer'), ids: ['speaker'] },

  // Sources
  { id: 'batteries', category: 'source', label: t('Batteries and DC supplies', 'Piller ve DC kaynaklar'), ids: ['VDC', 'battery', /^cell-/] },
  { id: 'ac-sources', category: 'source', label: t('AC and signal sources', 'AC ve sinyal kaynakları'), ids: ['VAC', 'VPULSE', 'vtri', /^mains-/] },
  { id: 'current-sources', category: 'source', label: t('Current sources', 'Akım kaynakları'), ids: ['IDC'] },

  // Semiconductors
  { id: 'diodes', category: 'semi', label: t('Diodes', 'Diyotlar'), ids: ['D', '1n4148', '1n4007', 'schottky', '1n5819', /^1n(5817|5822|4001|4004|5408)$/, 'ba159', 'uf4007', 'bas16', 'baw56', 'bav70', 'varicap-bb910'] },
  { id: 'zeners', category: 'semi', label: t('Zener diodes', 'Zener diyotlar'), ids: ['zener', /^1n47/] },
  { id: 'leds', category: 'semi', label: t('LEDs', "LED'ler"), ids: ['LED', /^led-/] },
  { id: 'displays', category: 'semi', label: t('7-segment displays', '7 segment göstergeler'), ids: [/^7seg-/] },
  { id: 'bridges', category: 'semi', label: t('Bridge rectifiers', 'Köprü diyotlar'), ids: ['bridge'] },
  { id: 'npn', category: 'semi', label: t('NPN transistors', 'NPN transistörler'), ids: ['QNPN', '2n2222', '2n3904', 'bc547', 'bc337', 'bd139', 'tip31c', '2n3055', 'bc107', 'bc108', 'bc140', 'tip29c', 'bu508a', 's8050', '2n5551'] },
  { id: 'pnp', category: 'semi', label: t('PNP transistors', 'PNP transistörler'), ids: ['QPNP', '2n3906', 'bc557', 'bc327', 'bd140', 'tip32c', 'mj2955', 'bd138', 'bc856b', 'mmbt2907a', 's8550', '2n5401', '2n2907a'] },
  { id: 'darlington', category: 'semi', label: t('Darlington transistors', 'Darlington transistörler'), ids: ['tip120', 'tip125'] },
  { id: 'nmos', category: 'semi', label: t('N-channel MOSFETs', "N kanal MOSFET'ler"), ids: ['NMOS', 'nmos-power', 'irf540n', 'irf520', 'irfz44n', 'irlz44n', 'irf3205', '2n7000', 'bs170', 'irf510', 'irf530', 'irf540', 'irf630', '6n60', '6n90', '12n65', '2n7002', 'ao3400a', 'irf840'] },
  { id: 'pmos', category: 'semi', label: t('P-channel MOSFETs', "P kanal MOSFET'ler"), ids: ['PMOS', 'pmos-power', 'irf9540', 'irf9z24n', 'irf5210', 'ao3401a', 'irlml6402', 'irf4905'] },
  { id: 'thyristors', category: 'semi', label: t('Thyristors (SCR)', 'Tristörler (SCR)'), ids: [/^scr-/] },
  { id: 'triacs', category: 'semi', label: t('Triacs and diacs', 'Triyak ve diyaklar'), ids: [/^triac-/, 'diac-db3'] },
  { id: 'optos', category: 'semi', label: t('Optocouplers', 'Optokuplörler'), ids: ['optocoupler', 'moc3021', '4n25', '4n35', 'el817', 'pc814', 'moc3010', 'moc3020', 'moc3023', '6n137', 'tlp250', 'tlp251'] },

  // Integrated circuits
  { id: 'opamps', category: 'ic', label: t('Operational amplifiers', "Op-amp'lar"), ids: ['OPAMP', 'opamp-supply', 'lm358', 'lm741', 'tl072', 'ne5532', 'lm324', 'ca3140', 'ca3130', 'ca3240', 'lm833', 'lm258', 'lm224', 'ad620'] },
  { id: 'comparators', category: 'ic', label: t('Comparators', 'Karşılaştırıcılar'), ids: ['lm393', 'lm339', 'lm239', 'lm311', 'lm211'] },
  { id: 'timers', category: 'ic', label: t('Timers', 'Zamanlayıcılar'), ids: ['ne555', 'lm555', 'lm556', 'cd4047'] },
  { id: 'radio-audio-ics', category: 'ic', label: t('Radio and audio ICs', 'Radyo ve ses entegreleri'), ids: ['zn414', 'lm386'] },
  { id: 'gate-drivers', category: 'ic', label: t('MOSFET gate drivers', 'MOSFET kapı sürücüleri'), ids: ['tc4427'] },
  { id: 'driver-ics', category: 'ic', label: t('Driver arrays', 'Sürücü dizileri'), ids: ['uln2003', 'l293d'] },

  // Logic
  { id: 'gates', category: 'logic', label: t('Logic gates', 'Mantık kapıları'), ids: [/^gate-/] },
  { id: 'flipflops', category: 'logic', label: t('Flip-flops', 'Flip-floplar'), ids: ['dff'] },
  { id: 'cd4000', category: 'logic', label: t('CD4000 series chips', 'CD4000 serisi entegreler'), ids: [/^cd40/] },
  { id: '74hc', category: 'logic', label: t('74HC series chips', '74HC serisi entegreler'), ids: [/^74hc/] },

  // Regulators
  { id: 'reg-pos', category: 'power', label: t('Positive regulators (78xx)', 'Pozitif regülatörler (78xx)'), ids: ['regulator', /^lm78/, 'ka78t05'] },
  { id: 'reg-neg', category: 'power', label: t('Negative regulators (79xx)', 'Negatif regülatörler (79xx)'), ids: [/^lm79/] },
  { id: 'reg-ldo', category: 'power', label: t('Low-dropout regulators', 'Düşük dropout regülatörler'), ids: [/^lm1117/, /^ams1117/, 'lm2940-5', 'mcp1700-3v3'] },
  { id: 'reg-adj', category: 'power', label: t('Adjustable regulators', 'Ayarlı regülatörler'), ids: ['lm317', 'lm337'] },

  // Microcontroller boards
  { id: 'arduino', category: 'mcu', label: t('Arduino boards', 'Arduino kartları'), ids: [/^ARDUINO_/] },
  { id: 'pico', category: 'mcu', label: t('Raspberry Pi Pico', 'Raspberry Pi Pico'), ids: ['PICO', 'PICO_W'] },
  { id: 'pic', category: 'mcu', label: t('PIC microcontrollers', 'PIC mikrodenetleyiciler'), ids: [/^PIC16/] },
  { id: 'esp', category: 'mcu', label: t('ESP boards', 'ESP kartları'), ids: ['esp32-devkit', 'nodemcu', 'wemos-d1-mini'] },

  // Switches and electromechanical parts
  { id: 'switches', category: 'switch', label: t('Switches', 'Anahtarlar'), ids: ['SW', 'toggle-spst', 'spdt', 'dpdt', 'reed-switch'] },
  { id: 'dip-switches', category: 'switch', label: t('DIP switches', 'DIP anahtarlar'), ids: [/^dip-switch-/] },
  { id: 'buttons', category: 'switch', label: t('Push buttons', 'Butonlar'), ids: [/^pushbutton/] },
  { id: 'relays', category: 'electromech', label: t('Relays', 'Röleler'), ids: ['relay', /^relay-(spst|dpdt|3pdt|srd|g2rl)/] },
  { id: 'ssr', category: 'electromech', label: t('Solid-state relays', 'Katı hal röleleri'), ids: [/^ssr-/] },
  { id: 'motors', category: 'electromech', label: t('Motors and pumps', 'Motorlar ve pompalar'), ids: ['dc-motor', 'pump-12v'] },
  { id: 'fans', category: 'electromech', label: t('Fans', 'Fanlar'), ids: [/^fan-/] },
  { id: 'lamps', category: 'electromech', label: t('Lamps and neon', 'Lambalar ve neon'), ids: [/^lamp/, /^neon-/] },
  { id: 'transducers', category: 'electromech', label: t('Ultrasonic transducers', 'Ultrasonik transdüserler'), ids: ['piezo-transducer', 'ultrasonic-40k', 'langevin-28k-50w', 'piezo-1mhz-focus'] },
  { id: 'valves', category: 'electromech', label: t('Solenoid valves', 'Selenoid valfler'), ids: [/^valve-/] },
  { id: 'meters', category: 'meter', label: t('Meters', 'Ölçü aletleri'), ids: ['voltmeter', 'ammeter'] },

  // Sensors
  { id: 'temp-sensors', category: 'sensor', label: t('Temperature and humidity sensors', 'Sıcaklık ve nem sensörleri'), ids: ['lm35', 'tmp36', 'ds18b20', 'dht11', 'dht22'] },
  { id: 'analog-sensors', category: 'sensor', label: t('Analog sensor modules', 'Analog sensör modülleri'), ids: ['ldr-module', 'mq2-module', /^mq\d+-module$/, 'soil-moisture', 'sound-sensor', 'rain-sensor'] },
  { id: 'motion-sensors', category: 'sensor', label: t('Motion, distance and input', 'Hareket, mesafe ve giriş'), ids: ['pir-hc-sr501', 'hc-sr04', 'mpu6050', 'joystick', 'tsop1838', 'e18-d80nk'] },
  { id: 'current-sensors', category: 'sensor', label: t('Current sensors', 'Akım sensörleri'), ids: [/^acs712/] },
  { id: 'microphones', category: 'sensor', label: t('Microphones', 'Mikrofonlar'), ids: ['mic-electret'] },
  { id: 'flow-sensors', category: 'sensor', label: t('Flow sensors', 'Debi sensörleri'), ids: [/^flow-/] },
  { id: 'pressure-sensors', category: 'sensor', label: t('Pressure and weight', 'Basınç ve ağırlık'), ids: ['bmp280', 'hx711'] },

  // Modules
  { id: 'wireless', category: 'module', label: t('Wireless modules', 'Kablosuz modüller'), ids: ['hc-05', 'hc-06', 'hc-12', 'esp-01', 'nrf24l01'] },
  { id: 'gps-rfid', category: 'module', label: t('GPS and RFID', 'GPS ve RFID'), ids: ['neo-6m', 'rc522'] },
  { id: 'display-modules', category: 'module', label: t('Display modules', 'Ekran modülleri'), ids: ['oled-ssd1306', 'lcd1602', 'lcd1602-i2c', 'lcd2004', 'lcd2004-i2c', 'tm1637', 'max7219-module', 'nextion-display'] },
  { id: 'storage-clock', category: 'module', label: t('Storage and clock', 'Depolama ve saat'), ids: ['sd-card', 'ds3231', 'ds1307'] },
  { id: 'motor-drivers', category: 'module', label: t('Motors and drivers', 'Motorlar ve sürücüler'), ids: ['l298n', 'tb6612fng', 'a4988', 'servo-sg90', 'stepper-28byj48', 'relay-module-1ch'] },

  // Miscellaneous
  { id: 'screw-terminals', category: 'connector', label: t('Screw terminal blocks', 'Vidalı klemensler'), ids: [/^term-/] },
  { id: 'pluggable', category: 'connector', label: t('Pluggable terminal blocks (male)', 'Geçmeli klemens (erkek)'), ids: [/^plug-/] },
  { id: 'male-headers', category: 'connector', label: t('Pin headers (male)', 'Pin header (erkek)'), ids: [/^hdr-m-/, /^hdr2-m-/] },
  { id: 'female-headers', category: 'connector', label: t('Female headers (sockets)', 'Dişi header (soket)'), ids: [/^hdr-f-/] },
  { id: 'tunik', category: 'connector', label: t('Tunik headers (male)', 'Tunik erkek'), ids: [/^tunik-/] },
  { id: 'jst', category: 'connector', label: t('JST connectors', 'JST konnektörler'), ids: [/^jst-/] },
  { id: 'connectors', category: 'connector', label: t('Simple pin strips', 'Basit pin sıraları'), ids: [/^conn-/] },
  { id: 'references', category: 'misc', label: t('Ground and probes', 'Toprak ve prob'), ids: ['GND', 'PROBE'] },
];

const idOf = (type: PartType): string => (type.startsWith('x:') ? type.slice(2) : type);

const accepts = (rule: Rule, id: string): boolean => rule.ids.some((m) => (typeof m === 'string' ? m === id : m.test(id)));

/** Label of the catch-all family of a category. */
const OTHER: Record<Category, LocalText> = {
  passive: t('Other passive parts', 'Diğer pasif parçalar'),
  source: t('Other sources', 'Diğer kaynaklar'),
  semi: t('Other semiconductors', 'Diğer yarı iletkenler'),
  ic: t('Other integrated circuits', 'Diğer entegreler'),
  logic: t('Other logic', 'Diğer mantık'),
  mcu: t('Other boards', 'Diğer kartlar'),
  switch: t('Other switches', 'Diğer anahtarlar'),
  electromech: t('Other electromechanical', 'Diğer elektromekanik'),
  meter: t('Other meters', 'Diğer ölçüler'),
  power: t('Other power parts', 'Diğer güç parçaları'),
  sensor: t('Other sensors', 'Diğer sensörler'),
  module: t('Other modules', 'Diğer modüller'),
  connector: t('Other connectors', 'Diğer konnektörler'),
  misc: t('Other', 'Diğer'),
};

/** The family a part belongs to. */
export function familyOf(type: PartType): { id: string; label: LocalText; category: Category } {
  const def = PART_DEFS[type];
  const id = idOf(type);
  const rule = RULES.find((r) => r.category === def.category && accepts(r, id));
  return rule ? { id: rule.id, label: rule.label, category: rule.category } : { id: `other-${def.category}`, label: OTHER[def.category], category: def.category };
}

/** The families of one category, each with its parts in the order given, families in the order of first appearance. */
export function familiesOf(category: Category, types: PartType[]): Family[] {
  const out = new Map<string, Family>();
  for (const type of types) {
    if (PART_DEFS[type].category !== category) continue;
    const f = familyOf(type);
    const have = out.get(f.id);
    if (have) have.members.push(type);
    else out.set(f.id, { id: f.id, label: f.label, category, members: [type] });
  }
  return [...out.values()];
}
