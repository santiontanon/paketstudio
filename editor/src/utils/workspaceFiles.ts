import type { EditorTab, TabViewType } from '../types';
import { BINARY_EXTENSIONS } from '../constants';
import { isAbsolutePath, isSamePath } from './paths';

/** The panels' in-memory copies of .pak files, keyed by path relative to the project. */
export type PakCopies = Record<string, { content: string; isDirty: boolean }>;

/**
 * Whether `filePath` (absolute or project-relative, any separator) refers to `relPath`
 * inside `projectPath`.
 */
export function isSameProjectFile(filePath: string, relPath: string, projectPath: string): boolean {
  const target = isAbsolutePath(relPath) ? relPath : `${projectPath}/${relPath}`;
  return isSamePath(filePath, target) || isSamePath(filePath, relPath);
}

/**
 * The newest text of a .pak file held in the editor, or undefined when only the copy on disk exists.
 * An open tab wins over the panels' copy: panel edits are written into the tab as well, and text
 * typed in the tab is newer than anything the panels hold.
 */
export function latestPakContent(
  relPath: string,
  copies: PakCopies,
  tabs: EditorTab[],
  projectPath: string
): string | undefined {
  const tab = tabs.find(t => isSameProjectFile(t.filePath, relPath, projectPath));
  if (tab) return tab.content;
  return copies[relPath]?.content;
}

/**
 * Returns the panels' unsaved text for `filePath` if one exists, or undefined when the file
 * should be read from disk. Used whenever a file is opened into a tab so the new tab starts
 * with any unsaved panel edits rather than stale disk text.
 */
export function dirtyPakCopyForPath(
  filePath: string,
  copies: PakCopies,
  projectPath: string
): string | undefined {
  for (const [relPath, copy] of Object.entries(copies)) {
    if (copy.isDirty && isSameProjectFile(filePath, relPath, projectPath)) {
      return copy.content;
    }
  }
  return undefined;
}

/**
 * Updates the panels' copy of a file the code editor has just saved to the saved text, so the
 * panels don't later edit (and save) their older copy over it.
 */
export function copiesAfterTextSave(
  copies: PakCopies,
  savedFilePath: string,
  savedContent: string,
  projectPath: string
): PakCopies {
  return Object.fromEntries(
    Object.entries(copies).map(([relPath, copy]) =>
      isSameProjectFile(savedFilePath, relPath, projectPath)
        ? [relPath, { content: savedContent, isDirty: false }]
        : [relPath, copy]
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
  failedRelPaths: string[],
  projectPath: string
): PakCopies {
  let result: PakCopies = Object.fromEntries(
    Object.entries(copies).map(([relPath, copy]) => [relPath, { ...copy, isDirty: copy.isDirty && failedRelPaths.includes(relPath) }])
  );
  for (const tab of savedTabs) {
    result = copiesAfterTextSave(result, tab.filePath, tab.content, projectPath);
  }
  return result;
}

/** Opens images and other binary files in the pixel editor (saved as binary), everything else as code. */
export function viewTypeForFileName(fileName: string): TabViewType {
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : '';
  return BINARY_EXTENSIONS.has(ext) ? 'image' : 'code';
}
