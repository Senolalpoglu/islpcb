import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { CATEGORY_LABEL, PART_DEFS, PART_ORDER, partLabel, type Category, type PartType } from '../editor/model';
import { PartThumb } from '../editor/thumbs';
import { customSpec, isCustomType } from '../editor/customParts';
import { familiesOf, type Family } from '../editor/families';
import { importLibraryText, removeUserPart } from '../editor/library';

interface Props {
  placing: PartType | null;
  onPick: (t: PartType) => void;
  /** Bumped whenever the set of registered parts changes, so the list is rebuilt. */
  version: number;
  onLibraryChanged: () => void;
}

const WIDTH_KEY = 'snl.libraryWidth';
const MIN_WIDTH = 170;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 220;

const clampWidth = (w: number): number => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(w)));

/** The library column is sized by a CSS variable on the workspace grid, so the canvas simply takes what is left. */
function applyWidth(w: number): void {
  document.documentElement.style.setProperty('--lib-w', `${w}px`);
}

function storedWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
  } catch {
    /* storage unavailable: use the default */
  }
  return DEFAULT_WIDTH;
}

const CATEGORIES: Category[] = ['passive', 'source', 'semi', 'ic', 'logic', 'mcu', 'switch', 'electromech', 'meter', 'power', 'sensor', 'module', 'connector', 'misc'];

/** Where the flyout with a family's parts opens: to the right of the library, level with the family's card. */
interface Flyout {
  family: Family;
  left: number;
  top: number;
}

