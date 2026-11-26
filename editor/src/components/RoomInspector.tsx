import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { 
  DoorOpen, 
  Plus, 
  Search, 
  Code2, 
  Save, 
  Trash2, 
  Check, 
  AlertCircle, 
  FileCode2, 
  ExternalLink, 
  FileText,
  X
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { safeInvoke as invoke } from '../utils/ipc';
import type { PakRoom, PakObject, FileNode, TmxData, TmxObject, TmxLayer, TmxTileset, Platform } from '../types';
import { parseTmxXml, serializeTmxXml, validateObjectIds, resolveExternalTilesets } from '../utils/tmxParser';
import { getScreenGuidelines } from '../utils/screenAreas';
import { parentDir } from '../utils/paths';
import { RoomCanvas } from './RoomCanvas';
import { 
  STORAGE_KEYS, 
  DEFAULT_INSPECTOR_SIDEBAR_WIDTH, 
  MIN_INSPECTOR_SIDEBAR_WIDTH, 
  MAX_INSPECTOR_SIDEBAR_WIDTH,
  DEFAULT_MAX_HISTORY_STEPS
} from '../constants';

interface RoomInspectorProps {
  rooms: PakRoom[];
  projectPath: string;
  files: FileNode[];
  projectObjects: PakObject[];
  platform: Platform;
  inMemoryPakFiles?: Record<string, { content: string; isDirty: boolean }>;
  onOpenCodeAtLine: (filePath: string, line: number) => void;
  onTransferToMemory: (relPath: string, updatedRoom: PakRoom, targetId: string) => Promise<void>;
  onDeleteRoomFromMemory: (relPath: string, targetId: string) => Promise<void>;
  onCreateRoomInMemory: (relPath: string, newRoom: PakRoom, tmxContent?: string) => Promise<void>;
  onSaveAll: () => Promise<void>;
  hasUnsavedChanges: boolean;
  onOpenTmxFile?: (fileName: string) => void;
  onRegisterSaveHandler?: (handler: () => Promise<void>) => void;
}

export const RoomInspector: React.FC<RoomInspectorProps> = ({
  rooms,
  projectPath,
  files,
  projectObjects,
  platform,
  inMemoryPakFiles,
  onOpenCodeAtLine,
  onTransferToMemory,
  onDeleteRoomFromMemory,
  onCreateRoomInMemory,
  onSaveAll,
  hasUnsavedChanges,
  onOpenTmxFile,
  onRegisterSaveHandler
}) => {
  const [selectedRoomKey, setSelectedRoomKey] = useState<string | null>(() => {
    return rooms.length > 0 ? `${rooms[0].filePath}:${rooms[0].id}` : null;
  });
  const [searchQuery, setSearchQuery] = useState('');

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

  // Active room form editing state
  const [editId, setEditId] = useState('');
  const [editTmxFile, setEditTmxFile] = useState('');
  const [editX, setEditX] = useState(0);
  const [editY, setEditY] = useState(0);
  const [editSubroom, setEditSubroom] = useState(false);
  const [editRulesText, setEditRulesText] = useState('');

  // Rules Editor Modal state
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);

  // TMX data for active room
  const [tmxData, setTmxData] = useState<TmxData | null>(null);
  const [tmxError, setTmxError] = useState<string | null>(null);
  const [isTmxDirty, setIsTmxDirty] = useState(false);

  // Selected object ID on the visual canvas
  const [selectedObjectId, setSelectedObjectId] = useState<number | null>(null);

  // Undo / Redo history
  const historyRef = useRef<Array<{
    objects: TmxObject[];
    layers: TmxLayer[];
    tilesets: TmxTileset[];
    selectedObjectId: number | null;
  }>>([]);
  const historyIndexRef = useRef<number>(-1);
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);

  const updateUndoRedoState = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const [isDirty, setIsDirty] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // New Room Modal state
  const [isNewRoomModalOpen, setIsNewRoomModalOpen] = useState(false);
  const [newRoomId, setNewRoomId] = useState('');
  const [newRoomTmx, setNewRoomTmx] = useState('');
  const [newRoomTargetFile, setNewRoomTargetFile] = useState('');
  const [newRoomSubroom, setNewRoomSubroom] = useState(false);

  // Pak and Tmx file lists in project
  const pakFiles = useMemo(() => {
    return files
      .filter(f => f.extension.toLowerCase() === 'pak')
      .map(f => f.relative_path);
  }, [files]);

  const tmxFiles = useMemo(() => {
    return files
      .filter(f => f.extension.toLowerCase() === 'tmx')
      .map(f => f.name);
  }, [files]);

  // Filter rooms by search
  const filteredRooms = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return rooms;
    return rooms.filter(r => 
      r.id.toLowerCase().includes(q) || 
      r.tmxFile.toLowerCase().includes(q)
    );
  }, [rooms, searchQuery]);

  // Currently active room
  const activeRoom = useMemo(() => {
    if (!selectedRoomKey) return rooms[0] || null;
    return rooms.find(r => `${r.filePath}:${r.id}` === selectedRoomKey) || rooms[0] || null;
  }, [rooms, selectedRoomKey]);

  // Active TMX file node to get full path
  const activeTmxFileNode = useMemo(() => {
    if (!activeRoom || !activeRoom.tmxFile) return undefined;
    const nameOnly = activeRoom.tmxFile.toLowerCase().trim();
    return files.find(f => f.name.toLowerCase() === nameOnly || f.relative_path.toLowerCase() === nameOnly);
  }, [activeRoom, files]);

  // Screen Guidelines computed for active room and platform
  const screenGuidelines = useMemo(() => {
    const pakTexts: string[] = [];
    if (inMemoryPakFiles) {
      for (const v of Object.values(inMemoryPakFiles)) {
        pakTexts.push(v.content);
      }
    }
    return getScreenGuidelines(
      platform,
      pakTexts,
      tmxData?.tilewidth || 8,
      tmxData?.tileheight || 8
    );
  }, [platform, inMemoryPakFiles, tmxData?.tilewidth, tmxData?.tileheight]);

  // Load active room into form state
  useEffect(() => {
    if (activeRoom) {
      setEditId(activeRoom.id);
      setEditTmxFile(activeRoom.tmxFile);
      setEditX(activeRoom.x);
      setEditY(activeRoom.y);
      setEditSubroom(Boolean(activeRoom.subroom));
      setEditRulesText(activeRoom.rules.join('\n'));
      setIsDirty(false);
      setErrorMessage(null);
      setIsConfirmingDelete(false);
      setSelectedObjectId(null);
    }
  }, [activeRoom]);

  // Load TMX data for active room
  useEffect(() => {
    if (!activeRoom || !projectPath || !activeRoom.tmxFile) {
      setTmxData(null);
      setTmxError(null);
      return;
    }

    const tmxFilename = activeRoom.tmxFile.trim().toLowerCase();
    const matched = files.find(f => f.name.toLowerCase() === tmxFilename || f.relative_path.toLowerCase() === tmxFilename);

    if (!matched) {
      setTmxData(null);
      setTmxError(`TMX file "${activeRoom.tmxFile}" not found in project.`);
      return;
    }

    let isCancelled = false;
    invoke<string>('read_text_file', { filePath: matched.path })
      .then(async xmlStr => {
        try {
          const parsed = parseTmxXml(xmlStr);
          const tilesetErrors = await resolveExternalTilesets(
            parsed,
            parentDir(matched.path),
            filePath => invoke<string>('read_text_file', { filePath })
          );
          if (isCancelled) return;
          setTmxData(parsed);
          setTmxError(tilesetErrors.length ? tilesetErrors.join('; ') : null);
          setIsTmxDirty(false);
          historyRef.current = [{
            objects: JSON.parse(JSON.stringify(parsed.objects)),
            layers: JSON.parse(JSON.stringify(parsed.layers)),
            tilesets: JSON.parse(JSON.stringify(parsed.tilesets)),
            selectedObjectId: null
          }];
          historyIndexRef.current = 0;
          setCanUndo(false);
          setCanRedo(false);
        } catch (err: any) {
          if (isCancelled) return;
          setTmxData(null);
          setTmxError(`Failed to parse ${matched.name}: ${err?.message || err}`);
        }
      })
      .catch(err => {
        if (isCancelled) return;
        setTmxData(null);
        setTmxError(`Could not read file ${matched.name}: ${err}`);
      });
    return () => { isCancelled = true; };
  }, [activeRoom, projectPath, files]);

  // Validation of object IDs in current map
  const objectValidation = useMemo(() => {
    if (!tmxData || !tmxData.objects) return { valid: true, errors: [] };
    return validateObjectIds(tmxData.objects);
  }, [tmxData]);

  // Dirty detection
  const handleFieldChange = () => {
    setIsDirty(true);
    setSaveSuccess(false);
  };

  // Transfer room edits to in-memory .pak and persist TMX if modified
  const transferCurrentRoomToMemory = useCallback(async () => {
    if (!activeRoom) return;

    const trimmedId = editId.trim();
    if (!trimmedId) {
      setErrorMessage('Room ID cannot be empty.');
      return;
    }

    // Keep blank lines between rules as typed; only drop the ones at the end.
    const rulesLines = editRulesText.trimEnd().split('\n').map(line => line.trimEnd());
    if (rulesLines.length === 1 && rulesLines[0] === '') rulesLines.pop();

    const updatedRoom: PakRoom = {
      ...activeRoom,
      id: trimmedId,
      tmxFile: editTmxFile.trim(),
      x: editX,
      y: editY,
      subroom: editSubroom || undefined,
      rules: rulesLines
    };

    // Save TMX if modified
    if (isTmxDirty && tmxData) {
      const tmxFilename = updatedRoom.tmxFile.trim().toLowerCase();
      const matched = files.find(f => f.name.toLowerCase() === tmxFilename || f.relative_path.toLowerCase() === tmxFilename);
      if (matched) {
        const xml = serializeTmxXml(tmxData);
        await invoke('write_text_file', { filePath: matched.path, content: xml });
        setIsTmxDirty(false);
      }
    }

    await onTransferToMemory(activeRoom.filePath, updatedRoom, activeRoom.id);
    setSelectedRoomKey(`${activeRoom.filePath}:${trimmedId}`);
    setIsDirty(false);
  }, [activeRoom, editId, editTmxFile, editX, editY, editSubroom, editRulesText, isTmxDirty, tmxData, files, onTransferToMemory]);

  // Select room from sidebar
  const handleSelectRoom = async (roomKey: string) => {
    if (roomKey === selectedRoomKey) return;
    if (isDirty || isTmxDirty) {
      try {
        await transferCurrentRoomToMemory();
      } catch (err: any) {
        // E.g. the map can't be saved as it is: stay on this room so the edits aren't lost.
        setErrorMessage(err?.message || 'Failed to save room.');
        return;
      }
    }
    historyRef.current = [];
    historyIndexRef.current = -1;
    setCanUndo(false);
    setCanRedo(false);
    setSelectedRoomKey(roomKey);
  };

  // Save active room
  const handleSaveRoom = useCallback(async () => {
    setErrorMessage(null);
    try {
      if (isDirty || isTmxDirty) {
        await transferCurrentRoomToMemory();
      }
      await onSaveAll();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to save room.');
    }
  }, [isDirty, isTmxDirty, transferCurrentRoomToMemory, onSaveAll]);

  useEffect(() => {
    if (onRegisterSaveHandler) {
      onRegisterSaveHandler(handleSaveRoom);
    }
  }, [onRegisterSaveHandler, handleSaveRoom]);

  const pushHistory = useCallback((
    snapshotData?: {
      objects?: TmxObject[];
      layers?: TmxLayer[];
      tilesets?: TmxTileset[];
      selectedObjectId?: number | null;
    }
  ) => {
    if (!tmxData) return;
    const snapshot = {
      objects: JSON.parse(JSON.stringify(snapshotData?.objects ?? tmxData.objects)) as TmxObject[],
      layers: JSON.parse(JSON.stringify(snapshotData?.layers ?? tmxData.layers)) as TmxLayer[],
      tilesets: JSON.parse(JSON.stringify(snapshotData?.tilesets ?? tmxData.tilesets)) as TmxTileset[],
      selectedObjectId: snapshotData?.selectedObjectId !== undefined ? snapshotData.selectedObjectId : selectedObjectId,
    };
    const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    newHistory.push(snapshot);
    if (newHistory.length > DEFAULT_MAX_HISTORY_STEPS) {
      newHistory.shift();
    }
    historyRef.current = newHistory;
    historyIndexRef.current = newHistory.length - 1;
    updateUndoRedoState();
  }, [tmxData, selectedObjectId, updateUndoRedoState]);

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const target = historyRef.current[historyIndexRef.current];
    if (!target) return;

    setTmxData(prev => prev ? {
      ...prev,
      objects: JSON.parse(JSON.stringify(target.objects)),
      layers: JSON.parse(JSON.stringify(target.layers)),
      tilesets: JSON.parse(JSON.stringify(target.tilesets)),
    } : prev);
    setSelectedObjectId(target.selectedObjectId);
    setIsTmxDirty(true);
    setIsDirty(true);
    updateUndoRedoState();
  }, [updateUndoRedoState]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const target = historyRef.current[historyIndexRef.current];
    if (!target) return;

    setTmxData(prev => prev ? {
      ...prev,
      objects: JSON.parse(JSON.stringify(target.objects)),
      layers: JSON.parse(JSON.stringify(target.layers)),
      tilesets: JSON.parse(JSON.stringify(target.tilesets)),
    } : prev);
    setSelectedObjectId(target.selectedObjectId);
    setIsTmxDirty(true);
    setIsDirty(true);
    updateUndoRedoState();
  }, [updateUndoRedoState]);

  const handleUpdateTmxData = useCallback((newData: TmxData) => {
    setTmxData(newData);
    setIsTmxDirty(true);
    setIsDirty(true);
  }, []);

  const handleCommitTmxSnapshot = useCallback((
    updatedTmx: TmxData,
    newSelectedObjId?: number | null
  ) => {
    setTmxData(updatedTmx);
    setIsTmxDirty(true);
    setIsDirty(true);
    pushHistory({
      objects: updatedTmx.objects,
      layers: updatedTmx.layers,
      tilesets: updatedTmx.tilesets,
      selectedObjectId: newSelectedObjId !== undefined ? newSelectedObjId : selectedObjectId,
    });
  }, [pushHistory, selectedObjectId]);

  // Keyboard shortcut Cmd+S to save, Cmd+Z to undo, Cmd+Shift+Z / Ctrl+Y to redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        handleSaveRoom();
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
  }, [handleSaveRoom, handleUndo, handleRedo]);

  // Delete active room
  const handleDeleteRoom = async () => {
    if (!activeRoom) return;
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }

    try {
      await onDeleteRoomFromMemory(activeRoom.filePath, activeRoom.id);
      setIsConfirmingDelete(false);
      setIsDirty(false);

      const remaining = rooms.filter(r => `${r.filePath}:${r.id}` !== selectedRoomKey);
      if (remaining.length > 0) {
        setSelectedRoomKey(`${remaining[0].filePath}:${remaining[0].id}`);
      } else {
        setSelectedRoomKey(null);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to delete room.');
    }
  };

  // Canvas Object Manipulation Handlers (continuous updates e.g. during drag)
  const handleUpdateObject = useCallback((updated: TmxObject, prevId?: number) => {
    if (!tmxData) return;
    const matchId = prevId ?? updated.id;
    const nextObjects = tmxData.objects.map(o => o.id === matchId ? updated : o);
    setTmxData({ ...tmxData, objects: nextObjects });
    setIsTmxDirty(true);
    setIsDirty(true);
    if (prevId && prevId !== updated.id) {
      setSelectedObjectId(updated.id);
    }
  }, [tmxData]);

  // Committed object change (e.g. drag release, sidebar property change)
  const handleCommitObjectChange = useCallback((updated: TmxObject, prevId?: number) => {
    if (!tmxData) return;
    const matchId = prevId ?? updated.id;
    const nextObjects = tmxData.objects.map(o => o.id === matchId ? updated : o);
    setTmxData({ ...tmxData, objects: nextObjects });
    setIsTmxDirty(true);
    setIsDirty(true);
    if (prevId && prevId !== updated.id) {
      setSelectedObjectId(updated.id);
    }
    pushHistory({ objects: nextObjects, selectedObjectId: updated.id });
  }, [tmxData, pushHistory]);

  const handleDeleteObject = useCallback((id: number) => {
    if (!tmxData) return;
    const nextObjects = tmxData.objects.filter(o => o.id !== id);
    setTmxData({ ...tmxData, objects: nextObjects });
    setIsTmxDirty(true);
    setIsDirty(true);
    const nextSelected = selectedObjectId === id ? null : selectedObjectId;
    setSelectedObjectId(nextSelected);
    pushHistory({ objects: nextObjects, selectedObjectId: nextSelected });
  }, [tmxData, selectedObjectId, pushHistory]);

  const handleAddObject = useCallback((newObj: TmxObject) => {
    if (!tmxData) return;
    const nextObjects = [...tmxData.objects, newObj];
    setTmxData({ ...tmxData, objects: nextObjects });
    setIsTmxDirty(true);
    setIsDirty(true);
    setSelectedObjectId(newObj.id);
    pushHistory({ objects: nextObjects, selectedObjectId: newObj.id });
  }, [tmxData, pushHistory]);

  // Create New Room
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedId = newRoomId.trim();
    if (!trimmedId) return;

    const targetPak = newRoomTargetFile || pakFiles[0] || 'game.pak';
    const chosenTmx = newRoomTmx || (tmxFiles[0] || 'room.tmx');

    const newRoom: PakRoom = {
      id: trimmedId,
      tmxFile: chosenTmx,
      x: 0,
      y: 0,
      subroom: newRoomSubroom || undefined,
      rules: [],
      filePath: targetPak,
      startLine: 0,
      endLine: 0
    };

    let defaultTmxXml: string | undefined = undefined;
    const matched = files.find(f => f.name.toLowerCase() === chosenTmx.toLowerCase());
    if (!matched) {
      defaultTmxXml = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0" orientation="orthogonal" renderorder="right-down" width="32" height="11" tilewidth="8" tileheight="8" nextobjectid="2">
 <layer name="background" width="32" height="11">
  <data encoding="csv">
${Array(11).fill(Array(32).fill(0).join(',')).join(',\n')}
  </data>
 </layer>
 <objectgroup name="objects"/>
</map>`;
    }

    try {
      await onCreateRoomInMemory(targetPak, newRoom, defaultTmxXml);
      setIsNewRoomModalOpen(false);
      setNewRoomId('');
      setSelectedRoomKey(`${targetPak}:${trimmedId}`);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to create room.');
    }
  };

  const canSave = isDirty || isTmxDirty || hasUnsavedChanges;

  return (
    <div className="inspector-container">
      {/* Sidebar List */}
      <aside className="inspector-sidebar" style={{ width: sidebarWidth }}>
        <div className="inspector-sidebar-header">
          <div className="inspector-title-row">
            <span className="inspector-title">Rooms ({rooms.length})</span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setNewRoomId('');
                setNewRoomTmx(tmxFiles[0] || 'room.tmx');
                setNewRoomTargetFile(pakFiles[0] || 'game.pak');
                setNewRoomSubroom(false);
                setIsNewRoomModalOpen(true);
              }}
              title="Declare a new room"
            >
              <Plus size={14} />
              <span>New</span>
            </button>
          </div>

          <div className="inspector-search">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              placeholder="Search rooms..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
        </div>

        <ul className="inspector-item-list">
          {filteredRooms.length === 0 ? (
            <li className="inspector-item-empty">No rooms found</li>
          ) : (
            filteredRooms.map(r => {
              const key = `${r.filePath}:${r.id}`;
              const isSelected = key === selectedRoomKey;
              return (
                <li
                  key={key}
                  className={`inspector-item-row ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelectRoom(key)}
                >
                  <div className="item-row-icon">
                    <DoorOpen size={16} />
                  </div>
                  <div className="item-row-info">
                    <span className="item-row-name">{r.id}</span>
                    <span className="item-row-id">{r.tmxFile}{r.subroom ? ' (subroom)' : ''}</span>
                  </div>
                  <span className="item-row-file">{r.filePath}</span>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      <div
        className="resizer-vertical"
        onMouseDown={handleResizeStart}
        title="Drag to resize room list"
      />

      {/* Right Detail Pane */}
      <main className="inspector-main">
        {!activeRoom ? (
          <div className="no-selection-notice">
            <DoorOpen size={36} className="text-muted" />
            <p>Select a room from the sidebar to inspect or edit its properties.</p>
          </div>
        ) : (
          <div className="inspector-card room-inspector-card">
            {/* Header / Actions Bar */}
            <div className="inspector-card-header">
              <div className="card-header-left">
                <span className="card-item-tag">ROOM</span>
                <h3 className="card-item-title">{activeRoom.id}</h3>
                <span className="card-item-file-link" onClick={() => onOpenCodeAtLine(activeRoom.filePath, activeRoom.startLine + 1)}>
                  <FileCode2 size={13} />
                  <span>{activeRoom.filePath}:{activeRoom.startLine + 1}</span>
                  <ExternalLink size={11} />
                </span>
                {(isDirty || isTmxDirty) && <span className="unsaved-badge">Unsaved</span>}
              </div>

              <div className="card-header-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsRulesModalOpen(true)}
                  title="Open room rules & script editor"
                >
                  <FileText size={13} />
                  <span>Rules ({activeRoom.rules.filter(line => line.trim() !== '').length})</span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onOpenCodeAtLine(activeRoom.filePath, activeRoom.startLine + 1)}
                  title="Jump to code definition in Monaco Editor"
                >
                  <Code2 size={13} />
                  <span>Code</span>
                </button>

                <button
                  type="button"
                  className={`btn ${isConfirmingDelete ? 'btn-danger' : 'btn-secondary'} btn-sm`}
                  onClick={handleDeleteRoom}
                  title="Delete this room declaration"
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
                  onClick={handleSaveRoom}
                  disabled={!canSave}
                  title="Save room changes (Cmd+S)"
                >
                  {saveSuccess ? <Check size={13} /> : <Save size={13} />}
                  <span>{saveSuccess ? 'Saved!' : 'Save'}</span>
                </button>
              </div>
            </div>

            {/* Error Alerts */}
            {errorMessage && (
              <div className="inspector-alert error">
                <AlertCircle size={14} />
                <span>{errorMessage}</span>
              </div>
            )}

            {!objectValidation.valid && (
              <div className="inspector-alert error">
                <AlertCircle size={14} />
                <div>
                  <strong>Object ID Validation Issues:</strong>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {objectValidation.errors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Compact Top Properties Strip */}
            <div className="room-props-strip">
              <div className="room-prop-item">
                <label>ID:</label>
                <input
                  type="text"
                  className="text-input"
                  style={{ width: '130px', padding: '3px 8px' }}
                  value={editId}
                  onChange={e => { setEditId(e.target.value); handleFieldChange(); }}
                />
              </div>

              <div className="room-prop-item">
                <label>TMX Map:</label>
                {tmxFiles.length > 0 ? (
                  <select
                    className="select-input"
                    style={{ padding: '3px 8px', maxWidth: '160px' }}
                    value={editTmxFile}
                    onChange={e => { setEditTmxFile(e.target.value); handleFieldChange(); }}
                  >
                    {tmxFiles.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="text-input"
                    style={{ width: '120px', padding: '3px 8px' }}
                    value={editTmxFile}
                    onChange={e => { setEditTmxFile(e.target.value); handleFieldChange(); }}
                  />
                )}
                {editTmxFile && onOpenTmxFile && (
                  <button
                    type="button"
                    className="icon-action-btn"
                    onClick={() => onOpenTmxFile(editTmxFile)}
                    title="Open TMX in editor"
                  >
                    <ExternalLink size={12} />
                  </button>
                )}
              </div>

              <div className="room-prop-item">
                <label>Offset X:</label>
                <input
                  type="number"
                  className="text-input num-input"
                  style={{ width: '55px', padding: '3px 6px' }}
                  value={editX}
                  onChange={e => { setEditX(parseInt(e.target.value, 10) || 0); handleFieldChange(); }}
                />
              </div>

              <div className="room-prop-item">
                <label>Offset Y:</label>
                <input
                  type="number"
                  className="text-input num-input"
                  style={{ width: '55px', padding: '3px 6px' }}
                  value={editY}
                  onChange={e => { setEditY(parseInt(e.target.value, 10) || 0); handleFieldChange(); }}
                />
              </div>

              <div className="room-prop-item">
                <label className="checkbox-label" style={{ fontSize: '11px', gap: '4px' }}>
                  <input
                    type="checkbox"
                    checked={editSubroom}
                    onChange={e => { setEditSubroom(e.target.checked); handleFieldChange(); }}
                  />
                  <span>Subroom</span>
                </label>
              </div>

              {tmxError && <span className="form-error-inline" style={{ margin: 0 }}>{tmxError}</span>}
            </div>

            {/* Interactive Visual Room Canvas (Center Viewport) */}
            {tmxData ? (
              <RoomCanvas
                tmxData={tmxData}
                tmxFilePath={activeTmxFileNode?.path}
                projectObjects={projectObjects}
                projectPath={projectPath}
                files={files}
                platform={platform}
                screenGuidelines={screenGuidelines}
                onUpdateObject={handleUpdateObject}
                onDeleteObject={handleDeleteObject}
                onAddObject={handleAddObject}
                selectedObjectId={selectedObjectId}
                onSelectObjectId={setSelectedObjectId}
                onMarkDirty={handleFieldChange}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onCommitObjectChange={handleCommitObjectChange}
                onUpdateTmxData={handleUpdateTmxData}
                onCommitTmxSnapshot={handleCommitTmxSnapshot}
              />
            ) : (
              <div className="tmx-placeholder-notice" style={{ margin: '32px' }}>
                {tmxError || 'Loading TMX map...'}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Room Rules & Scripts Editor Modal */}
      {isRulesModalOpen && activeRoom && (
        <div className="modal-overlay" onClick={() => setIsRulesModalOpen(false)}>
          <div className="modal-dialog modal-dialog-lg" onClick={e => e.stopPropagation()} style={{ width: '800px', maxWidth: '90vw' }}>
            <div className="modal-header">
              <div className="modal-title-group">
                <FileText size={18} className="modal-icon text-accent" />
                <span className="modal-title">Room Rules & Scripts: {activeRoom.id}</span>
              </div>
              <button
                type="button"
                className="icon-action-btn"
                onClick={() => setIsRulesModalOpen(false)}
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '8px 16px' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '11px', color: 'var(--text-muted)' }}>
                Define rules that trigger when entering, examining, or interacting with room objects.
              </p>
              <div className="room-rules-editor-wrap" style={{ border: '1px solid var(--border-subtle)', borderRadius: '4px', overflow: 'hidden' }}>
                <Editor
                  height="450px"
                  language="paket"
                  theme="paket-dark"
                  value={editRulesText}
                  onChange={val => { setEditRulesText(val || ''); handleFieldChange(); }}
                  options={{
                    fontSize: 13,
                    lineNumbers: 'on',
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 4,
                    wordWrap: 'on'
                  }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIsRulesModalOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Room Modal */}
      {isNewRoomModalOpen && (
        <div className="modal-overlay" onClick={() => setIsNewRoomModalOpen(false)}>
          <div className="modal-dialog modal-dialog-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <DoorOpen size={18} className="modal-icon" />
                <span className="modal-title">Create New Room</span>
              </div>
            </div>
            <form onSubmit={handleCreateRoom}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Room ID:</label>
                  <input
                    type="text"
                    className="text-input"
                    value={newRoomId}
                    onChange={e => setNewRoomId(e.target.value)}
                    placeholder="e.g. kitchen"
                    autoFocus
                  />
                  <span className="form-hint">Used in scripts like <code>go-to-room("kitchen")</code></span>
                </div>

                <div className="form-group">
                  <label>TMX Map File:</label>
                  {tmxFiles.length > 0 ? (
                    <select
                      className="select-input"
                      value={newRoomTmx}
                      onChange={e => setNewRoomTmx(e.target.value)}
                    >
                      {tmxFiles.map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="text-input"
                      value={newRoomTmx}
                      onChange={e => setNewRoomTmx(e.target.value)}
                      placeholder="room.tmx"
                    />
                  )}
                </div>

                <div className="form-group">
                  <label>Target .pak Script File:</label>
                  <select
                    className="select-input"
                    value={newRoomTargetFile}
                    onChange={e => setNewRoomTargetFile(e.target.value)}
                  >
                    {pakFiles.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>

                <div className="checkbox-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={newRoomSubroom}
                      onChange={e => setNewRoomSubroom(e.target.checked)}
                    />
                    <span>Subroom (secondary/overlay room)</span>
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsNewRoomModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!newRoomId.trim()}
                >
                  Create Room
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
