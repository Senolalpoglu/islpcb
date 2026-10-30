// The part library: parts shipped as JSON, parts the user imports, and parts embedded in project files.

import { allCustomSpecs, customSpec, registerCustomPart, unregisterCustomPart, validateSpec, customType, isCustomType, type CustomPartSpec } from './customParts';
import type { Doc } from './model';

const shipped = import.meta.glob('../../library/parts/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

const STORAGE_KEY = 'snl.userlib';
let builtinLoaded = false;

/** Reads a library file's JSON: a single part, a list of parts, or { "parts": [...] }. */
function partsOf(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (typeof json === 'object' && json !== null && Array.isArray((json as { parts?: unknown }).parts)) return (json as { parts: unknown[] }).parts;
  return [json];
}

/** Registers the parts that ship with the program. Returns any problems found in them (there should be none). */
export function loadBuiltinLibrary(): string[] {
  if (builtinLoaded) return [];
  builtinLoaded = true;
  const errors: string[] = [];
  for (const file of Object.values(shipped)) {
    for (const raw of partsOf(file)) {
      const r = validateSpec(raw);
      if (r.spec) registerCustomPart({ ...r.spec, builtin: true });
      else errors.push(...r.errors);
    }
  }
  return errors;
}

const userSpecs = (): CustomPartSpec[] => allCustomSpecs().filter((s) => !s.builtin);

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userSpecs()));
  } catch {
    /* storage unavailable: the parts still live for this session and in the project files that use them */
  }
}

/** Registers the parts the user imported in earlier sessions. */
export function loadUserLibrary(): string[] {
  let stored: unknown[] = [];
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text) stored = partsOf(JSON.parse(text));
  } catch {
    return [];
  }
  const errors: string[] = [];
  for (const raw of stored) {
    const r = validateSpec(raw);
    if (r.spec) registerCustomPart({ ...r.spec, builtin: false });
    else errors.push(...r.errors);
  }
  return errors;
}

/** Imports the text of a library file. Parts with a known id are replaced. */
export function importLibraryText(text: string): { added: string[]; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { added: [], errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  const added: string[] = [];
  const errors: string[] = [];
  for (const raw of partsOf(json)) {
    const r = validateSpec(raw);
    if (!r.spec) {
      errors.push(...r.errors);
      continue;
    }
    if (customSpec(customType(r.spec.id))?.builtin) {
      errors.push(`Part "${r.spec.id}" would replace a built-in part; choose another id.`);
      continue;
    }
    registerCustomPart({ ...r.spec, builtin: false });
    added.push(r.spec.id);
  }
  if (added.length) persist();
  return { added, errors };
}

export function removeUserPart(id: string): void {
  const spec = customSpec(customType(id));
  if (!spec || spec.builtin) return;
  unregisterCustomPart(customType(id));
  persist();
}

/** The definitions of the user parts a document uses, so the project file carries them along. */
export function usedUserSpecs(doc: Doc): CustomPartSpec[] {
  const ids = new Set(doc.parts.map((p) => p.type).filter(isCustomType));
  return userSpecs().filter((s) => ids.has(customType(s.id)));
}

/**
 * Registers the part definitions stored in a project file. A definition already present is kept when it is
 * identical; otherwise the project's own version wins, because that is what the project was designed with.
 */
export function registerEmbedded(specs: unknown[] | undefined): string[] {
  const errors: string[] = [];
  for (const raw of specs ?? []) {
    const r = validateSpec(raw);
    if (!r.spec) {
      errors.push(...r.errors);
      continue;
    }
    const have = customSpec(customType(r.spec.id));
    if (have?.builtin) continue;
    if (!have || JSON.stringify(have) !== JSON.stringify({ ...r.spec, builtin: false })) registerCustomPart({ ...r.spec, builtin: false });
  }
  return errors;
}
