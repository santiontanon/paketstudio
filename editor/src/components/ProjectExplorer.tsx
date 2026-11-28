import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  FileCode2, 
  Map, 
  Image as ImageIcon, 
  FileText, 
  Folder, 
  FolderOpen, 
  FolderPlus,
  ChevronRight, 
  ChevronDown, 
  Search,
  Layers,
  Sparkles,
  FolderTree,
  FilePlus,
  Package,
  Box,
  DoorOpen,
  Edit2,
  Trash2,
  AlertTriangle,
  X
} from 'lucide-react';
import type { FileNode } from '../types';
import { STORAGE_KEYS, IGNORED_NAMES, IMAGE_EXTENSIONS } from '../constants';

interface ProjectExplorerProps {
  files: FileNode[];
  onFileSelect: (file: FileNode) => void;
  activeFilePath?: string;
  projectPath: string | null;
  onOpenFolder: () => void;
  onNewProject: () => void;
  onNewFile: () => void;
  onRenameFile: (file: FileNode, newName: string) => Promise<void>;
  onDeleteFile: (file: FileNode) => Promise<void>;
  itemsCount: number;
  objectsCount: number;
  roomsCount: number;
  onOpenItemInspector: () => void;
  onOpenObjectInspector: () => void;
  onOpenRoomInspector: () => void;
  width?: number;
}

interface TreeNode {
  name: string;
  path: string;
  relativePath: string;
  isDir: boolean;
  file?: FileNode;
  children: Record<string, TreeNode>;
}

