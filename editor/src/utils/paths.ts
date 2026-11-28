/**
 * Normalizes a file or folder path by converting backslashes to forward slashes,
 * collapsing duplicate slashes, and removing trailing slashes (except root '/').
 */
export function normalizePath(p: string | null | undefined): string {
  if (!p) return '';
  const converted = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (converted.length > 1 && converted.endsWith('/')) {
    return converted.slice(0, -1);
  }
  return converted;
}

/**
 * The folder part of a path ("a/b/c.tmx" -> "a/b"), splitting on either separator;
 * '' if the path has no folder part. Separators are left as they are.
 */
export function parentDir(p: string): string {
  const sep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return sep >= 0 ? p.slice(0, sep) : '';
}

/** "/a/b", "\a\b" or "C:/a/b": Tiled writes an absolute path when a file is on another drive. */
export function isAbsolutePath(p: string): boolean {
  return /^([\\/]|[A-Za-z]:[\\/])/.test(p);
}

/**
 * Checks if two paths are equivalent, taking into account path separators,
 * double slashes, trailing slashes, and case-insensitivity.
 */
export function isSamePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

/**
 * Computes a forward-slash path to `targetPath` relative to `fromDir`
 * (both relative to the same root, e.g. projectPath).
 */
export function relativePathFromDir(fromDir: string, targetPath: string): string {
  const fromParts = normalizePath(fromDir).split('/').filter(Boolean);
  const toParts = normalizePath(targetPath).split('/').filter(Boolean);
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length - 1 &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const up = new Array<string>(fromParts.length - common).fill('..');
  return [...up, ...toParts.slice(common)].join('/');
}

