import type {
  PakItem,
  PakObject,
  PakObjectState,
  PakImageRef,
  PakAnimationRef,
  PakRoom
} from '../types';

/**
 * Parses a comma-separated argument list, respecting double and single quotes.
 */
export function parseArgs(raw: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuote) {
      if (c === quoteChar) {
        inQuote = false;
      }
      current += c;
    } else {
      if (c === '"' || c === "'") {
        inQuote = true;
        quoteChar = c;
        current += c;
      } else if (c === ',') {
        args.push(current.trim());
        current = '';
      } else {
        current += c;
      }
    }
  }

  if (current.trim().length > 0) {
    args.push(current.trim());
  }

  return args;
}

/**
 * Strips surrounding double or single quotes if present.
 */
export function stripQuotes(s: string): string {
  const trimmed = s.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Measures the leading whitespace indentation of a line, treating tabs as 4 spaces.
 */
function getIndentation(line: string): number {
  const match = line.match(/^([ \t]*)/);
  if (!match) return 0;
  let indent = 0;
  for (const ch of match[1]) {
    indent += ch === '\t' ? 4 : 1;
  }
  return indent;
}

/**
 * Indents block body lines that have no indentation of their own. Lines that are already
 * indented (with spaces or tabs) and blank lines are written exactly as given.
 */
function indentBodyLines(bodyLines: string[], indent: string): string[] {
  return bodyLines.map(line => (line.trim() === '' || /^\s/.test(line) ? line : `${indent}${line}`));
}

/**
 * Compares two block bodies the way an editor round-trip would see them:
 * trailing whitespace on each line and trailing blank lines don't count as a change.
 */
function sameBodyLines(a: string[], b: string[]): boolean {
  const normalize = (bodyLines: string[]) => bodyLines.map(line => line.trimEnd()).join('\n').trimEnd();
  return normalize(a) === normalize(b);
}

/**
 * Structural equality for parsed .pak values. A missing property and an `undefined` one are equal.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
    return [...keys].every(k => sameValue(ra[k], rb[k]));
  }
  return false;
}

/** The parts of an object that are written to the file (not where it was read from). */
function objectContent(obj: PakObject) {
  const { filePath: _filePath, startLine: _startLine, endLine: _endLine, ...content } = obj;
  return content;
}

/**
 * The sprite to show for a state in previews: its image, or the first frame of its animation.
 * (An animated state has no `image`; its frames are only in `animation`.)
 */
export function statePreviewImage(state: PakObjectState | undefined): PakImageRef | undefined {
  return state?.image ?? state?.animation?.frames[0];
}

/**
 * Parses image("path.png") or image("path.png", x1, y1, x2, y2)
 */
export function parseImageDirective(line: string): PakImageRef | undefined {
  const match = line.match(/^image\s*\((.*?)\)/i);
  if (!match) return undefined;

  const args = parseArgs(match[1]);
  if (args.length === 0) return undefined;

  const file = stripQuotes(args[0]);
  if (!file) return undefined;

  if (args.length >= 5) {
    const x1 = parseInt(args[1], 10) || 0;
    const y1 = parseInt(args[2], 10) || 0;
    const x2 = parseInt(args[3], 10) || 0;
    const y2 = parseInt(args[4], 10) || 0;
    return { file, x1, y1, x2, y2 };
  }

  return { file, x1: 0, y1: 0 };
}

/** An inclusive range of line indices. */
interface LineSpan {
  start: number;
  end: number;
}

/** Where, within a state's source lines, each directive the Objects panel edits was written. */
interface StateLayout {
  header: LineSpan;
  /** image(...), empty-image(...), or animation(...) together with its frames. */
  sprite?: LineSpan;
  collisionMask?: LineSpan;
  selection?: LineSpan;
}

function isBlankOrComment(line: string): boolean {
  const t = line.trim();
  return !t || t.startsWith('#') || t.startsWith(';');
}

/**
 * The last line of the top-level block whose header is at `headerLine`: the last non-blank line
 * of the indented lines that follow it. Blank lines after the block aren't part of it.
 */
function lastBlockLine(lines: string[], headerLine: number): number {
  let last = headerLine;
  for (let i = headerLine + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (getIndentation(lines[i]) === 0) break;
    last = i;
  }
  return last;
}

/** Strips a trailing # comment outside double-quoted strings from a single line. */
function stripInlineComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Net count of '(' minus ')' on a line, ignoring strings and comments. */
function parenBalance(line: string): number {
  if (isBlankOrComment(line)) return 0;
  let balance = 0;
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '#') {
      break;
    } else if (c === '(') {
      balance++;
    } else if (c === ')') {
      balance--;
    }
  }
  return balance;
}

/**
 * Finds the last line of the directive that starts at `start`. PAKET ignores line breaks,
 * so a directive carries on over the following lines until its parentheses balance.
 */
function directiveEnd(lines: string[], start: number): number {
  let balance = parenBalance(lines[start]);
  let end = start;
  while (balance > 0 && end + 1 < lines.length) {
    end++;
    balance += parenBalance(lines[end]);
  }
  return end;
}

