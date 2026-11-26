import { describe, it, expect } from 'vitest';
import type { EditorTab } from '../types';
import { copiesAfterSavingAll, copiesAfterTextSave, latestPakContent, viewTypeForFileName } from './workspaceFiles';

function codeTab(filePath: string, content: string, isDirty = false): EditorTab {
  return { id: filePath, filePath, title: filePath.split('/').pop() ?? filePath, content, isDirty, viewType: 'code' };
}

describe('which copy of a .pak file a panel edits', () => {
  it('edits the text in the open tab, which is newer than an earlier panel copy', () => {
    const panelCopies = { 'cpc/game.pak': { content: 'copy from an earlier panel edit', isDirty: false } };
    const tabs = [codeTab('/projects/demo/cpc/game.pak', 'text typed in the code editor', true)];

    expect(latestPakContent('cpc/game.pak', panelCopies, tabs)).toBe('text typed in the code editor');
  });

  it("edits the panels' own copy when the file isn't open in a tab", () => {
    const panelCopies = { 'cpc/game.pak': { content: 'unsaved panel edit', isDirty: true } };

    expect(latestPakContent('cpc/game.pak', panelCopies, [])).toBe('unsaved panel edit');
  });

  it('edits the saved text after the code editor saves the file and its tab is closed', () => {
    const panelCopies = { 'cpc/game.pak': { content: 'copy from an earlier panel edit', isDirty: false } };

    const afterSave = copiesAfterTextSave(panelCopies, '/projects/demo/cpc/game.pak', 'text saved from the tab');

    expect(latestPakContent('cpc/game.pak', afterSave, [])).toBe('text saved from the tab');
  });

  it('leaves the copies of other files alone when one is saved', () => {
    const panelCopies = {
      'cpc/game.pak': { content: 'game', isDirty: false },
      'cpc/rooms.pak': { content: 'rooms', isDirty: true },
    };

    expect(copiesAfterTextSave(panelCopies, '/projects/demo/cpc/game.pak', 'saved game')).toEqual({
      'cpc/game.pak': { content: 'saved game', isDirty: false },
      'cpc/rooms.pak': { content: 'rooms', isDirty: true },
    });
  });

  it('edits the saved text after Save All, when the tab held newer text than the panel copy', () => {
    // A panel edit made the copy; then text was typed in the tab, and Save All wrote both (the tab last).
    const panelCopies = { 'cpc/game.pak': { content: 'panel edit', isDirty: true } };
    const savedTabs = [{ filePath: '/projects/demo/cpc/game.pak', content: 'panel edit + typed text' }];

    const afterSaveAll = copiesAfterSavingAll(panelCopies, savedTabs, []);

    expect(afterSaveAll).toEqual({ 'cpc/game.pak': { content: 'panel edit + typed text', isDirty: false } });
  });

  it('keeps a copy that Save All failed to write, still unsaved', () => {
    const panelCopies = {
      'cpc/game.pak': { content: 'saved', isDirty: true },
      'cpc/rooms.pak': { content: 'write failed', isDirty: true },
    };

    expect(copiesAfterSavingAll(panelCopies, [], ['cpc/rooms.pak'])).toEqual({
      'cpc/game.pak': { content: 'saved', isDirty: false },
      'cpc/rooms.pak': { content: 'write failed', isDirty: true },
    });
  });

  it('only uses a tab whose path ends with the whole file path', () => {
    const tabs = [codeTab('/projects/demo/cpc/myrooms.pak', 'a different file')];

    expect(latestPakContent('rooms.pak', {}, tabs)).toBeUndefined();
  });

  it('finds the tab of a file opened with a Windows path', () => {
    const tabs = [codeTab('C:\\projects\\demo\\cpc\\rooms.pak', 'rooms text')];

    expect(latestPakContent('cpc/rooms.pak', {}, tabs)).toBe('rooms text');
  });
});

describe('how a file opens in a tab', () => {
  it('opens images in the pixel editor, so they are saved as binary', () => {
    expect(viewTypeForFileName('sprites.png')).toBe('image');
    expect(viewTypeForFileName('TILES.PNG')).toBe('image');
  });

  it('opens .pak and other text files in the code editor', () => {
    expect(viewTypeForFileName('game.pak')).toBe('code');
    expect(viewTypeForFileName('Makefile')).toBe('code');
  });
});
