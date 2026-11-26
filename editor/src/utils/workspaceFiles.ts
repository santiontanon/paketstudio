import type { EditorTab, TabViewType } from '../types';
import { BINARY_EXTENSIONS } from '../constants';
import { normalizePath } from './paths';

/** The panels' in-memory copies of .pak files, keyed by path relative to the project. */
export type PakCopies = Record<string, { content: string; isDirty: boolean }>;

/** Whether `filePath` (absolute, any separator) is the file at `relPath` in the project. */
export function isSameProjectFile(filePath: string, relPath: string): boolean {
  const full = normalizePath(filePath);
  const rel = normalizePath(relPath);
  return full === rel || full.endsWith(`/${rel}`);
}

/**
 * The newest text of a .pak file held in the editor, or undefined when only the copy on disk exists.
 * An open tab wins over the panels' copy: panel edits are written into the tab as well, and text
 * typed in the tab is newer than anything the panels hold.
 */
export function latestPakContent(relPath: string, copies: PakCopies, tabs: EditorTab[]): string | undefined {
  const tab = tabs.find(t => isSameProjectFile(t.filePath, relPath));
  if (tab) return tab.content;
  return copies[relPath]?.content;
}

/**
 * Updates the panels' copy of a file the code editor has just saved to the saved text, so the
 * panels don't later edit (and save) their older copy over it.
 */
export function copiesAfterTextSave(copies: PakCopies, savedFilePath: string, savedContent: string): PakCopies {
  return Object.fromEntries(
    Object.entries(copies).map(([relPath, copy]) =>
      isSameProjectFile(savedFilePath, relPath) ? [relPath, { content: savedContent, isDirty: false }] : [relPath, copy]
    )
  );
}

/**
 * The panels' copies after Save All has written every unsaved copy and then every unsaved tab.
 * Each copy now holds what is on disk: its tab's text if that tab was saved after it. A copy
 * that failed to write (and has no saved tab) stays unsaved.
 */
export function copiesAfterSavingAll(
  copies: PakCopies,
  savedTabs: Array<{ filePath: string; content: string }>,
  failedRelPaths: string[]
): PakCopies {
  let result: PakCopies = Object.fromEntries(
    Object.entries(copies).map(([relPath, copy]) => [relPath, { ...copy, isDirty: copy.isDirty && failedRelPaths.includes(relPath) }])
  );
  for (const tab of savedTabs) {
    result = copiesAfterTextSave(result, tab.filePath, tab.content);
  }
  return result;
}

/** Opens images and other binary files in the pixel editor (saved as binary), everything else as code. */
export function viewTypeForFileName(fileName: string): TabViewType {
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : '';
  return BINARY_EXTENSIONS.has(ext) ? 'image' : 'code';
}
