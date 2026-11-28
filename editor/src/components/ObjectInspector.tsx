import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { 
  Box, 
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
  Play,
  Grid,
  RotateCcw,
  RotateCw
} from 'lucide-react';
import type { PakObject, PakObjectState, PakImageRef, FileNode } from '../types';
import { SpritePreview } from './SpritePreview';
import { 
  STORAGE_KEYS, 
  DEFAULT_INSPECTOR_SIDEBAR_WIDTH, 
  MIN_INSPECTOR_SIDEBAR_WIDTH, 
  MAX_INSPECTOR_SIDEBAR_WIDTH,
  DEFAULT_MAX_HISTORY_STEPS
} from '../constants';

interface ObjectInspectorProps {
  objects: PakObject[];
  projectPath: string;
  files: FileNode[];
  onOpenCodeAtLine: (filePath: string, line: number) => void;
  onTransferToMemory: (relPath: string, updatedObj: PakObject, targetId: string) => Promise<void>;
  onDeleteObjectFromMemory: (relPath: string, targetId: string) => Promise<void>;
  onCreateObjectInMemory: (relPath: string, newObj: PakObject) => Promise<void>;
  onSaveAll: () => Promise<void>;
  hasUnsavedChanges: boolean;
  onOpenImageFile?: (fileName: string) => void;
  onRegisterSaveHandler?: (handler: () => Promise<void>) => void;
}

const COMMON_STATES = ['idle', 'walking-1', 'walking-2', 'walking-3', 'walking-4', 'open', 'closed', 'exit', 'hidden'];
const COMMON_DIRECTIONS = ['down', 'up', 'left', 'right', 'front'];

