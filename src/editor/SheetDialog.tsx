// The dialog for the drawing sheet: paper, the title block fields, and the Print / Save as PDF buttons.

import { useI18n, type Key } from '../i18n';
import { PAPER_SIZES, type PaperChoice, type SheetSettings } from './sheet';

interface Props {
  sheet: SheetSettings;
  /** The paper the sheet has now (shown next to "Auto"). */
  autoName: string;
  onChange: (s: SheetSettings) => void;
  onPrint: () => void;
  onPdf: () => void;
  onClose: () => void;
}

type TextField = 'company' | 'title' | 'drawnBy' | 'approvedBy' | 'date' | 'revision' | 'docNo' | 'sheetNo';
const FIELDS: Array<[TextField, Key]> = [
  ['company', 'print.company'],
  ['title', 'print.titleField'],
  ['drawnBy', 'print.drawnBy'],
  ['approvedBy', 'print.approvedBy'],
  ['date', 'print.date'],
  ['revision', 'print.revision'],
  ['docNo', 'print.docNo'],
  ['sheetNo', 'print.sheetNo'],
];

export function SheetDialog({ sheet, autoName, onChange, onPrint, onPdf, onClose }: Props) {
  const { t } = useI18n();
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={t('print.title')}>
        <h3>{t('print.title')}</h3>
        <div className="modal-grid">
          {FIELDS.map(([key, label]) => (
            <label key={key} className={key === 'company' || key === 'title' ? 'wide' : ''}>
              <span>{t(label)}</span>
              <input type="text" value={sheet[key]} onChange={(e) => onChange({ ...sheet, [key]: e.target.value })} />
            </label>
          ))}
          <label>
            <span>{t('print.paper')}</span>
            <select value={sheet.size} onChange={(e) => onChange({ ...sheet, size: e.target.value as PaperChoice })}>
              <option value="auto">{`${t('print.auto')} (${autoName})`}</option>
              {PAPER_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('print.orientation')}</span>
            <select value={sheet.landscape ? 'l' : 'p'} onChange={(e) => onChange({ ...sheet, landscape: e.target.value === 'l' })}>
              <option value="l">{t('print.landscape')}</option>
              <option value="p">{t('print.portrait')}</option>
            </select>
          </label>
          <label className="wide check">
            <input type="checkbox" checked={sheet.show} onChange={(e) => onChange({ ...sheet, show: e.target.checked })} />
            <span>{t('print.show')}</span>
          </label>
        </div>
        <div className="modal-buttons">
          <button className="run" onClick={onPrint}>
            {t('print.print')}
          </button>
          <button onClick={onPdf}>{t('print.pdf')}</button>
          <span className="spacer" />
          <button onClick={onClose}>{t('print.close')}</button>
        </div>
      </div>
    </div>
  );
}