export function LibraryPanel({ placing, onPick, version, onLibraryChanged }: Props) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [flyout, setFlyout] = useState<Flyout | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const fly = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // The width the user chose last time.
  useEffect(() => {
    applyWidth(storedWidth());
  }, []);

  const setWidth = (w: number, save: boolean) => {
    const width = clampWidth(w);
    applyWidth(width);
    if (!save) return;
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* the width only lasts for this session */
    }
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const left = panel.current?.getBoundingClientRect().left ?? 0;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    document.body.classList.add('lib-resizing');
    setFlyout(null);
    const startX = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return; // a plain click must not nudge the width
      moved = true;
      setWidth(ev.clientX - left, false);
    };
    const up = (ev: PointerEvent) => {
      if (moved) setWidth(ev.clientX - left, true);
      setDragging(false);
      document.body.classList.remove('lib-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const labelOf = (type: PartType): string => partLabel(PART_DEFS[type], t, lang);
  const familyName = (f: Family): string => (lang === 'tr' ? (f.label.tr ?? f.label.en) : f.label.en);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATEGORIES.map((cat) => {
      const types = PART_ORDER.filter((type) => {
        const def = PART_DEFS[type];
        if (def.category !== cat) return false;
        return !q || partLabel(def, t, lang).toLowerCase().includes(q) || type.toLowerCase().includes(q);
      });
      // While searching, matching parts are listed flat; otherwise each family is one card.
      return { cat, flat: q ? types : [], families: q ? [] : familiesOf(cat, types) };
    }).filter((g) => g.flat.length + g.families.length > 0);
    // `t` changes identity every render; the language is what actually matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, lang, version]);

  // The flyout closes on a click elsewhere, on Escape, and when the list changes under it.
  useEffect(() => {
    if (!flyout) return;
    const down = (e: MouseEvent) => {
      const target = e.target as Node;
      if (fly.current?.contains(target) || (target as Element).closest?.('.fam-open')) return;
      setFlyout(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setFlyout(null);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [flyout]);
  useEffect(() => setFlyout(null), [query, version, lang]);

  const importFiles = async (files: FileList) => {
    const added: string[] = [];
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      const r = importLibraryText(await file.text());
      added.push(...r.added);
      errors.push(...r.errors);
    }
    if (added.length) onLibraryChanged();
    const lines = [added.length ? `${t('lib.imported')}: ${added.join(', ')}` : '', ...errors.slice(0, 8)].filter(Boolean);
    if (lines.length) alert(lines.join('\n'));
  };

  const removePart = (type: PartType) => {
    const spec = customSpec(type);
    if (!spec || spec.builtin || !confirm(`${t('lib.remove')}: ${labelOf(type)}?`)) return;
    removeUserPart(type.slice(2));
    onLibraryChanged();
  };

  const partCard = (type: PartType) => (
    <button
      key={type}
      className={`lib-item ${placing === type ? 'active' : ''}`}
      onClick={() => {
        setFlyout(null);
        onPick(type);
      }}
      onContextMenu={(e) => {
        if (isCustomType(type) && !customSpec(type)?.builtin) {
          e.preventDefault();
          removePart(type);
        }
      }}
      title={labelOf(type)}
    >
      <PartThumb type={type} />
      <span>{labelOf(type)}</span>
    </button>
  );

  const openFlyout = (family: Family, cell: HTMLElement) => {
    if (flyout?.family.id === family.id) return setFlyout(null);
    const panelBox = panel.current?.getBoundingClientRect();
    const cellBox = cell.getBoundingClientRect();
    const height = Math.min(520, 70 + Math.ceil(family.members.length / 2) * 104);
    setFlyout({ family, left: (panelBox?.right ?? cellBox.right) + 6, top: Math.max(8, Math.min(cellBox.top, window.innerHeight - height - 8)) });
  };

  const familyCard = (family: Family) => {
    if (family.members.length === 1) return partCard(family.members[0]);
    const isOpen = flyout?.family.id === family.id;
    const has = placing !== null && family.members.includes(placing);
    return (
      <div key={family.id} className={`lib-cell ${isOpen ? 'open' : ''}`}>
        <button
          className={`lib-item fam ${has ? 'active' : ''}`}
          title={`${familyName(family)} (${family.members.length})`}
          onClick={(e) => openFlyout(family, e.currentTarget.parentElement!)}
        >
          <PartThumb type={has ? placing! : family.members[0]} />
          <span>{familyName(family)}</span>
          <em className="fam-count">{family.members.length}</em>
        </button>
        <button className="fam-open" aria-label={`${familyName(family)}: ${t('lib.showFamily')}`} title={t('lib.showFamily')} onClick={(e) => openFlyout(family, e.currentTarget.parentElement!)}>
          ▸
        </button>
      </div>
    );
  };

  return (
    <aside className="panel library" ref={panel}>
      <h2>{t('panel.library')}</h2>
      <input className="search" placeholder={t('panel.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      <button className="lib-import" onClick={() => fileInput.current?.click()} title={t('lib.importHint')}>
        {t('lib.import')}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void importFiles(e.target.files).then(() => (e.target.value = ''));
        }}
      />
      <div className="lib-scroll" onScroll={() => flyout && setFlyout(null)}>
        {groups.map((g) => (
          <section key={g.cat}>
            <h3>{t(CATEGORY_LABEL[g.cat])}</h3>
            <div className="lib-grid">{g.flat.length > 0 ? g.flat.map(partCard) : g.families.map(familyCard)}</div>
          </section>
        ))}
      </div>

      <div
        className={`lib-resize ${dragging ? 'dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('lib.resize')}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={Math.round(panel.current?.getBoundingClientRect().width ?? DEFAULT_WIDTH)}
        tabIndex={0}
        title={t('lib.resize')}
        onPointerDown={startResize}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH, true)}
        onKeyDown={(e) => {
          const now = panel.current?.getBoundingClientRect().width ?? DEFAULT_WIDTH;
          if (e.key === 'ArrowRight') setWidth(now + 20, true);
          else if (e.key === 'ArrowLeft') setWidth(now - 20, true);
          else if (e.key === 'Home') setWidth(DEFAULT_WIDTH, true);
        }}
      />

      {flyout && (
        <div className="lib-flyout" ref={fly} style={{ left: flyout.left, top: flyout.top }} role="menu" aria-label={familyName(flyout.family)}>
          <header>
            <strong>{familyName(flyout.family)}</strong>
            <span className="muted small">{flyout.family.members.length}</span>
            <button onClick={() => setFlyout(null)} aria-label={t('op.close')}>
              ✕
            </button>
          </header>
          <div className="lib-grid">{flyout.family.members.map(partCard)}</div>
        </div>
      )}
    </aside>
  );
}