export const ProjectExplorer: React.FC<ProjectExplorerProps> = ({
  files,
  onFileSelect,
  activeFilePath,
  projectPath,
  onOpenFolder,
  onNewProject,
  onNewFile,
  onRenameFile,
  onDeleteFile,
  itemsCount,
  objectsCount,
  roomsCount,
  onOpenItemInspector,
  onOpenObjectInspector,
  onOpenRoomInspector,
  width
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<'tree' | 'categories'>(() => {
    return (localStorage.getItem(STORAGE_KEYS.EXPLORER_VIEW) as 'tree' | 'categories') || 'tree';
  });

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileNode } | null>(null);
  const [fileToRename, setFileToRename] = useState<FileNode | null>(null);
  const [newFileName, setNewFileName] = useState<string>('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [fileToDelete, setFileToDelete] = useState<FileNode | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Close context menu on outside click or escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleDismiss = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', handleDismiss);
    window.addEventListener('contextmenu', handleDismiss);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleDismiss);
      window.removeEventListener('contextmenu', handleDismiss);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  // Focus rename input and preselect base name without extension
  useEffect(() => {
    if (fileToRename && renameInputRef.current) {
      renameInputRef.current.focus();
      const dotIndex = fileToRename.name.lastIndexOf('.');
      if (dotIndex > 0) {
        renameInputRef.current.setSelectionRange(0, dotIndex);
      } else {
        renameInputRef.current.select();
      }
    }
  }, [fileToRename]);

  // Close modals on Escape key
  useEffect(() => {
    if (!fileToRename && !fileToDelete) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isRenaming) setFileToRename(null);
        if (!isDeleting) setFileToDelete(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [fileToRename, fileToDelete, isRenaming, isDeleting]);

  const handleContextMenu = (e: React.MouseEvent, file: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 170);
    const y = Math.min(e.clientY, window.innerHeight - 90);
    setContextMenu({ x, y, file });
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileToRename) return;
    const trimmed = newFileName.trim();
    if (!trimmed) {
      setRenameError('File name cannot be empty.');
      return;
    }
    if (trimmed === fileToRename.name) {
      setFileToRename(null);
      return;
    }
    if (/[/\\?%*:|"<>]/g.test(trimmed)) {
      setRenameError('File name contains invalid characters.');
      return;
    }

    const parentDir = fileToRename.relative_path.includes('/')
      ? fileToRename.relative_path.substring(0, fileToRename.relative_path.lastIndexOf('/') + 1)
      : '';
    const newRelPath = `${parentDir}${trimmed}`;
    const exists = files.some(
      f => f.relative_path.toLowerCase() === newRelPath.toLowerCase() && f.path !== fileToRename.path
    );
    if (exists) {
      setRenameError(`A file named "${trimmed}" already exists in this folder.`);
      return;
    }

    try {
      setIsRenaming(true);
      setRenameError(null);
      await onRenameFile(fileToRename, trimmed);
      setIsRenaming(false);
      setFileToRename(null);
    } catch (err: any) {
      setIsRenaming(false);
      setRenameError(err?.message || (typeof err === 'string' ? err : 'Failed to rename file.'));
    }
  };

  const handleDeleteSubmit = async () => {
    if (!fileToDelete) return;
    try {
      setIsDeleting(true);
      setDeleteError(null);
      await onDeleteFile(fileToDelete);
      setIsDeleting(false);
      setFileToDelete(null);
    } catch (err: any) {
      setIsDeleting(false);
      setDeleteError(err?.message || (typeof err === 'string' ? err : 'Failed to delete file.'));
    }
  };

  // Reset expanded folders to unexpanded by default when opening or switching projects
  useEffect(() => {
    setExpandedFolders({});
  }, [projectPath]);

  const handleSetViewMode = (mode: 'tree' | 'categories') => {
    setViewMode(mode);
    localStorage.setItem(STORAGE_KEYS.EXPLORER_VIEW, mode);
  };

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const toggleFolder = (folderPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => ({ ...prev, [folderPath]: !prev[folderPath] }));
  };

  const getFileIcon = (ext: string) => {
    const e = ext.toLowerCase();
    if (e === 'pak') return <FileCode2 size={15} className="icon-pak" />;
    if (e === 'tmx') return <Map size={15} className="icon-tmx" />;
    if (IMAGE_EXTENSIONS.has(e)) return <ImageIcon size={15} className="icon-img" />;
    if (['asm', 's', 'z80'].includes(e)) return <FileCode2 size={15} className="icon-asm" />;
    return <FileText size={15} className="icon-default" />;
  };

  // Filter out OS junk files (.DS_Store, Thumbs.db, hidden files) and apply search filter
  const filteredFiles = useMemo(() => {
    return files.filter(f => {
      const lowerName = f.name.toLowerCase();
      if (IGNORED_NAMES.has(lowerName) || f.name.startsWith('.')) {
        return false;
      }
      if (f.is_dir) return false;
      return f.relative_path.toLowerCase().includes(searchTerm.toLowerCase());
    });
  }, [files, searchTerm]);

  // Build recursive directory tree for standard folder view
  const fileTree = useMemo(() => {
    const root: TreeNode = {
      name: '',
      path: '',
      relativePath: '',
      isDir: true,
      children: {}
    };

    for (const file of filteredFiles) {
      const parts = file.relative_path.split(/[/\\]/);
      let current = root;
      let curPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        curPath = curPath ? `${curPath}/${part}` : part;
        const isFile = i === parts.length - 1;

        if (isFile) {
          current.children[part] = {
            name: part,
            path: file.path,
            relativePath: file.relative_path,
            isDir: false,
            file,
            children: {}
          };
        } else {
          if (!current.children[part]) {
            current.children[part] = {
              name: part,
              path: curPath,
              relativePath: curPath,
              isDir: true,
              children: {}
            };
          }
          current = current.children[part];
        }
      }
    }

    return root;
  }, [filteredFiles]);

  if (!projectPath) {
    return (
      <aside className="explorer-container explorer-empty">
        <div className="empty-state">
          <Layers size={40} className="empty-icon" />
          <h3>No Project Open</h3>
          <p>Open an existing project or create a new one from a platform template.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginTop: '12px' }}>
            <button className="btn btn-primary" onClick={onNewProject} style={{ justifyContent: 'center' }}>
              <FolderPlus size={15} />
              <span>New Project</span>
            </button>
            <button className="btn btn-secondary" onClick={onOpenFolder} style={{ justifyContent: 'center' }}>
              <FolderOpen size={15} />
              <span>Open Folder</span>
            </button>
          </div>
        </div>
      </aside>
    );
  }

  // Recursive tree renderer
  const renderTree = (node: TreeNode, depth: number) => {
    const sortedKeys = Object.keys(node.children).sort((a, b) => {
      const childA = node.children[a];
      const childB = node.children[b];
      // Directories first, then alphabetical
      if (childA.isDir && !childB.isDir) return -1;
      if (!childA.isDir && childB.isDir) return 1;
      return a.localeCompare(b);
    });

    return (
      <ul className="tree-list" key={node.path || 'root'}>
        {sortedKeys.map(key => {
          const child = node.children[key];
          const indentStyle = { paddingLeft: `${14 + depth * 16}px` };

          if (child.isDir) {
            const isExpanded = searchTerm.trim() !== '' ? true : Boolean(expandedFolders[child.path]);
            const isCollapsed = !isExpanded;
            return (
              <li key={child.path} className="tree-folder-item">
                <div 
                  className="tree-folder-header"
                  style={indentStyle}
                  onClick={(e) => toggleFolder(child.path, e)}
                >
                  <span className="folder-chevron">
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </span>
                  <span className="folder-icon">
                    {isCollapsed ? <Folder size={15} /> : <FolderOpen size={15} />}
                  </span>
                  <span className="folder-name">{child.name}</span>
                </div>
                {!isCollapsed && renderTree(child, depth + 1)}
              </li>
            );
          } else if (child.file) {
            const file = child.file;
            const isActive = activeFilePath === file.path;
            return (
              <li
                key={file.path}
                className={`file-item ${isActive ? 'active' : ''}`}
                style={indentStyle}
                onClick={() => onFileSelect(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
                title={file.relative_path}
              >
                <span className="file-icon">{getFileIcon(file.extension)}</span>
                <span className="file-name">{file.name}</span>
              </li>
            );
          }
          return null;
        })}
      </ul>
    );
  };

  // Group files into logical PAKET categories
  const pakFiles = filteredFiles.filter(f => f.extension.toLowerCase() === 'pak');
  const tmxFiles = filteredFiles.filter(f => f.extension.toLowerCase() === 'tmx');
  const graphicsFiles = filteredFiles.filter(f => IMAGE_EXTENSIONS.has(f.extension.toLowerCase()));
  const asmFiles = filteredFiles.filter(f => ['asm', 's', 'z80'].includes(f.extension.toLowerCase()));
  const otherFiles = filteredFiles.filter(f => {
    const ext = f.extension.toLowerCase();
    return ext !== 'pak' && ext !== 'tmx' && !IMAGE_EXTENSIONS.has(ext) && !['asm', 's', 'z80'].includes(ext);
  });

  const renderCategory = (title: string, items: FileNode[], categoryKey: string, icon: React.ReactNode) => {
    if (items.length === 0) return null;
    const isCollapsed = collapsedCategories[categoryKey];

    return (
      <div className="explorer-section" key={categoryKey}>
        <div className="section-header" onClick={() => toggleCategory(categoryKey)}>
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="section-icon">{icon}</span>
          <span className="section-title">{title}</span>
          <span className="section-count">{items.length}</span>
        </div>

        {!isCollapsed && (
          <ul className="file-list">
            {items.map(file => {
              const isActive = activeFilePath === file.path;
              return (
                <li
                  key={file.path}
                  className={`file-item ${isActive ? 'active' : ''}`}
                  onClick={() => onFileSelect(file)}
                  onContextMenu={(e) => handleContextMenu(e, file)}
                  title={file.relative_path}
                >
                  <span className="file-icon">{getFileIcon(file.extension)}</span>
                  <span className="file-name">{file.name}</span>
                  <span className="file-dir">{file.relative_path.includes('/') ? file.relative_path.split('/').slice(0, -1).join('/') : ''}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  return (
    <aside
      className="explorer-container"
      style={width !== undefined ? { width: `${width}px` } : undefined}
    >
      <div className="explorer-header">
        <span className="explorer-title">PROJECT EXPLORER</span>
        <div className="explorer-view-toggle">
          {projectPath && (
            <button
              className="view-toggle-btn"
              onClick={onNewFile}
              title="New File..."
            >
              <FilePlus size={13} />
            </button>
          )}
          <button
            className={`view-toggle-btn ${viewMode === 'tree' ? 'active' : ''}`}
            onClick={() => handleSetViewMode('tree')}
            title="Folder Tree View"
          >
            <FolderTree size={13} />
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'categories' ? 'active' : ''}`}
            onClick={() => handleSetViewMode('categories')}
            title="Categorized View"
          >
            <Layers size={13} />
          </button>
        </div>
      </div>

      {projectPath && (
        <div className="explorer-inspectors-bar">
          <button
            className={`inspector-nav-btn ${activeFilePath === 'special:items' ? 'active' : ''}`}
            onClick={onOpenItemInspector}
            title="Open Visual Item Inspector"
          >
            <Package size={13} className="nav-icon-item" />
            <span className="nav-btn-label">Items</span>
            <span className="nav-btn-badge">{itemsCount}</span>
          </button>
          <button
            className={`inspector-nav-btn ${activeFilePath === 'special:objects' ? 'active' : ''}`}
            onClick={onOpenObjectInspector}
            title="Open Visual Object Inspector"
          >
            <Box size={13} className="nav-icon-obj" />
            <span className="nav-btn-label">Objects</span>
            <span className="nav-btn-badge">{objectsCount}</span>
          </button>
          <button
            className={`inspector-nav-btn ${activeFilePath === 'special:rooms' ? 'active' : ''}`}
            onClick={onOpenRoomInspector}
            title="Open Visual Room Inspector"
          >
            <DoorOpen size={13} className="nav-icon-room" />
            <span className="nav-btn-label">Rooms</span>
            <span className="nav-btn-badge">{roomsCount}</span>
          </button>
        </div>
      )}

      <div className="search-box">
        <Search size={14} className="search-icon" />
        <input
          type="text"
          placeholder="Filter files..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="explorer-content">
        {viewMode === 'tree' ? (
          renderTree(fileTree, 0)
        ) : (
          <>
            {renderCategory("Game Definitions (.pak)", pakFiles, "pak", <Sparkles size={14} />)}
            {renderCategory("Room Tilemaps (.tmx)", tmxFiles, "tmx", <Map size={14} />)}
            {renderCategory("Sprites & Images", graphicsFiles, "graphics", <ImageIcon size={14} />)}
            {renderCategory("Assembly Code", asmFiles, "asm", <FileCode2 size={14} />)}
            {renderCategory("Other Files", otherFiles, "other", <FileText size={14} />)}
          </>
        )}
      </div>

      {contextMenu && (
        <div
          className="explorer-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              const target = contextMenu.file;
              setContextMenu(null);
              setFileToRename(target);
              setNewFileName(target.name);
              setRenameError(null);
            }}
          >
            <Edit2 size={13} />
            <span>Rename...</span>
          </button>
          <div className="context-menu-divider" />
          <button
            className="context-menu-item danger"
            onClick={() => {
              const target = contextMenu.file;
              setContextMenu(null);
              setFileToDelete(target);
              setDeleteError(null);
            }}
          >
            <Trash2 size={13} />
            <span>Delete</span>
          </button>
        </div>
      )}

      {fileToRename && (
        <div
          className="modal-overlay"
          onMouseDown={e => { if (e.target === e.currentTarget && !isRenaming) setFileToRename(null); }}
        >
          <div className="modal-card" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div className="modal-title">
                <Edit2 size={16} />
                <span>Rename File</span>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => !isRenaming && setFileToRename(null)}
              >
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleRenameSubmit} className="modal-body">
              {renameError && (
                <div className="modal-error">
                  <AlertTriangle size={15} />
                  <span>{renameError}</span>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="rename-input">New name for &quot;{fileToRename.name}&quot;:</label>
                <input
                  id="rename-input"
                  ref={renameInputRef}
                  type="text"
                  className="text-input"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  disabled={isRenaming}
                />
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setFileToRename(null)}
                  disabled={isRenaming}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isRenaming || !newFileName.trim() || newFileName.trim() === fileToRename.name}
                >
                  {isRenaming ? 'Renaming...' : 'Rename'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {fileToDelete && (
        <div
          className="modal-overlay"
          onMouseDown={e => { if (e.target === e.currentTarget && !isDeleting) setFileToDelete(null); }}
        >
          <div className="modal-card" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div className="modal-title">
                <AlertTriangle size={16} style={{ color: 'var(--accent-red)' }} />
                <span>Delete File</span>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => !isDeleting && setFileToDelete(null)}
              >
                <X size={15} />
              </button>
            </div>

            <div className="modal-body">
              {deleteError && (
                <div className="modal-error">
                  <AlertTriangle size={15} />
                  <span>{deleteError}</span>
                </div>
              )}

              <p style={{ margin: '0 0 8px 0', fontSize: '13px', lineHeight: 1.5 }}>
                Are you sure you want to permanently delete <strong>{fileToDelete.name}</strong>?
              </p>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                This action cannot be undone.
              </p>

              <div className="modal-footer" style={{ marginTop: '18px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setFileToDelete(null)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDeleteSubmit}
                  disabled={isDeleting}
                >
                  <Trash2 size={14} />
                  <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
