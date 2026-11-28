import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { 
  Package, 
  Plus, 
  Search, 
  Code2, 
  Save, 
  Trash2,
  ZoomIn, 
  ZoomOut, 
  Check, 
  AlertCircle,
  FileCode2,
  ExternalLink,
  RotateCcw,
  RotateCw
} from 'lucide-react';
import type { PakItem, FileNode } from '../types';
import { SpritePreview } from './SpritePreview';
import { 
  STORAGE_KEYS, 
  DEFAULT_INSPECTOR_SIDEBAR_WIDTH, 
  MIN_INSPECTOR_SIDEBAR_WIDTH, 
  MAX_INSPECTOR_SIDEBAR_WIDTH,
  DEFAULT_MAX_HISTORY_STEPS
} from '../constants';

interface ItemInspectorProps {
  items: PakItem[];
  projectPath: string;
  files: FileNode[];
  onOpenCodeAtLine: (filePath: string, line: number) => void;
  onTransferToMemory: (relPath: string, updatedItem: PakItem, targetId: string) => Promise<void>;
  onDeleteItemFromMemory: (relPath: string, targetId: string) => Promise<void>;
  onCreateItemInMemory: (relPath: string, newItem: PakItem) => Promise<void>;
  onSaveAll: () => Promise<void>;
  hasUnsavedChanges: boolean;
  onOpenImageFile?: (fileName: string) => void;
  onRegisterSaveHandler?: (handler: () => Promise<void>) => void;
}

