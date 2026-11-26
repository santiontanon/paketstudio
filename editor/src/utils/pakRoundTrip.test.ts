import { describe, it, expect } from 'vitest';
import { parsePakFile, updateItemInContent, updateObjectInContent, updateRoomInContent } from './pakParser';

// Saving a room, object or item from the panels without editing it must not change the file.

const tutorial5 = import.meta.glob<string>('./__fixtures__/tutorial5/*.pak', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// Every example in PAKET itself, when the paket repository is checked out next to paketstudio.
const paketExamples = import.meta.glob<string>('../../../../paket/examples/**/*.pak', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Saves each room, object and item in `content` unedited, and lists those that changed the file. */
function blocksChangedByUneditedSave(content: string, path: string): string[] {
  const { rooms, objects, items } = parsePakFile(content, path);
  return [
    ...rooms.filter(r => updateRoomInContent(content, r, r.id) !== content).map(r => `room ${r.id}`),
    ...objects.filter(o => updateObjectInContent(content, o, o.id) !== content).map(o => `object ${o.id}`),
    ...items.filter(it => updateItemInContent(content, it, it.id) !== content).map(it => `item ${it.id}`),
  ];
}

describe('saving without edits, tutorial 5', () => {
  it('finds the tutorial files', () => {
    expect(Object.keys(tutorial5)).toHaveLength(4);
  });

  it.each(Object.entries(tutorial5))('%s is left unchanged', (path, content) => {
    expect(blocksChangedByUneditedSave(content, path)).toEqual([]);
  });
});

describe.skipIf(Object.keys(paketExamples).length === 0)('saving without edits, PAKET examples', () => {
  it.each(Object.entries(paketExamples))('%s is left unchanged', (path, content) => {
    expect(blocksChangedByUneditedSave(content, path)).toEqual([]);
  });
});