/** A directive's lines joined into one without inline # comments, so it can be matched like a single-line directive. */
function directiveText(lines: string[], span: LineSpan): string {
  return lines
    .slice(span.start, span.end + 1)
    .map(line => stripInlineComment(line).trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Parses one object state from its lines: optional blank or comment lines, then `state(...):`
 * and its body. Lines that aren't one of the directives the panel edits are kept in `rules`.
 */
function parseStateLines(stateLines: string[]): { state: PakObjectState; layout: StateLayout } | undefined {
  const headerIdx = stateLines.findIndex(line => !isBlankOrComment(line));
  if (headerIdx < 0) return undefined;
  const header: LineSpan = { start: headerIdx, end: directiveEnd(stateLines, headerIdx) };
  const headerMatch = directiveText(stateLines, header).match(/^state\s*\((.*?)\)\s*:/i);
  if (!headerMatch) return undefined;

  const stateArgs = parseArgs(headerMatch[1]);
  const layout: StateLayout = { header };
  let image: PakImageRef | undefined = undefined;
  let animation: PakAnimationRef | undefined = undefined;
  let collisionMask: string[] | undefined = undefined;
  let selectionType: PakObjectState['selectionType'] = undefined;
  const rules: string[] = [];

  let k = header.end + 1;
  while (k < stateLines.length) {
    if (!stateLines[k].trim()) {
      k++;
      continue;
    }

    const span: LineSpan = { start: k, end: directiveEnd(stateLines, k) };
    const t = directiveText(stateLines, span);

    if (/^image\s*\(/i.test(t)) {
      image = parseImageDirective(t);
      animation = undefined;
      layout.sprite = span;
    } else if (/^empty-image\s*\(/i.test(t)) {
      // A transparent sprite of a given size. It has no image to edit, but choosing one replaces it.
      image = undefined;
      animation = undefined;
      layout.sprite = span;
    } else if (/^animation\s*\(/i.test(t)) {
      // PAKET reads animation(tempo, frame, frame, ...): followed by one image(...) per distinct frame.
      const animArgs = parseArgs(t.match(/^animation\s*\((.*?)\)/i)?.[1] ?? '');
      const speed = parseInt(animArgs[0], 10) || 10;
      const sequence = animArgs.slice(1).map(s => parseInt(s, 10) || 0);
      const frameCount = sequence.length > 0 ? new Set(sequence).size : Infinity;
      const frames: PakImageRef[] = [];
      let imagesRead = 0;
      let j = span.end + 1;
      while (j < stateLines.length && imagesRead < frameCount) {
        if (isBlankOrComment(stateLines[j])) {
          j++;
          continue;
        }
        const frameSpan: LineSpan = { start: j, end: directiveEnd(stateLines, j) };
        const ft = directiveText(stateLines, frameSpan);
        if (!/^image\s*\(/i.test(ft)) break;
        if (frameCount === Infinity && getIndentation(stateLines[j]) <= getIndentation(stateLines[k])) break;
        const frame = parseImageDirective(ft);
        if (frame) frames.push(frame);
        imagesRead++;
        span.end = frameSpan.end;
        j = frameSpan.end + 1;
      }
      image = undefined;
      animation = { speed, sequence: sequence.length > 0 ? sequence : undefined, frames };
      layout.sprite = span;
    } else if (/^collisionmask\s*\(/i.test(t)) {
      const maskMatch = t.match(/^collisionmask\s*\((.*?)\)/i);
      collisionMask = maskMatch ? parseArgs(maskMatch[1]).map(stripQuotes) : undefined;
      layout.collisionMask = span;
    } else if (/^(?:selection|selection-type)\s*\(/i.test(t)) {
      const selMatch = t.match(/^(?:selection|selection-type)\s*\((.*?)\)/i);
      const val = stripQuotes(parseArgs(selMatch?.[1] ?? '')[0] ?? '').toLowerCase();
      if (val === 'pixel' || val === 'box' || val === 'none') {
        selectionType = val;
        layout.selection = span;
      } else {
        rules.push(...stateLines.slice(span.start, span.end + 1));
      }
    } else {
      rules.push(...stateLines.slice(span.start, span.end + 1));
    }
    k = span.end + 1;
  }

  return {
    state: {
      name: stripQuotes(stateArgs[0] || 'idle'),
      direction: stripQuotes(stateArgs[1] || 'front'),
      image,
      animation,
      collisionMask: collisionMask && collisionMask.length > 0 ? collisionMask : undefined,
      selectionType,
      rules
    },
    layout
  };
}

/**
 * Splits an object's body (the lines after its header) into states and object-level lines.
 * Blank and comment lines just before a state travel with that state; everything that isn't
 * part of a state (rules, comments after the last state) is kept verbatim in `rules`.
 */
/** An object body in file order: runs of object-level lines, and slots where a state was written. */
type ObjectBodyPart = { kind: 'lines'; lines: string[] } | { kind: 'state' };

function parseObjectBody(body: string[]): { states: PakObjectState[]; rules: string[]; parts: ObjectBodyPart[] } {
  const states: PakObjectState[] = [];
  const rules: string[] = [];
  const parts: ObjectBodyPart[] = [];
  const directImages: PakImageRef[] = [];
  let pending: string[] = [];

  const keepLines = (kept: string[]) => {
    if (kept.length === 0) return;
    rules.push(...kept);
    const last = parts[parts.length - 1];
    if (last?.kind === 'lines') last.lines.push(...kept);
    else parts.push({ kind: 'lines', lines: [...kept] });
  };

  let k = 0;
  while (k < body.length) {
    const line = body[k];
    const t = line.trim();

    if (isBlankOrComment(line)) {
      pending.push(line);
      k++;
      continue;
    }

    if (/^state\s*\(/i.test(t)) {
      const stateIndent = getIndentation(line);
      const stateLines = [...pending, line];
      pending = [];
      k++;
      // The state's body is everything indented deeper than state(...), plus the state directives
      // that follow it at any indentation (PAKET ignores indentation). Blank lines and shallower
      // comments only count as part of it when more of the body follows them.
      let held: string[] = [];
      while (k < body.length) {
        const bodyLine = body[k];
        if (getIndentation(bodyLine) > stateIndent || isStateDirective(bodyLine)) {
          const end = directiveEnd(body, k);
          stateLines.push(...held, ...body.slice(k, end + 1));
          held = [];
          k = end + 1;
        } else if (isBlankOrComment(bodyLine)) {
          held.push(bodyLine);
          k++;
        } else {
          break;
        }
      }
      pending = held;

      const parsed = parseStateLines(stateLines);
      if (parsed) {
        states.push({ ...parsed.state, source: stateLines });
        parts.push({ kind: 'state' });
      } else {
        keepLines(stateLines);
      }
      continue;
    }

    if (/^image\s*\(/i.test(t)) {
      // An image before any state isn't valid PAKET; it is shown in the panel as a default state, as before.
      const img = parseImageDirective(t);
      if (img) directImages.push(img);
      keepLines(pending);
    } else {
      keepLines([...pending, line]);
    }
    pending = [];
    k++;
  }
  keepLines(pending);

  if (states.length === 0 && directImages.length > 0) {
    states.push({ name: 'idle', direction: 'front', image: directImages[0], rules: [] });
  }

  return { states, rules, parts };
}

function isStateDirective(line: string): boolean {
  return /^(?:image|empty-image|animation|collisionmask|selection|selection-type)\s*\(/i.test(line.trim());
}

/** Where, within an item's block, each directive the Items panel edits was written. */
interface ItemLayout {
  header: LineSpan;
  image?: LineSpan;
  useMessage?: LineSpan;
}

/**
 * Parses the body of an item block (`block[0]` is its `item(...):` header). Lines other than
 * comments and the directives the panel edits are listed in `rules`.
 */
function parseItemBody(block: string[]): Pick<PakItem, 'image' | 'defaultUseMessage' | 'rules'> & { layout: ItemLayout } {
  const layout: ItemLayout = { header: { start: 0, end: 0 } };
  let image: PakImageRef | undefined = undefined;
  let defaultUseMessage: string | undefined = undefined;
  const rules: string[] = [];

  let k = 1;
  while (k < block.length) {
    if (isBlankOrComment(block[k])) {
      k++;
      continue;
    }
    const span: LineSpan = { start: k, end: directiveEnd(block, k) };
    const t = directiveText(block, span);

    if (/^image\s*\(/i.test(t)) {
      image = parseImageDirective(t) ?? image;
      layout.image = span;
    } else if (/^default-use-message\s*\(/i.test(t)) {
      const msgArgs = parseArgs(t.match(/^default-use-message\s*\((.*)\)/i)?.[1] ?? '');
      if (msgArgs.length > 0) defaultUseMessage = stripQuotes(msgArgs[0]);
      layout.useMessage = span;
    } else {
      rules.push(...block.slice(span.start, span.end + 1));
    }
    k = span.end + 1;
  }

  return { image, defaultUseMessage, rules, layout };
}

export interface ParseResult {
  items: PakItem[];
  objects: PakObject[];
  rooms: PakRoom[];
  errors: Array<{ line: number; message: string }>;
}

/**
 * Tolerant block parser for .pak files.
 * Extracts items, objects, and rooms while isolating syntax errors and preserving rule bodies.
 */
export function parsePakFile(content: string, filePath: string): ParseResult {
  const lines = content.split(/\r?\n/);
  const items: PakItem[] = [];
  const objects: PakObject[] = [];
  const rooms: PakRoom[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines and comment lines
    if (isBlankOrComment(line)) {
      i++;
      continue;
    }

    const indent = getIndentation(line);

    // Only inspect top-level definitions
    if (indent === 0) {
      const itemMatch = line.match(/^item\s*\((.*)\)\s*:/i);
      const objectMatch = line.match(/^object\s*\((.*)\)\s*:/i);
      const roomMatch = line.match(/^room\s*\((.*)\)\s*:/i);

      if (itemMatch) {
        const startLine = i;
        const rawArgs = itemMatch[1];
        const args = parseArgs(rawArgs);

        if (args.length < 3) {
          errors.push({
            line: startLine + 1,
            message: `Malformed item declaration on line ${startLine + 1}`
          });
        }

        const id = stripQuotes(args[0] || 'unknown-item');
        const name = stripQuotes(args[1] || id);
        const description = stripQuotes(args[2] || '');

        const lastContentLine = lastBlockLine(lines, startLine);
        i = lastContentLine + 1;

        const { image, defaultUseMessage, rules } = parseItemBody(lines.slice(startLine, lastContentLine + 1));

        items.push({
          id,
          name,
          description,
          image,
          defaultUseMessage,
          rules,
          filePath,
          startLine,
          endLine: lastContentLine
        });
        continue;
      }

      if (objectMatch) {
        const startLine = i;
        const rawArgs = objectMatch[1];
        const args = parseArgs(rawArgs);

        if (args.length < 3) {
          errors.push({
            line: startLine + 1,
            message: `Malformed object declaration on line ${startLine + 1}`
          });
        }

        const id = stripQuotes(args[0] || 'unknown-object');
        const name = stripQuotes(args[1] || id);
        const description = stripQuotes(args[2] || '');

        const lastContentLine = lastBlockLine(lines, startLine);
        i = lastContentLine + 1;

        const { states, rules: objectRules } = parseObjectBody(lines.slice(startLine + 1, lastContentLine + 1));

        objects.push({
          id,
          name,
          description,
          states,
          rules: objectRules,
          filePath,
          startLine,
          endLine: lastContentLine
        });
        continue;
      }

      if (roomMatch) {
        const startLine = i;
        const rawArgs = roomMatch[1];
        const args = parseArgs(rawArgs);

        if (args.length < 4) {
          errors.push({
            line: startLine + 1,
            message: `Malformed room declaration on line ${startLine + 1}`
          });
        }

        const id = stripQuotes(args[0] || 'unknown-room');
        const tmxFile = stripQuotes(args[1] || '');
        const x = parseInt(args[2], 10) || 0;
        const y = parseInt(args[3], 10) || 0;
        let subroom = false;
        const otherFlags: string[] = [];

        for (let a = 4; a < args.length; a++) {
          const mod = stripQuotes(args[a]).toLowerCase();
          if (mod === 'subroom') {
            subroom = true;
          } else if (mod) {
            otherFlags.push(args[a]);
          }
        }

        const lastContentLine = lastBlockLine(lines, startLine);
        i = lastContentLine + 1;
        // The rules are the body exactly as written, blank lines between them included.
        const rules = lines.slice(startLine + 1, lastContentLine + 1);

        rooms.push({
          id,
          tmxFile,
          x,
          y,
          subroom: subroom || undefined,
          otherFlags: otherFlags.length > 0 ? otherFlags : undefined,
          rules,
          filePath,
          startLine,
          endLine: lastContentLine
        });
        continue;
      }
    }

    i++;
  }

  return { items, objects, rooms, errors };
}

/**
 * Generates formatted PAKET code for an Item declaration.
 */
export function generateItemBlock(item: PakItem): string {
  const lines: string[] = [itemHeader(item)];

  if (item.image) {
    lines.push(`    ${imageDirective(item.image)}`);
  }
  if (item.defaultUseMessage) {
    lines.push(`    default-use-message("${item.defaultUseMessage}")`);
  }
  lines.push(...indentBodyLines(item.rules ?? [], '    '));

  return lines.join('\n');
}

function itemHeader(item: PakItem): string {
  // PAKET's item(...) takes an identifier, so the ID stays bare unless it couldn't be one.
  const idStr = item.id.includes(' ') ? `"${item.id}"` : item.id;
  return `item(${idStr}, "${item.name}", "${item.description}"):`;
}

/**
 * Generates formatted PAKET code for an Object declaration.
 */
export function generateObjectBlock(obj: PakObject): string {
  return [objectHeader(obj), ...objectBodyLines(obj)].join('\n');
}

function objectHeader(obj: PakObject): string {
  return `object("${obj.id}", "${obj.name}", "${obj.description}"):`;
}

function objectBodyLines(obj: PakObject): string[] {
  return [...obj.states.flatMap(renderState), ...indentBodyLines(obj.rules ?? [], '    ')];
}

function imageDirective(img: PakImageRef): string {
  return img.x2 !== undefined && img.y2 !== undefined
    ? `image("${img.file}", ${img.x1}, ${img.y1}, ${img.x2}, ${img.y2})`
    : `image("${img.file}")`;
}

/** The state's image(...) or animation(...) directive. An animation wins: it is what PAKET plays. */
function spriteLines(s: PakObjectState, indent: string): string[] {
  if (s.animation) {
    const { speed, sequence, frames } = s.animation;
    const frameOrder = sequence && sequence.length > 0 ? sequence : frames.map((_, idx) => idx);
    return [
      `${indent}animation(${speed}, ${frameOrder.join(', ')}):`,
      ...frames.map(f => `${indent}    ${imageDirective(f)}`)
    ];
  }
  return s.image ? [`${indent}${imageDirective(s.image)}`] : [];
}

function collisionMaskLines(s: PakObjectState, indent: string): string[] {
  if (!s.collisionMask || s.collisionMask.length === 0) return [];
  return [`${indent}collisionmask(${s.collisionMask.map(m => `"${m}"`).join(', ')})`];
}

function selectionLines(s: PakObjectState, indent: string): string[] {
  return s.selectionType ? [`${indent}selection(${s.selectionType})`] : [];
}

function generateStateLines(s: PakObjectState): string[] {
  const indent = '        ';
  return [
    `    state("${s.name}", "${s.direction}"):`,
    ...spriteLines(s, indent),
    ...collisionMaskLines(s, indent),
    ...selectionLines(s, indent),
    ...indentBodyLines(s.rules ?? [], indent)
  ];
}

/**
 * Writes a state. A state read from a file is written as its original lines, with only the
 * directives whose values changed replaced; anything else in it (comments, blank lines,
 * directives the panel doesn't edit) stays where it was. New states are generated.
 */
function renderState(s: PakObjectState): string[] {
  const parsed = s.source ? parseStateLines(s.source) : undefined;
  if (!s.source || !parsed) return generateStateLines(s);

  const { state: original, layout } = parsed;
  const editor = directiveEditor(s.source, layout.header, [layout.sprite, layout.collisionMask, layout.selection]);

  if (s.name !== original.name || s.direction !== original.direction) {
    editor.replace(layout.header, indent => [`${indent}state("${s.name}", "${s.direction}"):`]);
  }
  // New directives go where PAKET expects them: the sprite first, the mask after it.
  const afterHeader = layout.header.end + 1;
  const afterSprite = (layout.sprite ?? layout.header).end + 1;
  if (!sameValue([s.image, s.animation], [original.image, original.animation])) {
    editor.replaceOrInsert(layout.sprite, indent => spriteLines(s, indent), afterHeader);
  }
  if (!sameValue(s.collisionMask, original.collisionMask)) {
    editor.replaceOrInsert(layout.collisionMask, indent => collisionMaskLines(s, indent), afterSprite);
  }
  if (s.selectionType !== original.selectionType) {
    const afterLast = Math.max(afterSprite, (layout.collisionMask?.end ?? -1) + 1);
    editor.replaceOrInsert(layout.selection, indent => selectionLines(s, indent), afterLast);
  }

  return editor.result();
}

/**
 * Collects edits to a block's source lines and applies them together, so line numbers taken
 * from the original layout stay valid. Replacements keep the indentation of the lines they
 * replace; insertions use the block's directive indentation.
 */
function directiveEditor(source: string[], header: LineSpan, directives: Array<LineSpan | undefined>) {
  const indentAt = (lineIdx: number) => source[lineIdx].match(/^\s*/)?.[0] ?? '';
  const firstDirective = directives
    .filter((span): span is LineSpan => !!span)
    .sort((a, b) => a.start - b.start)[0];
  const bodyIndent = firstDirective ? indentAt(firstDirective.start) : `${indentAt(header.start)}    `;
  const edits: Array<{ at: number; remove: number; lines: string[] }> = [];

  const replace = (span: LineSpan, render: (indent: string) => string[]) => {
    edits.push({ at: span.start, remove: span.end - span.start + 1, lines: render(indentAt(span.start)) });
  };

  return {
    replace,
    /** Replaces the directive at `span`, or inserts it before line `insertAt` if it wasn't written. */
    replaceOrInsert(span: LineSpan | undefined, render: (indent: string) => string[], insertAt: number) {
      if (span) replace(span, render);
      else edits.push({ at: insertAt, remove: 0, lines: render(bodyIndent) });
    },
    result(): string[] {
      // Apply from the bottom up so earlier line numbers stay valid. Edits inserted at the same
      // line are applied last-first, so they end up in the order they were requested.
      const out = [...source];
      edits
        .map((edit, order) => ({ ...edit, order }))
        .sort((a, b) => b.at - a.at || b.order - a.order)
        .forEach(edit => out.splice(edit.at, edit.remove, ...edit.lines));
      return out;
    }
  };
}

/**
 * Inserts a declaration block after the last existing block of the same kind, or before the
 * earliest block in `beforeBlocks`, or appends at the end of the file.
 */
function insertBlockIntoContent(
  content: string,
  blockText: string,
  existingBlocks: Array<{ endLine: number }>,
  beforeBlocks: Array<{ startLine: number }>
): string {
  if (existingBlocks.length > 0) {
    let maxEndLine = -1;
    for (const block of existingBlocks) {
      if (block.endLine > maxEndLine) {
        maxEndLine = block.endLine;
      }
    }
    const lines = content.split(/\r?\n/);
    lines.splice(maxEndLine + 1, 0, '', blockText);
    return lines.join('\n');
  }

  if (beforeBlocks.length > 0) {
    let firstStartLine = Infinity;
    for (const block of beforeBlocks) {
      if (block.startLine < firstStartLine) {
        firstStartLine = block.startLine;
      }
    }
    const lines = content.split(/\r?\n/);
    const needsLeadingBlank = firstStartLine > 0 && lines[firstStartLine - 1].trim() !== '';
    if (needsLeadingBlank) {
      lines.splice(firstStartLine, 0, '', blockText, '');
    } else {
      lines.splice(firstStartLine, 0, blockText, '');
    }
    return lines.join('\n');
  }

  const trimmed = content.trimEnd();
  return trimmed ? `${trimmed}\n\n${blockText}\n` : `${blockText}\n`;
}

/**
 * Inserts a new item after the last existing item in content, before objects/rooms if none exist,
 * or appends at the end.
 */
export function insertItemIntoContent(content: string, item: PakItem): string {
  const { items, objects, rooms } = parsePakFile(content, item.filePath);
  return insertBlockIntoContent(content, generateItemBlock(item), items, [...objects, ...rooms]);
}

/**
 * Updates an existing item block in content by replacing its line range.
 */
export function updateItemInContent(content: string, item: PakItem, targetId: string): string {
  const { items } = parsePakFile(content, item.filePath);
  const matched = items.find(it => it.id === targetId);
  const lines = content.split(/\r?\n/);

  if (matched) {
    lines.splice(matched.startLine, matched.endLine - matched.startLine + 1, ...renderItemOver(item, matched, lines));
    return lines.join('\n');
  }

  const { startLine, endLine } = item;
  if (startLine >= 0 && endLine >= startLine && startLine < lines.length) {
    lines.splice(startLine, endLine - startLine + 1, ...generateItemBlock(item).split('\n'));
    return lines.join('\n');
  }

  // Fallback if line range was invalid
  return insertItemIntoContent(content, item);
}

/**
 * Renders an item for saving over `original` (the same item as currently parsed from `lines`).
 * Only the header and directives whose values changed are rewritten. The Items panel doesn't
 * edit rules, so they always stay as written.
 */
function renderItemOver(item: PakItem, original: PakItem, lines: string[]): string[] {
  const block = lines.slice(original.startLine, original.endLine + 1);
  const { layout } = parseItemBody(block);
  const editor = directiveEditor(block, layout.header, [layout.image, layout.useMessage]);

  if (item.id !== original.id || item.name !== original.name || item.description !== original.description) {
    editor.replace(layout.header, () => [itemHeader(item)]);
  }
  if (!sameValue(item.image, original.image)) {
    editor.replaceOrInsert(layout.image, indent => (item.image ? [`${indent}${imageDirective(item.image)}`] : []), layout.header.end + 1);
  }
  if (item.defaultUseMessage !== original.defaultUseMessage) {
    editor.replaceOrInsert(
      layout.useMessage,
      indent => (item.defaultUseMessage ? [`${indent}default-use-message("${item.defaultUseMessage}")`] : []),
      (layout.image ?? layout.header).end + 1
    );
  }

  return editor.result();
}

/**
 * Deletes an item declaration block from content.
 */
export function deleteItemFromContent(content: string, targetId: string, filePath: string): string {
  const { items } = parsePakFile(content, filePath);
  const matched = items.find(it => it.id === targetId);
  if (!matched) return content;

  const lines = content.split(/\r?\n/);
  let count = matched.endLine - matched.startLine + 1;
  if (matched.startLine + count < lines.length && lines[matched.startLine + count].trim() === '') {
    count++;
  }
  lines.splice(matched.startLine, count);
  return lines.join('\n');
}

/**
 * Inserts a new object after the last existing object in content, before rooms if none exist,
 * or appends at the end.
 */
export function insertObjectIntoContent(content: string, obj: PakObject): string {
  const { objects, rooms } = parsePakFile(content, obj.filePath);
  return insertBlockIntoContent(content, generateObjectBlock(obj), objects, rooms);
}

/**
 * Renders an object for saving over `original` (the same object as currently parsed from `lines`).
 * The body is rebuilt in its original order: the panel's states fill the places where states were
 * written, and object-level lines (rules, comments) stay where they are, since the Objects panel
 * doesn't edit them. States added in the panel go after the last existing one.
 */
function renderObjectOver(obj: PakObject, original: PakObject, lines: string[]): string[] {
  if (sameValue(objectContent(obj), objectContent(original))) {
    return lines.slice(original.startLine, original.endLine + 1);
  }
  const sameHeader = obj.id === original.id && obj.name === original.name && obj.description === original.description;
  const { parts } = parseObjectBody(lines.slice(original.startLine + 1, original.endLine + 1));
  const states = obj.states.map(renderState);
  const slots = parts.filter(part => part.kind === 'state').length;
  const addedStates = states.slice(slots).flat();
  const lastSlot = parts.map(part => part.kind).lastIndexOf('state');

  const body: string[] = lastSlot < 0 ? [...addedStates] : [];
  let nextState = 0;
  parts.forEach((part, idx) => {
    if (part.kind === 'lines') body.push(...part.lines);
    else body.push(...(states[nextState++] ?? []));
    if (idx === lastSlot) body.push(...addedStates);
  });

  return [sameHeader ? lines[original.startLine] : objectHeader(obj), ...body];
}

/**
 * Updates an existing object block in content by replacing its line range.
 */
export function updateObjectInContent(content: string, obj: PakObject, targetId: string): string {
  const { objects } = parsePakFile(content, obj.filePath);
  const matched = objects.find(o => o.id === targetId);
  const lines = content.split(/\r?\n/);

  if (matched) {
    lines.splice(matched.startLine, matched.endLine - matched.startLine + 1, ...renderObjectOver(obj, matched, lines));
    return lines.join('\n');
  }

  const { startLine, endLine } = obj;
  if (startLine >= 0 && endLine >= startLine && startLine < lines.length) {
    lines.splice(startLine, endLine - startLine + 1, ...generateObjectBlock(obj).split('\n'));
    return lines.join('\n');
  }

  return insertObjectIntoContent(content, obj);
}

/**
 * Deletes an object declaration block from content.
 */
export function deleteObjectFromContent(content: string, targetId: string, filePath: string): string {
  const { objects } = parsePakFile(content, filePath);
  const matched = objects.find(o => o.id === targetId);
  if (!matched) return content;

  const lines = content.split(/\r?\n/);
  let count = matched.endLine - matched.startLine + 1;
  if (matched.startLine + count < lines.length && lines[matched.startLine + count].trim() === '') {
    count++;
  }
  lines.splice(matched.startLine, count);
  return lines.join('\n');
}

/**
 * Generates formatted PAKET code for a Room declaration.
 */
export function generateRoomBlock(room: PakRoom): string {
  const lines: string[] = [];
  // PAKET's room(...) requires a string ID, so it is always quoted (unlike item IDs, which are identifiers).
  const idStr = `"${room.id}"`;
  const tmxStr = `"${room.tmxFile}"`;
  const flags = [...(room.subroom ? ['subroom'] : []), ...(room.otherFlags ?? [])];
  const flagsStr = flags.map(f => `, ${f}`).join('');
  lines.push(`room(${idStr}, ${tmxStr}, ${room.x}, ${room.y}${flagsStr}):`);
  lines.push(...indentBodyLines(room.rules ?? [], '    '));

  return lines.join('\n');
}

/**
 * Inserts a new room after the last existing room in content, or appends at the end.
 */
export function insertRoomIntoContent(content: string, room: PakRoom): string {
  const { rooms } = parsePakFile(content, room.filePath);
  return insertBlockIntoContent(content, generateRoomBlock(room), rooms, []);
}

/**
 * Renders a room for saving over `original` (the same room as currently parsed from `lines`).
 * The header and the rules body are each kept exactly as written unless the room changed them.
 */
function renderRoomOver(room: PakRoom, original: PakRoom, lines: string[]): string[] {
  const generated = generateRoomBlock(room).split('\n');
  const sameHeader =
    room.id === original.id &&
    room.tmxFile === original.tmxFile &&
    room.x === original.x &&
    room.y === original.y &&
    !!room.subroom === !!original.subroom &&
    sameValue(room.otherFlags ?? [], original.otherFlags ?? []);
  const sameRules = sameBodyLines(room.rules, original.rules);

  const header = sameHeader ? [lines[original.startLine]] : generated.slice(0, 1);
  const body = sameRules ? lines.slice(original.startLine + 1, original.endLine + 1) : generated.slice(1);
  return [...header, ...body];
}

/**
 * Updates an existing room declaration block in content by replacing its line range.
 */
export function updateRoomInContent(content: string, room: PakRoom, targetId: string): string {
  const { rooms } = parsePakFile(content, room.filePath);
  const matched = rooms.find(r => r.id === targetId);
  const lines = content.split(/\r?\n/);

  if (matched) {
    lines.splice(matched.startLine, matched.endLine - matched.startLine + 1, ...renderRoomOver(room, matched, lines));
    return lines.join('\n');
  }

  const { startLine, endLine } = room;
  if (startLine >= 0 && endLine >= startLine && startLine < lines.length) {
    lines.splice(startLine, endLine - startLine + 1, ...generateRoomBlock(room).split('\n'));
    return lines.join('\n');
  }

  return insertRoomIntoContent(content, room);
}

/**
 * Deletes a room declaration block from content.
 */
export function deleteRoomFromContent(content: string, targetId: string, filePath: string): string {
  const { rooms } = parsePakFile(content, filePath);
  const matched = rooms.find(r => r.id === targetId);
  if (!matched) return content;

  const lines = content.split(/\r?\n/);
  let count = matched.endLine - matched.startLine + 1;
  if (matched.startLine + count < lines.length && lines[matched.startLine + count].trim() === '') {
    count++;
  }
  lines.splice(matched.startLine, count);
  return lines.join('\n');
}

export interface ParsedCustomPalette {
  platform: 'cpc' | 'msx';
  colors: Array<{ r: number; g: number; b: number }>;
  tolerance?: number;
  filePath: string;
  startLine: number;
  endLine: number;
}

/**
 * Parses any cpc-rgb-palette: or msx-screen2-rgb-palette: directive and palette-rgb-tolerance(N)
 * defined in a .pak file.
 */
export function parseCustomPaletteFromContent(content: string, filePath: string): ParsedCustomPalette | null {
  const lines = content.split(/\r?\n/);
  let tolerance: number | undefined = undefined;

  for (const line of lines) {
    const tolMatch = line.match(/^\s*palette-rgb-tolerance\s*\(\s*(\d+)\s*\)/i);
    if (tolMatch) {
      tolerance = parseInt(tolMatch[1], 10);
      break;
    }
  }

  let palStart = -1;
  let detectedPlatform: 'cpc' | 'msx' | null = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^cpc-rgb-palette\s*:/i.test(trimmed)) {
      palStart = i;
      detectedPlatform = 'cpc';
      break;
    } else if (/^msx-screen2-rgb-palette\s*:/i.test(trimmed)) {
      palStart = i;
      detectedPlatform = 'msx';
      break;
    }
  }

  if (palStart === -1 || !detectedPlatform) {
    return null;
  }

  const expectedCount = detectedPlatform === 'cpc' ? 27 : 16;
  const colors: Array<{ r: number; g: number; b: number }> = [];
  let endLine = palStart;

  for (let i = palStart + 1; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Skip empty lines and comment lines
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      continue;
    }

    // If we hit another section/directive keyword like "room:", stop
    if (trimmed.includes(':') && !trimmed.includes(',')) {
      break;
    }

    const parts = trimmed.split(',').map(s => parseInt(s.trim(), 10));
    if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      colors.push({
        r: Math.max(0, Math.min(255, parts[0])),
        g: Math.max(0, Math.min(255, parts[1])),
        b: Math.max(0, Math.min(255, parts[2]))
      });
      endLine = i;
      if (colors.length >= expectedCount) {
        break;
      }
    }
  }

  return {
    platform: detectedPlatform,
    colors,
    tolerance,
    filePath,
    startLine: palStart,
    endLine
  };
}

/**
 * Updates or appends a custom palette block in .pak file content.
 */
export function updateCustomPaletteInContent(
  content: string,
  platform: 'cpc' | 'cpc6128' | 'msx' | 'msxmegarom' | 'msx-wt',
  colors: Array<{ r: number; g: number; b: number }>,
  tolerance?: number
): string {
  const isMsx = platform.startsWith('msx');
  const directive = isMsx ? 'msx-screen2-rgb-palette:' : 'cpc-rgb-palette:';

  const blockLines: string[] = [];
  if (tolerance !== undefined) {
    blockLines.push(`palette-rgb-tolerance(${tolerance})`);
  }
  blockLines.push(directive);
  for (const c of colors) {
    blockLines.push(`  ${c.r}, ${c.g}, ${c.b}`);
  }

  const lines = content.split(/\r?\n/);

  // Check if an existing tolerance directive exists to replace/remove
  let existingTolLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*palette-rgb-tolerance\s*\(/i.test(lines[i])) {
      existingTolLine = i;
      break;
    }
  }

  // Check if an existing palette block exists
  let palStart = -1;
  let palEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^(cpc-rgb-palette|msx-screen2-rgb-palette)\s*:/i.test(trimmed)) {
      palStart = i;
      palEnd = i;
      for (let j = i + 1; j < lines.length; j++) {
        const nextTrimmed = lines[j].trim();
        if (!nextTrimmed) continue;
        if (nextTrimmed.includes(':') && !nextTrimmed.includes(',')) break;
        if (nextTrimmed.split(',').length >= 3) {
          palEnd = j;
        }
      }
      break;
    }
  }

  if (palStart !== -1) {
    // If tolerance was right before palette, include it in replacement range
    let replaceStart = palStart;
    if (existingTolLine === palStart - 1) {
      replaceStart = existingTolLine;
    } else if (existingTolLine !== -1) {
      // Remove tolerance line separately if it was elsewhere
      lines.splice(existingTolLine, 1);
      if (existingTolLine < palStart) {
        palStart--;
        palEnd--;
        replaceStart = palStart;
      }
    }

    lines.splice(replaceStart, palEnd - replaceStart + 1, ...blockLines);
    return lines.join('\n');
  }

  // If no palette block existed, remove lone tolerance line if any
  if (existingTolLine !== -1) {
    lines.splice(existingTolLine, 1);
  }

  // Append to the end
  const trimmedContent = content.trimEnd();
  return trimmedContent + '\n\n' + blockLines.join('\n') + '\n';
}

/**
 * Removes any custom palette directives from content, restoring default platform colors.
 */
export function removeCustomPaletteFromContent(content: string): string {
  const lines = content.split(/\r?\n/);
  const result: string[] = [];
  let inPaletteBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^\s*palette-rgb-tolerance\s*\(/i.test(trimmed)) {
      continue;
    }

    if (/^(cpc-rgb-palette|msx-screen2-rgb-palette)\s*:/i.test(trimmed)) {
      inPaletteBlock = true;
      continue;
    }

    if (inPaletteBlock) {
      if (trimmed.includes(':') && !trimmed.includes(',')) {
        inPaletteBlock = false;
        result.push(line);
      } else if (trimmed.split(',').length >= 3) {
        continue;
      } else if (!trimmed) {
        continue;
      } else {
        inPaletteBlock = false;
        result.push(line);
      }
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}