export const ItemInspector: React.FC<ItemInspectorProps> = ({
  items,
  projectPath,
  files,
  onOpenCodeAtLine,
  onTransferToMemory,
  onDeleteItemFromMemory,
  onCreateItemInMemory,
  onSaveAll,
  hasUnsavedChanges,
  onOpenImageFile,
  onRegisterSaveHandler
}) => {
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(() => {
    return items.length > 0 ? `${items[0].filePath}:${items[0].id}` : null;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [zoom, setZoom] = useState<number>(4);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.INSPECTOR_SIDEBAR_WIDTH);
    return saved ? Math.max(MIN_INSPECTOR_SIDEBAR_WIDTH, Math.min(MAX_INSPECTOR_SIDEBAR_WIDTH, parseInt(saved, 10))) : DEFAULT_INSPECTOR_SIDEBAR_WIDTH;
  });

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(MIN_INSPECTOR_SIDEBAR_WIDTH, Math.min(MAX_INSPECTOR_SIDEBAR_WIDTH, startW + delta));
      setSidebarWidth(newWidth);
      localStorage.setItem(STORAGE_KEYS.INSPECTOR_SIDEBAR_WIDTH, newWidth.toString());
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.classList.remove('is-resizing-col');
    };

    document.body.classList.add('is-resizing-col');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  // Form editing state for the active item
  const [editId, setEditId] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDefaultUseMessage, setEditDefaultUseMessage] = useState('');
  const [editImageFile, setEditImageFile] = useState('');
  const [editX1, setEditX1] = useState(0);
  const [editY1, setEditY1] = useState(0);
  const [editX2, setEditX2] = useState(8);
  const [editY2, setEditY2] = useState(12);
  const [isDirty, setIsDirty] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // New item modal state
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newTargetFile, setNewTargetFile] = useState('');

  // Discover pak files in project
  const pakFiles = useMemo(() => {
    return files
      .filter(f => f.extension.toLowerCase() === 'pak')
      .map(f => f.relative_path);
  }, [files]);

  // Filter items by search
  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return items;
    return items.filter(
      it =>
        it.id.toLowerCase().includes(q) ||
        it.name.toLowerCase().includes(q) ||
        it.description.toLowerCase().includes(q) ||
        it.filePath.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const activeItem = useMemo(() => {
    return filteredItems.find(it => `${it.filePath}:${it.id}` === selectedItemKey) || (filteredItems.length > 0 ? filteredItems[0] : null);
  }, [filteredItems, selectedItemKey]);

  const baseDir = activeItem && activeItem.filePath.includes('/')
    ? activeItem.filePath.split('/').slice(0, -1).join('/')
    : '';

  // Discover relevant image files relative to active item's base directory
  const imageFiles = useMemo(() => {
    const allImages = files.filter(f => ['png', 'bmp', 'jpg', 'gif'].includes(f.extension.toLowerCase()));
    if (!baseDir) {
      return allImages.map(f => f.relative_path);
    }
    const local = allImages.filter(f => f.relative_path.startsWith(`${baseDir}/`));
    if (local.length > 0) {
      return local.map(f => f.relative_path.slice(baseDir.length + 1));
    }
    return allImages.map(f => f.relative_path);
  }, [files, baseDir]);

  interface ItemHistorySnapshot {
    id: string;
    name: string;
    description: string;
    defaultUseMessage: string;
    imageFile: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  const activeItemKey = activeItem ? `${activeItem.filePath}:${activeItem.id}` : null;
  const loadedItemKeyRef = useRef<string | null>(null);

  // Undo / Redo history
  const historyRef = useRef<ItemHistorySnapshot[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);

  const updateUndoRedoState = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const pushHistory = useCallback((snapshot: ItemHistorySnapshot) => {
    const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    newHistory.push(JSON.parse(JSON.stringify(snapshot)));
    if (newHistory.length > DEFAULT_MAX_HISTORY_STEPS) {
      newHistory.shift();
    }
    historyRef.current = newHistory;
    historyIndexRef.current = newHistory.length - 1;
    updateUndoRedoState();
  }, [updateUndoRedoState]);

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const target = historyRef.current[historyIndexRef.current];
    if (!target) return;

    setEditId(target.id);
    setEditName(target.name);
    setEditDescription(target.description);
    setEditDefaultUseMessage(target.defaultUseMessage);
    setEditImageFile(target.imageFile);
    setEditX1(target.x1);
    setEditY1(target.y1);
    setEditX2(target.x2);
    setEditY2(target.y2);
    setIsDirty(true);
    updateUndoRedoState();
  }, [updateUndoRedoState]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const target = historyRef.current[historyIndexRef.current];
    if (!target) return;

    setEditId(target.id);
    setEditName(target.name);
    setEditDescription(target.description);
    setEditDefaultUseMessage(target.defaultUseMessage);
    setEditImageFile(target.imageFile);
    setEditX1(target.x1);
    setEditY1(target.y1);
    setEditX2(target.x2);
    setEditY2(target.y2);
    setIsDirty(true);
    updateUndoRedoState();
  }, [updateUndoRedoState]);

  // When active item identity changes, sync form state
  useEffect(() => {
    if (activeItem && activeItemKey !== loadedItemKeyRef.current) {
      loadedItemKeyRef.current = activeItemKey;
      setEditId(activeItem.id);
      setEditName(activeItem.name);
      setEditDescription(activeItem.description);
      const defMsg = activeItem.defaultUseMessage || '';
      setEditDefaultUseMessage(defMsg);

      let imgFile = imageFiles[0] || 'items.png';
      let x1 = 0;
      let y1 = 0;
      let x2 = 8;
      let y2 = 12;

      if (activeItem.image) {
        imgFile = activeItem.image.file;
        x1 = activeItem.image.x1;
        y1 = activeItem.image.y1;
        x2 = activeItem.image.x2 ?? 8;
        y2 = activeItem.image.y2 ?? 12;
      }

      setEditImageFile(imgFile);
      setEditX1(x1);
      setEditY1(y1);
      setEditX2(x2);
      setEditY2(y2);
      setIsDirty(false);
      setIsConfirmingDelete(false);
      setErrorMessage(null);

      const initialSnapshot: ItemHistorySnapshot = {
        id: activeItem.id,
        name: activeItem.name,
        description: activeItem.description,
        defaultUseMessage: defMsg,
        imageFile: imgFile,
        x1,
        y1,
        x2,
        y2,
      };
      historyRef.current = [initialSnapshot];
      historyIndexRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
    }
  }, [activeItemKey, activeItem, imageFiles]);

  // Auto-reset delete confirmation after 4 seconds
  useEffect(() => {
    if (!isConfirmingDelete) return;
    const timer = setTimeout(() => setIsConfirmingDelete(false), 4000);
    return () => clearTimeout(timer);
  }, [isConfirmingDelete]);

  const handleFieldChange = () => {
    setIsDirty(true);
    setSaveSuccess(false);
  };

  const handleCommitBlur = () => {
    const current = historyRef.current[historyIndexRef.current];
    if (
      !current ||
      current.id !== editId ||
      current.name !== editName ||
      current.description !== editDescription ||
      current.defaultUseMessage !== editDefaultUseMessage ||
      current.imageFile !== editImageFile ||
      current.x1 !== editX1 ||
      current.y1 !== editY1 ||
      current.x2 !== editX2 ||
      current.y2 !== editY2
    ) {
      pushHistory({
        id: editId,
        name: editName,
        description: editDescription,
        defaultUseMessage: editDefaultUseMessage,
        imageFile: editImageFile,
        x1: editX1,
        y1: editY1,
        x2: editX2,
        y2: editY2,
      });
    }
  };

  const handleApplyPreset = (w: number, h: number) => {
    const nextX2 = Number(editX1) + w;
    const nextY2 = Number(editY1) + h;
    setEditX2(nextX2);
    setEditY2(nextY2);
    handleFieldChange();
    pushHistory({
      id: editId,
      name: editName,
      description: editDescription,
      defaultUseMessage: editDefaultUseMessage,
      imageFile: editImageFile,
      x1: editX1,
      y1: editY1,
      x2: nextX2,
      y2: nextY2,
    });
  };

  const flushCurrentItemToMemory = useCallback(async () => {
    if (!activeItem) return;
    const updatedItem: PakItem = {
      ...activeItem,
      id: editId.trim() || activeItem.id,
      name: editName.trim(),
      description: editDescription.trim(),
      defaultUseMessage: editDefaultUseMessage.trim() || undefined,
      image: editImageFile.trim()
        ? {
            file: editImageFile.trim(),
            x1: Number(editX1),
            y1: Number(editY1),
            x2: Number(editX2),
            y2: Number(editY2)
          }
        : undefined
    };
    await onTransferToMemory(activeItem.filePath, updatedItem, activeItem.id);
    setIsDirty(false);
  }, [
    activeItem,
    editId,
    editName,
    editDescription,
    editDefaultUseMessage,
    editImageFile,
    editX1,
    editY1,
    editX2,
    editY2,
    onTransferToMemory
  ]);

  const handleSelectItem = async (itemKey: string) => {
    if (isDirty) {
      await flushCurrentItemToMemory();
    }
    setIsConfirmingDelete(false);
    setSelectedItemKey(itemKey);
  };

  const handleSaveItem = useCallback(async () => {
    if (isDirty) {
      await flushCurrentItemToMemory();
    }
    setErrorMessage(null);
    try {
      await onSaveAll();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      setErrorMessage(err?.message || String(err));
    }
  }, [isDirty, flushCurrentItemToMemory, onSaveAll]);

  useEffect(() => {
    if (onRegisterSaveHandler) {
      onRegisterSaveHandler(handleSaveItem);
    }
  }, [onRegisterSaveHandler, handleSaveItem]);

  // Keyboard shortcut Cmd+S to save, Cmd+Z to undo, Cmd+Shift+Z / Ctrl+Y to redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        handleSaveItem();
        return;
      }

      // Check for Undo / Redo (skip if focus is inside text inputs)
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        e.stopPropagation();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleSaveItem, handleUndo, handleRedo]);

  const handleDeleteItem = async () => {
    if (!activeItem) return;

    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }

    setIsConfirmingDelete(false);
    setErrorMessage(null);

    try {
      await onDeleteItemFromMemory(activeItem.filePath, activeItem.id);
      setIsDirty(false);
      loadedItemKeyRef.current = null;
    } catch (err: any) {
      setErrorMessage(`Failed to delete item: ${err?.message || err}`);
    }
  };

  const handleOpenNewModal = () => {
    // Determine default file: find file where most items live, or items.pak
    const itemsPak = pakFiles.find(p => p.toLowerCase().endsWith('items.pak'));
    const defaultFile = itemsPak || (activeItem ? activeItem.filePath : pakFiles[0] || 'game.pak');
    setNewTargetFile(defaultFile);
    setNewId(`item-new-${items.length + 1}`);
    setNewName('New Item');
    setNewDesc('A newly created item.');
    setIsNewModalOpen(true);
  };

  const handleCreateNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTargetFile) return;

    const defaultImage = imageFiles[0] || 'items.png';
    const newItem: PakItem = {
      id: newId.trim() || `item-${Date.now()}`,
      name: newName.trim() || 'New Item',
      description: newDesc.trim() || '',
      defaultUseMessage: "I can't use that here.",
      image: { file: defaultImage, x1: 0, y1: 0, x2: 8, y2: 12 },
      rules: [],
      filePath: newTargetFile,
      startLine: 0,
      endLine: 0
    };

    try {
      await onCreateItemInMemory(newTargetFile, newItem);
      setIsNewModalOpen(false);
      loadedItemKeyRef.current = null;
      setSelectedItemKey(`${newItem.filePath}:${newItem.id}`);
    } catch (err: any) {
      setErrorMessage(`Failed to create item: ${err?.message || err}`);
    }
  };

  const canSave = isDirty || hasUnsavedChanges;

  const currentImageRef = editImageFile
    ? {
        file: editImageFile,
        x1: Number(editX1),
        y1: Number(editY1),
        x2: Number(editX2),
        y2: Number(editY2)
      }
    : undefined;

  return (
    <div className="inspector-container">
      {/* Left List Pane */}
      <aside className="inspector-sidebar" style={{ width: sidebarWidth }}>
        <div className="inspector-sidebar-header">
          <div className="inspector-title-row">
            <div className="inspector-title">
              <Package size={15} />
              <span>Items ({items.length})</span>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleOpenNewModal}
              title="Add New Item"
            >
              <Plus size={13} />
              <span>New</span>
            </button>
          </div>

          <div className="inspector-search">
            <Search size={13} className="search-icon" />
            <input
              type="text"
              placeholder="Filter items..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
        </div>

        <ul className="inspector-item-list">
          {filteredItems.length === 0 ? (
            <li className="inspector-list-empty">
              <span>{items.length === 0 ? 'No items declared in project.' : 'No matching items.'}</span>
            </li>
          ) : (
            filteredItems.map(it => {
              const itemKey = `${it.filePath}:${it.id}`;
              const isSelected = activeItem ? (`${activeItem.filePath}:${activeItem.id}` === itemKey) : false;
              return (
                <li
                  key={itemKey}
                  className={`inspector-item-row ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelectItem(itemKey)}
                >
                  <div className="item-row-icon">
                    <Package size={14} />
                  </div>
                  <div className="item-row-info">
                    <span className="item-row-name">{it.name || it.id}</span>
                    <span className="item-row-id">{it.id}</span>
                  </div>
                  <span className="item-row-file">{it.filePath}</span>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      <div
        className="resizer-vertical"
        onMouseDown={handleResizeStart}
        title="Drag to resize item list"
      />

      {/* Right Detail Pane */}
      <main className="inspector-main">
        {activeItem ? (
          <div className="inspector-card">
            {/* Header / Actions Bar */}
            <div className="inspector-card-header">
              <div className="card-header-left">
                <span className="card-item-tag">ITEM</span>
                <h3 className="card-item-title">{activeItem.name || activeItem.id}</h3>
                <span className="card-item-file-link" onClick={() => onOpenCodeAtLine(activeItem.filePath, activeItem.startLine + 1)}>
                  <FileCode2 size={13} />
                  <span>{activeItem.filePath}:{activeItem.startLine + 1}</span>
                  <ExternalLink size={11} />
                </span>
              </div>

              <div className="card-header-actions">
                <button
                  type="button"
                  className="icon-action-btn"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  title="Undo (Cmd+Z)"
                >
                  <RotateCcw size={13} />
                </button>
                <button
                  type="button"
                  className="icon-action-btn"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  title="Redo (Cmd+Shift+Z)"
                >
                  <RotateCw size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onOpenCodeAtLine(activeItem.filePath, activeItem.startLine + 1)}
                  title="Jump to definition in Code Editor"
                >
                  <Code2 size={13} />
                  <span>View in Code</span>
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={handleDeleteItem}
                  title={isConfirmingDelete ? 'Click again to permanently delete this item' : 'Delete this item from project'}
                >
                  <Trash2 size={13} />
                  <span>{isConfirmingDelete ? 'Confirm Delete?' : 'Delete'}</span>
                </button>
                {isConfirmingDelete && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setIsConfirmingDelete(false)}
                    title="Cancel delete"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  className={`btn ${canSave ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  onClick={handleSaveItem}
                  disabled={!canSave}
                  title="Save item changes to .pak file (Cmd+S)"
                >
                  {saveSuccess ? <Check size={13} /> : <Save size={13} />}
                  <span>{saveSuccess ? 'Saved!' : 'Save'}</span>
                </button>
              </div>
            </div>

            {errorMessage && (
              <div className="inspector-alert error">
                <AlertCircle size={14} />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="inspector-card-body">
              {/* Left Column: Properties Form */}
              <div className="inspector-form-col">
                <div className="form-group">
                  <label htmlFor="item-prop-id">Item ID (Identifier):</label>
                  <input
                    id="item-prop-id"
                    type="text"
                    className="text-input"
                    value={editId}
                    onChange={e => { setEditId(e.target.value); handleFieldChange(); }}
                    onBlur={handleCommitBlur}
                  />
                  <span className="form-hint">Unique identifier used in scripts (e.g. <code>item-key</code>).</span>
                </div>

                <div className="form-group">
                  <label htmlFor="item-prop-name">Display Name:</label>
                  <input
                    id="item-prop-name"
                    type="text"
                    className="text-input"
                    value={editName}
                    onChange={e => { setEditName(e.target.value); handleFieldChange(); }}
                    onBlur={handleCommitBlur}
                  />
                  <span className="form-hint">Name displayed in the player inventory or actions.</span>
                </div>

                <div className="form-group">
                  <label htmlFor="item-prop-desc">Description:</label>
                  <textarea
                    id="item-prop-desc"
                    className="text-input textarea-input"
                    rows={2}
                    value={editDescription}
                    onChange={e => { setEditDescription(e.target.value); handleFieldChange(); }}
                    onBlur={handleCommitBlur}
                  />
                  <span className="form-hint">Message shown when the player examines this item.</span>
                </div>

                <div className="form-group">
                  <label htmlFor="item-prop-msg">Default Use Message:</label>
                  <input
                    id="item-prop-msg"
                    type="text"
                    className="text-input"
                    value={editDefaultUseMessage}
                    onChange={e => { setEditDefaultUseMessage(e.target.value); handleFieldChange(); }}
                    onBlur={handleCommitBlur}
                    placeholder="e.g. It does not fit here."
                  />
                  <span className="form-hint">Fallback message when used on unhandled objects.</span>
                </div>

                {activeItem.rules.length > 0 && (
                  <div className="form-group">
                    <label>Item Rules & Scripts ({activeItem.rules.length}):</label>
                    <div className="rules-code-block">
                      {activeItem.rules.map((r, idx) => (
                        <div key={idx} className="rule-code-line">{r}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Sprite & Image Preview */}
              <div className="inspector-sprite-col">
                <div className="sprite-box-header">
                  <span className="sprite-box-title">Inventory Sprite</span>
                  <div className="zoom-controls">
                    <button
                      className="icon-action-btn"
                      onClick={() => setZoom(z => Math.max(1, z - 1))}
                      title="Zoom Out"
                    >
                      <ZoomOut size={13} />
                    </button>
                    <span className="zoom-value">{zoom}x</span>
                    <button
                      className="icon-action-btn"
                      onClick={() => setZoom(z => Math.min(10, z + 1))}
                      title="Zoom In"
                    >
                      <ZoomIn size={13} />
                    </button>
                  </div>
                </div>

                <div className="sprite-preview-stage">
                  <SpritePreview
                    projectPath={projectPath}
                    imageRef={currentImageRef}
                    baseDir={baseDir}
                    files={files}
                    zoom={zoom}
                  />
                </div>

                <div className="sprite-fields">
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <label htmlFor="item-img-file" style={{ margin: 0 }}>Spritesheet File:</label>
                      {editImageFile && onOpenImageFile && (
                        <button
                          type="button"
                          className="btn-link-action"
                          onClick={() => onOpenImageFile(editImageFile)}
                          title="Open this spritesheet in Image Editor"
                        >
                          <ExternalLink size={12} />
                          <span>Edit Spritesheet</span>
                        </button>
                      )}
                    </div>
                    {imageFiles.length > 0 ? (
                      <select
                        id="item-img-file"
                        className="select-input"
                        value={editImageFile}
                        onChange={e => {
                          const val = e.target.value;
                          setEditImageFile(val);
                          handleFieldChange();
                          pushHistory({
                            id: editId,
                            name: editName,
                            description: editDescription,
                            defaultUseMessage: editDefaultUseMessage,
                            imageFile: val,
                            x1: editX1,
                            y1: editY1,
                            x2: editX2,
                            y2: editY2,
                          });
                        }}
                      >
                        {imageFiles.map(f => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id="item-img-file"
                        type="text"
                        className="text-input"
                        value={editImageFile}
                        onChange={e => { setEditImageFile(e.target.value); handleFieldChange(); }}
                        onBlur={handleCommitBlur}
                        placeholder="items.png"
                      />
                    )}
                  </div>

                  <div className="coords-grid">
                    <div className="form-group">
                      <label htmlFor="item-x1">X1:</label>
                      <input
                        id="item-x1"
                        type="number"
                        className="text-input num-input"
                        value={editX1}
                        onChange={e => { setEditX1(parseInt(e.target.value, 10) || 0); handleFieldChange(); }}
                        onBlur={handleCommitBlur}
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="item-y1">Y1:</label>
                      <input
                        id="item-y1"
                        type="number"
                        className="text-input num-input"
                        value={editY1}
                        onChange={e => { setEditY1(parseInt(e.target.value, 10) || 0); handleFieldChange(); }}
                        onBlur={handleCommitBlur}
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="item-x2">X2:</label>
                      <input
                        id="item-x2"
                        type="number"
                        className="text-input num-input"
                        value={editX2}
                        onChange={e => { setEditX2(parseInt(e.target.value, 10) || 0); handleFieldChange(); }}
                        onBlur={handleCommitBlur}
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="item-y2">Y2:</label>
                      <input
                        id="item-y2"
                        type="number"
                        className="text-input num-input"
                        value={editY2}
                        onChange={e => { setEditY2(parseInt(e.target.value, 10) || 0); handleFieldChange(); }}
                        onBlur={handleCommitBlur}
                      />
                    </div>
                  </div>

                  <div className="quick-presets">
                    <span className="preset-label">Size Presets:</span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => handleApplyPreset(8, 12)}
                      title="Amstrad CPC 8x12 Item standard"
                    >
                      8 × 12 (CPC)
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => handleApplyPreset(16, 16)}
                      title="MSX 16x16 Item standard"
                    >
                      16 × 16 (MSX)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="inspector-empty-state">
            <Package size={40} className="empty-icon" />
            <h3>No Item Selected</h3>
            <p>Select an item from the list or create a new one.</p>
            <button className="btn btn-primary" onClick={handleOpenNewModal}>
              <Plus size={14} />
              <span>Create Item</span>
            </button>
          </div>
        )}
      </main>

      {/* New Item Modal */}
      {isNewModalOpen && (
        <div
          className="modal-overlay"
          onMouseDown={e => { if (e.target === e.currentTarget) setIsNewModalOpen(false); }}
        >
          <div className="modal-card">
            <div className="modal-header">
              <div className="modal-title">
                <Package size={16} />
                <span>New Item</span>
              </div>
              <button className="modal-close-btn" onClick={() => setIsNewModalOpen(false)}>
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateNewItem} className="modal-body">
              <div className="form-group">
                <label htmlFor="new-item-id">Item ID:</label>
                <input
                  id="new-item-id"
                  type="text"
                  className="text-input"
                  value={newId}
                  onChange={e => setNewId(e.target.value)}
                  placeholder="e.g. item-brass-key"
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="new-item-name">Display Name:</label>
                <input
                  id="new-item-name"
                  type="text"
                  className="text-input"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. brass key"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="new-item-desc">Description:</label>
                <input
                  id="new-item-desc"
                  type="text"
                  className="text-input"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  placeholder="e.g. An old brass key with intricate teeth."
                />
              </div>

              <div className="form-group">
                <label htmlFor="new-item-file">Target .pak File:</label>
                <select
                  id="new-item-file"
                  className="select-input"
                  value={newTargetFile}
                  onChange={e => setNewTargetFile(e.target.value)}
                >
                  {pakFiles.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
                <span className="form-hint">Item will be appended after the last item in this file.</span>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsNewModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