export const ObjectInspector: React.FC<ObjectInspectorProps> = ({
  objects,
  projectPath,
  files,
  onOpenCodeAtLine,
  onTransferToMemory,
  onDeleteObjectFromMemory,
  onCreateObjectInMemory,
  onSaveAll,
  hasUnsavedChanges,
  onOpenImageFile,
  onRegisterSaveHandler
}) => {
  const [selectedObjectKey, setSelectedObjectKey] = useState<string | null>(() => {
    return objects.length > 0 ? `${objects[0].filePath}:${objects[0].id}` : null;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [activeStateIndex, setActiveStateIndex] = useState(0);
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

  // Form editing state for active object
  const [editId, setEditId] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStates, setEditStates] = useState<PakObjectState[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // Animation playback state
  const [isPlayingAnim, setIsPlayingAnim] = useState(false);
  const [currentAnimFrame, setCurrentAnimFrame] = useState(0);

  // New object modal state
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

  // Filter objects by search
  const filteredObjects = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return objects;
    return objects.filter(
      obj =>
        obj.id.toLowerCase().includes(q) ||
        obj.name.toLowerCase().includes(q) ||
        obj.description.toLowerCase().includes(q) ||
        obj.filePath.toLowerCase().includes(q)
    );
  }, [objects, searchQuery]);

  const activeObject = useMemo(() => {
    return filteredObjects.find(o => `${o.filePath}:${o.id}` === selectedObjectKey) || (filteredObjects.length > 0 ? filteredObjects[0] : null);
  }, [filteredObjects, selectedObjectKey]);

  const baseDir = activeObject && activeObject.filePath.includes('/')
    ? activeObject.filePath.split('/').slice(0, -1).join('/')
    : '';

  // Discover image files scoped to base directory
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

  interface ObjectHistorySnapshot {
    id: string;
    name: string;
    description: string;
    states: PakObjectState[];
    activeStateIndex: number;
  }

  const activeObjectKey = activeObject ? `${activeObject.filePath}:${activeObject.id}` : null;
  const loadedObjectKeyRef = useRef<string | null>(null);

  // Undo / Redo history
  const historyRef = useRef<ObjectHistorySnapshot[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);

  const updateUndoRedoState = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const pushHistory = useCallback((snapshot: ObjectHistorySnapshot) => {
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
    setEditStates(JSON.parse(JSON.stringify(target.states)));
    setActiveStateIndex(Math.min(target.activeStateIndex, target.states.length - 1));
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
    setEditStates(JSON.parse(JSON.stringify(target.states)));
    setActiveStateIndex(Math.min(target.activeStateIndex, target.states.length - 1));
    setIsDirty(true);
    updateUndoRedoState();
  }, [updateUndoRedoState]);

  // When active object identity changes, sync form
  useEffect(() => {
    if (activeObject && activeObjectKey !== loadedObjectKeyRef.current) {
      loadedObjectKeyRef.current = activeObjectKey;
      setEditId(activeObject.id);
      setEditName(activeObject.name);
      setEditDescription(activeObject.description);
      const clonedStates = activeObject.states.map(s => ({ ...s }));
      setEditStates(clonedStates);
      setActiveStateIndex(0);
      setIsDirty(false);
      setIsConfirmingDelete(false);
      setErrorMessage(null);

      const initialSnapshot: ObjectHistorySnapshot = {
        id: activeObject.id,
        name: activeObject.name,
        description: activeObject.description,
        states: JSON.parse(JSON.stringify(clonedStates)),
        activeStateIndex: 0,
      };
      historyRef.current = [initialSnapshot];
      historyIndexRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
    }
  }, [activeObjectKey, activeObject]);

  // Auto-reset delete confirmation after 4 seconds
  useEffect(() => {
    if (!isConfirmingDelete) return;
    const timer = setTimeout(() => setIsConfirmingDelete(false), 4000);
    return () => clearTimeout(timer);
  }, [isConfirmingDelete]);

  const activeState = editStates[activeStateIndex] || editStates[0] || null;

  // Handle animation timer
  useEffect(() => {
    if (!isPlayingAnim || !activeState?.animation || activeState.animation.frames.length <= 1) {
      return;
    }

    const interval = Math.max(50, activeState.animation.speed * 20);
    const timer = setInterval(() => {
      setCurrentAnimFrame(f => (f + 1) % activeState.animation!.frames.length);
    }, interval);

    return () => clearInterval(timer);
  }, [isPlayingAnim, activeState?.animation]);

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
      current.description !== editDescription
    ) {
      pushHistory({
        id: editId,
        name: editName,
        description: editDescription,
        states: editStates,
        activeStateIndex,
      });
    }
  };

  const handleUpdateCurrentState = (updated: Partial<PakObjectState>) => {
    const copy = [...editStates];
    if (copy[activeStateIndex]) {
      copy[activeStateIndex] = { ...copy[activeStateIndex], ...updated };
    }
    setEditStates(copy);
    handleFieldChange();
    pushHistory({
      id: editId,
      name: editName,
      description: editDescription,
      states: copy,
      activeStateIndex,
    });
  };

  const handleAddState = () => {
    const defaultImage = imageFiles[0] || 'objects.png';
    const newState: PakObjectState = {
      name: 'idle',
      direction: 'down',
      image: { file: defaultImage, x1: 0, y1: 0, x2: 16, y2: 16 },
      rules: []
    };
    const nextStates = [...editStates, newState];
    const nextIdx = editStates.length;
    setEditStates(nextStates);
    setActiveStateIndex(nextIdx);
    handleFieldChange();
    pushHistory({
      id: editId,
      name: editName,
      description: editDescription,
      states: nextStates,
      activeStateIndex: nextIdx,
    });
  };

  const handleRemoveState = (index: number) => {
    if (editStates.length <= 1) return;
    const nextStates = editStates.filter((_, idx) => idx !== index);
    const nextIdx = Math.max(0, activeStateIndex - 1);
    setEditStates(nextStates);
    setActiveStateIndex(nextIdx);
    handleFieldChange();
    pushHistory({
      id: editId,
      name: editName,
      description: editDescription,
      states: nextStates,
      activeStateIndex: nextIdx,
    });
  };

  // Toggle cell in collision mask grid
  const handleToggleCollisionCell = (rowIdx: number, colIdx: number) => {
    if (!activeState) return;

    const masks = activeState.collisionMask ? [...activeState.collisionMask] : ['00000000', '00000000', '00000000'];
    const row = masks[rowIdx] || '00000000';
    const chars = row.split('');
    chars[colIdx] = chars[colIdx] === '1' ? '0' : '1';
    masks[rowIdx] = chars.join('');

    handleUpdateCurrentState({ collisionMask: masks });
  };

  const flushCurrentObjectToMemory = useCallback(async () => {
    if (!activeObject) return;
    const updatedObj: PakObject = {
      ...activeObject,
      id: editId.trim() || activeObject.id,
      name: editName.trim(),
      description: editDescription.trim(),
      states: editStates
    };
    await onTransferToMemory(activeObject.filePath, updatedObj, activeObject.id);
    setIsDirty(false);
  }, [activeObject, editId, editName, editDescription, editStates, onTransferToMemory]);

  const handleSelectObject = async (objKey: string) => {
    if (isDirty) {
      await flushCurrentObjectToMemory();
    }
    setIsConfirmingDelete(false);
    setSelectedObjectKey(objKey);
  };

  const handleSaveObject = useCallback(async () => {
    if (isDirty) {
      await flushCurrentObjectToMemory();
    }
    setErrorMessage(null);
    try {
      await onSaveAll();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      setErrorMessage(err?.message || String(err));
    }
  }, [isDirty, flushCurrentObjectToMemory, onSaveAll]);

  useEffect(() => {
    if (onRegisterSaveHandler) {
      onRegisterSaveHandler(handleSaveObject);
    }
  }, [onRegisterSaveHandler, handleSaveObject]);

  // Keyboard shortcut Cmd+S to save, Cmd+Z to undo, Cmd+Shift+Z / Ctrl+Y to redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        handleSaveObject();
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
  }, [handleSaveObject, handleUndo, handleRedo]);

  const handleDeleteObject = async () => {
    if (!activeObject) return;

    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }

    setIsConfirmingDelete(false);
    setErrorMessage(null);

    try {
      await onDeleteObjectFromMemory(activeObject.filePath, activeObject.id);
      setIsDirty(false);
      loadedObjectKeyRef.current = null;
    } catch (err: any) {
      setErrorMessage(`Failed to delete object: ${err?.message || err}`);
    }
  };

  const handleOpenNewModal = () => {
    const objectsPak = pakFiles.find(p => p.toLowerCase().endsWith('objects.pak'));
    const defaultFile = objectsPak || (activeObject ? activeObject.filePath : pakFiles[0] || 'game.pak');
    setNewTargetFile(defaultFile);
    setNewId(`obj-new-${objects.length + 1}`);
    setNewName('New Object');
    setNewDesc('An interactive room object.');
    setIsNewModalOpen(true);
  };

  const handleCreateNewObject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTargetFile) return;

    const defaultImage = imageFiles[0] || 'objects.png';
    const newObj: PakObject = {
      id: newId.trim() || `obj-${Date.now()}`,
      name: newName.trim() || 'New Object',
      description: newDesc.trim() || '',
      states: [
        {
          name: 'idle',
          direction: 'down',
          image: { file: defaultImage, x1: 0, y1: 0, x2: 16, y2: 16 },
          rules: []
        }
      ],
      rules: [],
      filePath: newTargetFile,
      startLine: 0,
      endLine: 0
    };

    try {
      await onCreateObjectInMemory(newTargetFile, newObj);
      setIsNewModalOpen(false);
      loadedObjectKeyRef.current = null;
      setSelectedObjectKey(`${newObj.filePath}:${newObj.id}`);
    } catch (err: any) {
      setErrorMessage(`Failed to create object: ${err?.message || err}`);
    }
  };

  const canSave = isDirty || hasUnsavedChanges;

  // Determine current sprite to display in preview (single image or animated frame)
  const currentPreviewImage: PakImageRef | undefined = useMemo(() => {
    if (!activeState) return undefined;
    if (activeState.animation && activeState.animation.frames.length > 0) {
      return activeState.animation.frames[currentAnimFrame] || activeState.animation.frames[0];
    }
    return activeState.image;
  }, [activeState, currentAnimFrame]);

  return (
    <div className="inspector-container">
      {/* Left List Pane */}
      <aside className="inspector-sidebar" style={{ width: sidebarWidth }}>
        <div className="inspector-sidebar-header">
          <div className="inspector-title-row">
            <div className="inspector-title">
              <Box size={15} />
              <span>Objects ({objects.length})</span>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleOpenNewModal}
              title="Add New Object"
            >
              <Plus size={13} />
              <span>New</span>
            </button>
          </div>

          <div className="inspector-search">
            <Search size={13} className="search-icon" />
            <input
              type="text"
              placeholder="Filter objects..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
        </div>

        <ul className="inspector-item-list">
          {filteredObjects.length === 0 ? (
            <li className="inspector-list-empty">
              <span>{objects.length === 0 ? 'No objects declared in project.' : 'No matching objects.'}</span>
            </li>
          ) : (
            filteredObjects.map(obj => {
              const objKey = `${obj.filePath}:${obj.id}`;
              const isSelected = activeObject ? (`${activeObject.filePath}:${activeObject.id}` === objKey) : false;
              return (
                <li
                  key={objKey}
                  className={`inspector-item-row ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelectObject(objKey)}
                >
                  <div className="item-row-icon">
                    <Box size={14} />
                  </div>
                  <div className="item-row-info">
                    <span className="item-row-name">{obj.name || obj.id}</span>
                    <span className="item-row-id">{obj.id} ({obj.states.length} {obj.states.length === 1 ? 'state' : 'states'})</span>
                  </div>
                  <span className="item-row-file">{obj.filePath}</span>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      <div
        className="resizer-vertical"
        onMouseDown={handleResizeStart}
        title="Drag to resize object list"
      />

      {/* Right Detail Pane */}
      <main className="inspector-main">
        {activeObject ? (
          <div className="inspector-card">
            {/* Header / Actions Bar */}
            <div className="inspector-card-header">
              <div className="card-header-left">
                <span className="card-item-tag">OBJECT</span>
                <h3 className="card-item-title">{activeObject.name || activeObject.id}</h3>
                <span
                  className="card-item-file-link"
                  onClick={() => onOpenCodeAtLine(activeObject.filePath, activeObject.startLine + 1)}
                >
                  <FileCode2 size={13} />
                  <span>{activeObject.filePath}:{activeObject.startLine + 1}</span>
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
                  onClick={() => onOpenCodeAtLine(activeObject.filePath, activeObject.startLine + 1)}
                  title="Jump to definition in Code Editor"
                >
                  <Code2 size={13} />
                  <span>View in Code</span>
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={handleDeleteObject}
                  title={isConfirmingDelete ? 'Click again to permanently delete this object' : 'Delete this object from project'}
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
                  onClick={handleSaveObject}
                  disabled={!canSave}
                  title="Save object changes to .pak file (Cmd+S)"
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
              {/* Left Column: Object & State Properties */}
              <div className="inspector-form-col">
                <div className="form-row-2">
                  <div className="form-group">
                    <label htmlFor="obj-prop-id">Object ID:</label>
                    <input
                      id="obj-prop-id"
                      type="text"
                      className="text-input"
                      value={editId}
                      onChange={e => { setEditId(e.target.value); handleFieldChange(); }}
                      onBlur={handleCommitBlur}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="obj-prop-name">Display Name:</label>
                    <input
                      id="obj-prop-name"
                      type="text"
                      className="text-input"
                      value={editName}
                      onChange={e => { setEditName(e.target.value); handleFieldChange(); }}
                      onBlur={handleCommitBlur}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="obj-prop-desc">Description:</label>
                  <textarea
                    id="obj-prop-desc"
                    className="text-input textarea-input"
                    rows={2}
                    value={editDescription}
                    onChange={e => { setEditDescription(e.target.value); handleFieldChange(); }}
                    onBlur={handleCommitBlur}
                  />
                </div>

                {/* States Manager */}
                <div className="states-manager-section">
                  <div className="states-header">
                    <label>States ({editStates.length}):</label>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={handleAddState}
                    >
                      <Plus size={12} />
                      <span>Add State</span>
                    </button>
                  </div>

                  <div className="states-pills">
                    {editStates.map((st, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`state-pill ${activeStateIndex === idx ? 'active' : ''}`}
                        onClick={() => setActiveStateIndex(idx)}
                      >
                        <span className="state-pill-name">{st.name}</span>
                        <span className="state-pill-dir">({st.direction})</span>
                      </button>
                    ))}
                  </div>

                  {activeState && (
                    <div className="active-state-panel">
                      <div className="state-row-header">
                        <span className="state-panel-title">
                          State #{activeStateIndex + 1}: <strong>{activeState.name}</strong> ({activeState.direction})
                        </span>
                        {editStates.length > 1 && (
                          <button
                            type="button"
                            className="btn btn-danger btn-xs"
                            onClick={() => handleRemoveState(activeStateIndex)}
                            title="Remove this state"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>

                      <div className="form-row-2">
                        <div className="form-group">
                          <label htmlFor="state-name-select">State Name:</label>
                          <input
                            id="state-name-select"
                            type="text"
                            className="text-input"
                            value={activeState.name}
                            onChange={e => handleUpdateCurrentState({ name: e.target.value })}
                            list="common-states-list"
                          />
                          <datalist id="common-states-list">
                            {COMMON_STATES.map(s => <option key={s} value={s} />)}
                          </datalist>
                        </div>

                        <div className="form-group">
                          <label htmlFor="state-dir-select">Direction:</label>
                          <select
                            id="state-dir-select"
                            className="select-input"
                            value={activeState.direction}
                            onChange={e => handleUpdateCurrentState({ direction: e.target.value })}
                          >
                            {COMMON_DIRECTIONS.map(d => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Selection Type */}
                      <div className="form-group">
                        <label>Selection Type:</label>
                        <div className="selection-type-toggle">
                          {(['pixel', 'box', 'none'] as const).map(mode => (
                            <button
                              key={mode}
                              type="button"
                              className={`btn-toggle ${(activeState.selectionType || 'pixel') === mode ? 'active' : ''}`}
                              onClick={() => handleUpdateCurrentState({ selectionType: mode })}
                            >
                              {mode.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Collision Mask Editor */}
                      <div className="form-group">
                        <div className="collision-header">
                          <label>
                            <Grid size={13} />
                            <span>Collision Mask:</span>
                          </label>
                          <span className="collision-hint">(Click cells to toggle solid 1 / walkable 0)</span>
                        </div>
                        <div className="collision-grid">
                          {(activeState.collisionMask || ['00000000', '00000000', '11111111']).map((row, rowIdx) => (
                            <div key={rowIdx} className="collision-row">
                              {row.split('').map((cell, colIdx) => (
                                <button
                                  key={colIdx}
                                  type="button"
                                  className={`collision-cell ${cell === '1' ? 'solid' : 'walkable'}`}
                                  onClick={() => handleToggleCollisionCell(rowIdx, colIdx)}
                                  title={`Row ${rowIdx + 1}, Col ${colIdx + 1}: ${cell === '1' ? 'Solid Collision' : 'Walkable'}`}
                                >
                                  {cell}
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Sprite & Animation Preview */}
              <div className="inspector-sprite-col">
                <div className="sprite-box-header">
                  <span className="sprite-box-title">
                    {activeState?.animation ? 'Animation Preview' : 'State Sprite Preview'}
                  </span>
                  <div className="zoom-controls">
                    {activeState?.animation && (
                      <button
                        className={`icon-action-btn ${isPlayingAnim ? 'active' : ''}`}
                        onClick={() => setIsPlayingAnim(!isPlayingAnim)}
                        title={isPlayingAnim ? 'Pause Animation' : 'Play Animation'}
                      >
                        <Play size={13} />
                      </button>
                    )}
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
                    imageRef={currentPreviewImage}
                    baseDir={baseDir}
                    files={files}
                    zoom={zoom}
                  />
                </div>

                {activeState?.animation ? (
                  // The single-image fields below would edit nothing that is saved for an animation.
                  <div className="sprite-fields">
                    <div className="form-group">
                      <span className="form-hint">
                        This state is an animation of {activeState.animation.frames.length} frame
                        {activeState.animation.frames.length === 1 ? '' : 's'}. Edit its frames in the code editor.
                      </span>
                    </div>
                  </div>
                ) : activeState && (
                  <div className="sprite-fields">
                    <div className="form-group">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <label htmlFor="obj-img-file" style={{ margin: 0 }}>Spritesheet File:</label>
                        {activeState.image?.file && onOpenImageFile && (
                          <button
                            type="button"
                            className="btn-link-action"
                            onClick={() => onOpenImageFile(activeState.image!.file)}
                            title="Open this spritesheet in Image Editor"
                          >
                            <ExternalLink size={12} />
                            <span>Edit Spritesheet</span>
                          </button>
                        )}
                      </div>
                      {imageFiles.length > 0 ? (
                        <select
                          id="obj-img-file"
                          className="select-input"
                          value={activeState.image?.file || ''}
                          onChange={e => {
                            const val = e.target.value;
                            if (!val) {
                              handleUpdateCurrentState({ image: undefined });
                            } else {
                              const cur = activeState.image || { file: val, x1: 0, y1: 0 };
                              handleUpdateCurrentState({ image: { ...cur, file: val } });
                            }
                          }}
                        >
                          {!activeState.image?.file && (
                            <option value="">-- No sprite assigned --</option>
                          )}
                          {activeState.image?.file && !imageFiles.includes(activeState.image.file) && (
                            <option value={activeState.image.file}>{activeState.image.file}</option>
                          )}
                          {imageFiles.map(f => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id="obj-img-file"
                          type="text"
                          className="text-input"
                          value={activeState.image?.file || ''}
                          placeholder="objects.png"
                          onChange={e => {
                            const val = e.target.value.trim();
                            if (!val) {
                              handleUpdateCurrentState({ image: undefined });
                            } else {
                              const cur = activeState.image || { file: val, x1: 0, y1: 0 };
                              handleUpdateCurrentState({ image: { ...cur, file: val } });
                            }
                          }}
                        />
                      )}
                    </div>

                    {activeState.image && (
                      <div className="coords-grid">
                        <div className="form-group">
                          <label htmlFor="obj-x1">X1:</label>
                          <input
                            id="obj-x1"
                            type="number"
                            className="text-input num-input"
                            value={activeState.image.x1}
                            onChange={e => {
                              const cur = activeState.image!;
                              handleUpdateCurrentState({
                                image: { ...cur, x1: parseInt(e.target.value, 10) || 0 }
                              });
                            }}
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor="obj-y1">Y1:</label>
                          <input
                            id="obj-y1"
                            type="number"
                            className="text-input num-input"
                            value={activeState.image.y1}
                            onChange={e => {
                              const cur = activeState.image!;
                              handleUpdateCurrentState({
                                image: { ...cur, y1: parseInt(e.target.value, 10) || 0 }
                              });
                            }}
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor="obj-x2">X2:</label>
                          <input
                            id="obj-x2"
                            type="number"
                            className="text-input num-input"
                            value={activeState.image.x2 ?? ''}
                            placeholder="auto"
                            onChange={e => {
                              const cur = activeState.image!;
                              const val = e.target.value === '' ? undefined : (parseInt(e.target.value, 10) || 0);
                              handleUpdateCurrentState({
                                image: { ...cur, x2: val }
                              });
                            }}
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor="obj-y2">Y2:</label>
                          <input
                            id="obj-y2"
                            type="number"
                            className="text-input num-input"
                            value={activeState.image.y2 ?? ''}
                            placeholder="auto"
                            onChange={e => {
                              const cur = activeState.image!;
                              const val = e.target.value === '' ? undefined : (parseInt(e.target.value, 10) || 0);
                              handleUpdateCurrentState({
                                image: { ...cur, y2: val }
                              });
                            }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="quick-presets">
                      <span className="preset-label">Size Presets:</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => {
                          if (activeState.image) {
                            handleUpdateCurrentState({
                              image: {
                                ...activeState.image,
                                x2: activeState.image.x1 + 16,
                                y2: activeState.image.y1 + 16
                              }
                            });
                          }
                        }}
                      >
                        16 × 16
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => {
                          if (activeState.image) {
                            handleUpdateCurrentState({
                              image: {
                                ...activeState.image,
                                x2: activeState.image.x1 + 24,
                                y2: activeState.image.y1 + 32
                              }
                            });
                          }
                        }}
                      >
                        24 × 32
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="inspector-empty-state">
            <Box size={40} className="empty-icon" />
            <h3>No Object Selected</h3>
            <p>Select an object from the list or create a new one.</p>
            <button className="btn btn-primary" onClick={handleOpenNewModal}>
              <Plus size={14} />
              <span>Create Object</span>
            </button>
          </div>
        )}
      </main>

      {/* New Object Modal */}
      {isNewModalOpen && (
        <div
          className="modal-overlay"
          onMouseDown={e => { if (e.target === e.currentTarget) setIsNewModalOpen(false); }}
        >
          <div className="modal-card">
            <div className="modal-header">
              <div className="modal-title">
                <Box size={16} />
                <span>New Object</span>
              </div>
              <button className="modal-close-btn" onClick={() => setIsNewModalOpen(false)}>
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateNewObject} className="modal-body">
              <div className="form-group">
                <label htmlFor="new-obj-id">Object ID:</label>
                <input
                  id="new-obj-id"
                  type="text"
                  className="text-input"
                  value={newId}
                  onChange={e => setNewId(e.target.value)}
                  placeholder="e.g. door-secret"
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="new-obj-name">Display Name:</label>
                <input
                  id="new-obj-name"
                  type="text"
                  className="text-input"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. secret door"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="new-obj-desc">Description:</label>
                <input
                  id="new-obj-desc"
                  type="text"
                  className="text-input"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  placeholder="e.g. A hidden door in the stone wall."
                />
              </div>

              <div className="form-group">
                <label htmlFor="new-obj-file">Target .pak File:</label>
                <select
                  id="new-obj-file"
                  className="select-input"
                  value={newTargetFile}
                  onChange={e => setNewTargetFile(e.target.value)}
                >
                  {pakFiles.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
                <span className="form-hint">Object will be appended after the last object in this file.</span>
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
                  Create Object
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
