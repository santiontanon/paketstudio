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
  AlertTriangle,
  FileCode2,
  ExternalLink,
  FileText,
  Maximize2,
  X
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { safeInvoke as invoke } from '../utils/ipc';
import type { PakRoom, PakObject, FileNode, TmxData, TmxObject, TmxLayer, TmxTileset, Platform } from '../types';
import {
  parseTmxXml,
  serializeTmxXml,
  validateObjectIds,
  resolveExternalTilesets,
  createEmptyTmxData,
  createEmbeddedTileset,
  resizeTmxData
} from '../utils/tmxParser';
import {
  getScreenGuidelines,
  getDefaultTileSize,
  getMaxRoomOffset,
  validateRoomDimensions,
  isCpcPlatform
} from '../utils/screenAreas';
import { parentDir, relativePathFromDir } from '../utils/paths';
import { RoomCanvas } from './RoomCanvas';
import { ResizeRoomModal } from './ResizeRoomModal';
import {
  STORAGE_KEYS,
  DEFAULT_INSPECTOR_SIDEBAR_WIDTH,
  MIN_INSPECTOR_SIDEBAR_WIDTH,
  MAX_INSPECTOR_SIDEBAR_WIDTH,
  DEFAULT_MAX_HISTORY_STEPS,
  DEFAULT_NEW_TMX_NAME,
  DEFAULT_TILESET_FILENAME,
  DEFAULT_BACKGROUND_TILE_GID,
  MIN_ROOM_SIZE
} from '../constants';

function pickDefaultTilesetPng(
  pngFiles: FileNode[],
  targetPak: string,
  activeTilesetSource?: string
): string {
  if (pngFiles.length === 0) return '';
  const pakDir = parentDir(targetPak).toLowerCase();
  const inPakDir = pakDir
    ? pngFiles.filter(f => parentDir(f.relative_path).toLowerCase() === pakDir)
    : pngFiles;

  const preferredBg =
    inPakDir.find(f => f.name.toLowerCase() === DEFAULT_TILESET_FILENAME) ??
    pngFiles.find(f => f.name.toLowerCase() === DEFAULT_TILESET_FILENAME);
  if (preferredBg) return preferredBg.relative_path;

  if (activeTilesetSource) {
    const activeName = (activeTilesetSource.split('/').pop() || activeTilesetSource).toLowerCase();
    const matchedActive =
      inPakDir.find(f => f.name.toLowerCase() === activeName) ??
      pngFiles.find(f => f.name.toLowerCase() === activeName);
    if (matchedActive) return matchedActive.relative_path;
  }

  return (inPakDir[0] ?? pngFiles[0]).relative_path;
}

function findTmxFileNode(files: FileNode[], tmxFile: string, pakFilePath: string): FileNode | undefined {
  const clean = tmxFile.trim().toLowerCase();
  if (!clean) return undefined;
  const pakDir = parentDir(pakFilePath).toLowerCase();
  if (pakDir && !clean.includes('/')) {
    const siblingPath = `${pakDir}/${clean}`;
    const sibling = files.find(f => f.relative_path.toLowerCase() === siblingPath);
    if (sibling) return sibling;
  }
  return files.find(f => f.relative_path.toLowerCase() === clean || f.name.toLowerCase() === clean);
}

function suggestTmxFileName(roomId: string): string {
  const sanitized = roomId.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized ? `${sanitized}.tmx` : DEFAULT_NEW_TMX_NAME;
}

interface RoomInspectorProps {
  rooms: PakRoom[];
  projectPath: string;
  files: FileNode[];
  projectObjects: PakObject[];
  platform: Platform;
  pakTexts: string[];
  onOpenCodeAtLine: (filePath: string, line: number) => void;
  onTransferToMemory: (relPath: string, updatedRoom: PakRoom, targetId: string) => Promise<void>;
  onDeleteRoomFromMemory: (relPath: string, targetId: string) => Promise<void>;
  onCreateRoomInMemory: (relPath: string, newRoom: PakRoom, tmxContent?: string) => Promise<void>;
  onSaveAll: () => Promise<void>;
  hasUnsavedChanges: boolean;
  onOpenTmxFile?: (fileName: string) => void;
  onRegisterSaveHandler?: (handler: () => Promise<void>) => void;
  onRegisterFlushHandler?: (handler: () => Promise<void>) => void;
}

export const RoomInspector: React.FC<RoomInspectorProps> = ({
  rooms,
  projectPath,
  files,
  projectObjects,
  platform,
  pakTexts,
  onOpenCodeAtLine,
  onTransferToMemory,
  onDeleteRoomFromMemory,
  onCreateRoomInMemory,
  onSaveAll,
  hasUnsavedChanges,
  onOpenTmxFile,
  onRegisterSaveHandler,
  onRegisterFlushHandler
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

  // Rules & Resize Modal state
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [isResizeModalOpen, setIsResizeModalOpen] = useState(false);
  const [resizeNotice, setResizeNotice] = useState<string | null>(null);

  // TMX data for active room
  const [tmxData, setTmxData] = useState<TmxData | null>(null);
  const [tmxError, setTmxError] = useState<string | null>(null);
  const [isTmxDirty, setIsTmxDirty] = useState(false);

  // Selected object ID on the visual canvas
  const [selectedObjectId, setSelectedObjectId] = useState<number | null>(null);

  // Undo / Redo history
  const historyRef = useRef<Array<{
    width: number;
    height: number;
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
  const [newRoomTmxMode, setNewRoomTmxMode] = useState<'new' | 'existing'>('new');
  const [newRoomTmx, setNewRoomTmx] = useState('');
  const [isNewRoomTmxManuallyEdited, setIsNewRoomTmxManuallyEdited] = useState(false);
  const [newRoomWidth, setNewRoomWidth] = useState(16);
  const [newRoomHeight, setNewRoomHeight] = useState(11);
  const [newRoomTilesetPng, setNewRoomTilesetPng] = useState('');
  const [newRoomTilesetDims, setNewRoomTilesetDims] = useState<{ width: number; height: number } | null>(null);
  const [isLoadingNewRoomTileset, setIsLoadingNewRoomTileset] = useState(false);
  const [newRoomTargetFile, setNewRoomTargetFile] = useState('');
  const [newRoomSubroom, setNewRoomSubroom] = useState(false);
  const [newRoomError, setNewRoomError] = useState<string | null>(null);

  // Pak, Tmx, and Png file lists in project
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

  const pngFiles = useMemo(() => {
    return files.filter(f => f.extension.toLowerCase() === 'png' && !f.is_dir);
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
    return findTmxFileNode(files, activeRoom.tmxFile, activeRoom.filePath);
  }, [activeRoom, files]);

  // Project-level screen guidelines (using platform default tile size, for new room defaults)
  const defaultTileSize = useMemo(() => getDefaultTileSize(platform), [platform]);
  const projectScreenGuidelines = useMemo(
    () => getScreenGuidelines(platform, pakTexts, defaultTileSize.tileWidth, defaultTileSize.tileHeight),
    [platform, pakTexts, defaultTileSize.tileWidth, defaultTileSize.tileHeight]
  );

  // Screen Guidelines computed for active room and platform
  const screenGuidelines = useMemo(
    () => getScreenGuidelines(
      platform,
      pakTexts,
      tmxData?.tilewidth ?? defaultTileSize.tileWidth,
      tmxData?.tileheight ?? defaultTileSize.tileHeight
    ),
    [platform, pakTexts, tmxData?.tilewidth, tmxData?.tileheight, defaultTileSize.tileWidth, defaultTileSize.tileHeight]
  );

  const { maxOffsetX, maxOffsetY } = useMemo(
    () => getMaxRoomOffset(
      screenGuidelines.gameArea.width,
      screenGuidelines.gameArea.height,
      tmxData ? tmxData.width : MIN_ROOM_SIZE,
      tmxData ? tmxData.height : MIN_ROOM_SIZE
    ),
    [screenGuidelines.gameArea.width, screenGuidelines.gameArea.height, tmxData]
  );

  const roomBoundsWarning = useMemo(() => {
    if (!tmxData) return null;
    return validateRoomDimensions(
      tmxData.width,
      tmxData.height,
      editX,
      editY,
      screenGuidelines.gameArea.width,
      screenGuidelines.gameArea.height
    );
  }, [tmxData, editX, editY, screenGuidelines.gameArea.width, screenGuidelines.gameArea.height]);

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
      setResizeNotice(null);
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

    const matched = findTmxFileNode(files, activeRoom.tmxFile, activeRoom.filePath);

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
            width: parsed.width,
            height: parsed.height,
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
      const matched = findTmxFileNode(files, updatedRoom.tmxFile, activeRoom.filePath);
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

  const handleFlushRoom = useCallback(async () => {
    if (isDirty || isTmxDirty) {
      await transferCurrentRoomToMemory();
    }
  }, [isDirty, isTmxDirty, transferCurrentRoomToMemory]);

  useEffect(() => {
    if (onRegisterFlushHandler) {
      onRegisterFlushHandler(handleFlushRoom);
    }
  }, [onRegisterFlushHandler, handleFlushRoom]);

  const pushHistory = useCallback((
    snapshotData?: {
      width?: number;
      height?: number;
      objects?: TmxObject[];
      layers?: TmxLayer[];
      tilesets?: TmxTileset[];
      selectedObjectId?: number | null;
    }
  ) => {
    if (!tmxData) return;
    const snapshot = {
      width: snapshotData?.width ?? tmxData.width,
      height: snapshotData?.height ?? tmxData.height,
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
      width: target.width,
      height: target.height,
      objects: JSON.parse(JSON.stringify(target.objects)),
      layers: JSON.parse(JSON.stringify(target.layers)),
      tilesets: JSON.parse(JSON.stringify(target.tilesets)),
    } : prev);
    setSelectedObjectId(target.selectedObjectId);
    setResizeNotice(null);
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
      width: target.width,
      height: target.height,
      objects: JSON.parse(JSON.stringify(target.objects)),
      layers: JSON.parse(JSON.stringify(target.layers)),
      tilesets: JSON.parse(JSON.stringify(target.tilesets)),
    } : prev);
    setSelectedObjectId(target.selectedObjectId);
    setResizeNotice(null);
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
      width: updatedTmx.width,
      height: updatedTmx.height,
      objects: updatedTmx.objects,
      layers: updatedTmx.layers,
      tilesets: updatedTmx.tilesets,
      selectedObjectId: newSelectedObjId !== undefined ? newSelectedObjId : selectedObjectId,
    });
  }, [pushHistory, selectedObjectId]);

  const handleResizeRoom = useCallback((newWidth: number, newHeight: number) => {
    if (!tmxData) return;
    const { tmx: resized, clampedObjects } = resizeTmxData(
      tmxData,
      newWidth,
      newHeight,
      isCpcPlatform(platform)
    );
    handleCommitTmxSnapshot(resized, selectedObjectId);
    if (clampedObjects.length > 0) {
      const label = clampedObjects.length === 1 ? '1 object was' : `${clampedObjects.length} objects were`;
      setResizeNotice(`${label} clamped inside the new ${newWidth}×${newHeight} room bounds. Press Cmd/Ctrl+Z to undo.`);
    } else {
      setResizeNotice(null);
    }
  }, [tmxData, platform, handleCommitTmxSnapshot, selectedObjectId]);

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

  // Load selected tileset PNG dimensions for the New Room modal
  useEffect(() => {
    if (!isNewRoomModalOpen || newRoomTmxMode !== 'new' || !newRoomTilesetPng || !projectPath) {
      setNewRoomTilesetDims(null);
      setIsLoadingNewRoomTileset(false);
      return;
    }

    let isCancelled = false;
    setIsLoadingNewRoomTileset(true);
    const fullPath = `${projectPath}/${newRoomTilesetPng}`;

    invoke<string>('read_file_base64', { filePath: fullPath })
      .then(base64Data => {
        if (isCancelled) return;
        const img = new Image();
        img.onload = () => {
          if (isCancelled) return;
          setNewRoomTilesetDims({ width: img.naturalWidth, height: img.naturalHeight });
          setIsLoadingNewRoomTileset(false);
        };
        img.onerror = () => {
          if (isCancelled) return;
          setNewRoomTilesetDims(null);
          setNewRoomError(`Could not decode image "${newRoomTilesetPng}".`);
          setIsLoadingNewRoomTileset(false);
        };
        img.src = base64Data;
      })
      .catch(err => {
        if (isCancelled) return;
        setNewRoomTilesetDims(null);
        setNewRoomError(`Could not read image "${newRoomTilesetPng}": ${err}`);
        setIsLoadingNewRoomTileset(false);
      });

    return () => { isCancelled = true; };
  }, [isNewRoomModalOpen, newRoomTmxMode, newRoomTilesetPng, projectPath]);

  const newRoomTilesetCount = useMemo(() => {
    if (!newRoomTilesetDims) return 0;
    const cols = Math.floor(newRoomTilesetDims.width / defaultTileSize.tileWidth);
    const rows = Math.floor(newRoomTilesetDims.height / defaultTileSize.tileHeight);
    return cols * rows;
  }, [newRoomTilesetDims, defaultTileSize.tileWidth, defaultTileSize.tileHeight]);

  // Live validation for Create New Room modal
  const newRoomDimensionError = useMemo(() => {
    if (newRoomTmxMode !== 'new') return null;
    const dimErr = validateRoomDimensions(
      newRoomWidth,
      newRoomHeight,
      0,
      0,
      projectScreenGuidelines.gameArea.width,
      projectScreenGuidelines.gameArea.height
    );
    if (dimErr) return dimErr;
    if (pngFiles.length > 0 && !isLoadingNewRoomTileset && newRoomTilesetPng && newRoomTilesetDims && newRoomTilesetCount <= 0) {
      return `Selected image is smaller than a ${defaultTileSize.tileWidth}×${defaultTileSize.tileHeight} tile.`;
    }
    return null;
  }, [
    newRoomTmxMode,
    newRoomWidth,
    newRoomHeight,
    projectScreenGuidelines.gameArea.width,
    projectScreenGuidelines.gameArea.height,
    pngFiles.length,
    isLoadingNewRoomTileset,
    newRoomTilesetPng,
    newRoomTilesetDims,
    newRoomTilesetCount,
    defaultTileSize.tileWidth,
    defaultTileSize.tileHeight
  ]);

  // Create New Room
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewRoomError(null);

    const trimmedId = newRoomId.trim();
    if (!trimmedId) {
      setNewRoomError('Room ID cannot be empty.');
      return;
    }

    if (rooms.some(r => r.id === trimmedId)) {
      setNewRoomError(`A room with ID "${trimmedId}" already exists.`);
      return;
    }

    const targetPak = newRoomTargetFile || pakFiles[0] || 'game.pak';
    let chosenTmx = newRoomTmx.trim();
    let defaultTmxXml: string | undefined = undefined;

    if (newRoomTmxMode === 'new') {
      if (!chosenTmx) {
        setNewRoomError('Please enter a filename for the new .tmx map.');
        return;
      }
      if (/[\\?%*:|"<>]/.test(chosenTmx)) {
        setNewRoomError('TMX filename contains invalid characters.');
        return;
      }
      if (!chosenTmx.toLowerCase().endsWith('.tmx')) {
        chosenTmx = `${chosenTmx}.tmx`;
      }
      if (newRoomDimensionError) {
        setNewRoomError(newRoomDimensionError);
        return;
      }

      const pakDir = parentDir(targetPak);
      const targetRelPath = pakDir && !chosenTmx.includes('/') ? `${pakDir}/${chosenTmx}` : chosenTmx;
      const alreadyExists = files.some(
        f => f.relative_path.toLowerCase() === targetRelPath.toLowerCase()
      );
      if (alreadyExists) {
        setNewRoomError(`A file named "${targetRelPath}" already exists. Choose a different name or select "Use existing .tmx".`);
        return;
      }

      const initialTilesets: TmxTileset[] = [];
      if (pngFiles.length > 0) {
        if (!newRoomTilesetPng || !newRoomTilesetDims || newRoomTilesetCount <= 0) {
          setNewRoomError('Please select a valid tileset PNG image.');
          return;
        }
        const tmxDirRel = parentDir(targetRelPath);
        const relImgSource = relativePathFromDir(tmxDirRel, newRoomTilesetPng);
        initialTilesets.push(
          createEmbeddedTileset(
            relImgSource,
            newRoomTilesetDims.width,
            newRoomTilesetDims.height,
            defaultTileSize.tileWidth,
            defaultTileSize.tileHeight,
            DEFAULT_BACKGROUND_TILE_GID
          )
        );
      }

      defaultTmxXml = serializeTmxXml(
        createEmptyTmxData(
          newRoomWidth,
          newRoomHeight,
          defaultTileSize.tileWidth,
          defaultTileSize.tileHeight,
          initialTilesets
        )
      );
    } else if (!chosenTmx) {
      setNewRoomError('Please select an existing .tmx file.');
      return;
    }

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

    try {
      if (isDirty || isTmxDirty) {
        await transferCurrentRoomToMemory();
      }
      await onCreateRoomInMemory(targetPak, newRoom, defaultTmxXml);
      setIsNewRoomModalOpen(false);
      setNewRoomId('');
      setNewRoomError(null);
      setSelectedRoomKey(`${targetPak}:${trimmedId}`);
    } catch (err: any) {
      setNewRoomError(err?.message || 'Failed to create room.');
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
                const defaultPak = pakFiles[0] || 'game.pak';
                setNewRoomId('');
                setNewRoomTmxMode('new');
                setNewRoomTmx(DEFAULT_NEW_TMX_NAME);
                setIsNewRoomTmxManuallyEdited(false);
                setNewRoomWidth(projectScreenGuidelines.gameArea.width);
                setNewRoomHeight(projectScreenGuidelines.gameArea.height);
                setNewRoomTargetFile(defaultPak);
                setNewRoomTilesetPng(pickDefaultTilesetPng(pngFiles, defaultPak, tmxData?.tilesets[0]?.image.source));
                setNewRoomSubroom(false);
                setNewRoomError(null);
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

            {tmxData && tmxData.tilesets.length === 0 && (
              <div
                className="inspector-alert"
                style={{
                  background: 'rgba(245, 158, 11, 0.12)',
                  borderColor: 'rgba(245, 158, 11, 0.4)',
                  color: '#f59e0b',
                }}
              >
                <AlertTriangle size={14} />
                <span>This room has no tileset attached. Switch to Background mode and click &quot;Add Tileset&quot; before compiling.</span>
              </div>
            )}

            {roomBoundsWarning && (
              <div
                className="inspector-alert"
                style={{
                  background: 'rgba(245, 158, 11, 0.12)',
                  borderColor: 'rgba(245, 158, 11, 0.4)',
                  color: '#f59e0b',
                }}
              >
                <AlertTriangle size={14} />
                <span>Room exceeds game area: {roomBoundsWarning}</span>
              </div>
            )}

            {resizeNotice && (
              <div
                className="inspector-alert"
                style={{
                  background: 'rgba(245, 158, 11, 0.12)',
                  borderColor: 'rgba(245, 158, 11, 0.4)',
                  color: '#f59e0b',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertTriangle size={14} />
                  <span>{resizeNotice}</span>
                </div>
                <button
                  type="button"
                  className="icon-action-btn"
                  onClick={() => setResizeNotice(null)}
                  title="Dismiss"
                >
                  <X size={13} />
                </button>
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
                  min={0}
                  max={maxOffsetX}
                  value={editX}
                  title={`Tile offset X (0–${maxOffsetX} to stay within ${screenGuidelines.gameArea.width}-tile game area)`}
                  onChange={e => {
                    const parsed = parseInt(e.target.value, 10);
                    const clamped = Math.max(0, Math.min(maxOffsetX, isNaN(parsed) ? 0 : parsed));
                    setEditX(clamped);
                    handleFieldChange();
                  }}
                />
              </div>

              <div className="room-prop-item">
                <label>Offset Y:</label>
                <input
                  type="number"
                  className="text-input num-input"
                  style={{ width: '55px', padding: '3px 6px' }}
                  min={0}
                  max={maxOffsetY}
                  value={editY}
                  title={`Tile offset Y (0–${maxOffsetY} to stay within ${screenGuidelines.gameArea.height}-tile game area)`}
                  onChange={e => {
                    const parsed = parseInt(e.target.value, 10);
                    const clamped = Math.max(0, Math.min(maxOffsetY, isNaN(parsed) ? 0 : parsed));
                    setEditY(clamped);
                    handleFieldChange();
                  }}
                />
              </div>

              {tmxData && (
                <div className="room-prop-item">
                  <label>Size:</label>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                    {tmxData.width}×{tmxData.height}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '2px 7px', fontSize: '11px' }}
                    onClick={() => setIsResizeModalOpen(true)}
                    title={`Resize room dimensions (max ${screenGuidelines.gameArea.width}×${screenGuidelines.gameArea.height} tiles for game area)`}
                  >
                    <Maximize2 size={11} />
                    <span>Resize...</span>
                  </button>
                </div>
              )}

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
                roomOffsetX={editX}
                roomOffsetY={editY}
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
        <div
          className="modal-overlay"
          onMouseDown={e => { if (e.target === e.currentTarget) setIsRulesModalOpen(false); }}
        >
          <div className="modal-dialog modal-dialog-lg" style={{ width: '800px', maxWidth: '90vw' }}>
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

      {/* Resize Room Modal */}
      {tmxData && (
        <ResizeRoomModal
          isOpen={isResizeModalOpen}
          onClose={() => setIsResizeModalOpen(false)}
          tmxData={tmxData}
          offsetX={editX}
          offsetY={editY}
          gameAreaWidth={screenGuidelines.gameArea.width}
          gameAreaHeight={screenGuidelines.gameArea.height}
          onResize={handleResizeRoom}
        />
      )}

      {/* New Room Modal */}
      {isNewRoomModalOpen && (
        <div
          className="modal-overlay"
          onMouseDown={e => { if (e.target === e.currentTarget) setIsNewRoomModalOpen(false); }}
        >
          <div className="modal-dialog modal-dialog-sm">
            <div className="modal-header">
              <div className="modal-title-group">
                <DoorOpen size={18} className="modal-icon" />
                <span className="modal-title">Create New Room</span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsNewRoomModalOpen(false)}
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCreateRoom}>
              <div className="modal-body">
                {(newRoomError || newRoomDimensionError) && (
                  <div className="inspector-alert error" style={{ marginBottom: '12px' }}>
                    <AlertCircle size={14} style={{ flexShrink: 0 }} />
                    <span>{newRoomError || newRoomDimensionError}</span>
                  </div>
                )}

                <div className="form-group">
                  <label>Room ID:</label>
                  <input
                    type="text"
                    className="text-input"
                    value={newRoomId}
                    onChange={e => {
                      const nextId = e.target.value;
                      setNewRoomId(nextId);
                      setNewRoomError(null);
                      if (newRoomTmxMode === 'new' && !isNewRoomTmxManuallyEdited) {
                        setNewRoomTmx(suggestTmxFileName(nextId));
                      }
                    }}
                    placeholder="e.g. kitchen"
                    autoFocus
                  />
                  <span className="form-hint">Used in scripts like <code>go-to-room("kitchen")</code></span>
                </div>

                <div className="form-group">
                  <label>TMX Map File:</label>
                  {tmxFiles.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                      <button
                        type="button"
                        className={`btn-toolbar-toggle ${newRoomTmxMode === 'new' ? 'active' : ''}`}
                        style={{ flex: 1, padding: '4px 8px' }}
                        onClick={() => {
                          setNewRoomTmxMode('new');
                          setNewRoomTmx(suggestTmxFileName(newRoomId));
                          setIsNewRoomTmxManuallyEdited(false);
                          setNewRoomError(null);
                        }}
                      >
                        Create new .tmx
                      </button>
                      <button
                        type="button"
                        className={`btn-toolbar-toggle ${newRoomTmxMode === 'existing' ? 'active' : ''}`}
                        style={{ flex: 1, padding: '4px 8px' }}
                        onClick={() => {
                          setNewRoomTmxMode('existing');
                          setNewRoomTmx(tmxFiles[0] || '');
                          setNewRoomError(null);
                        }}
                      >
                        Use existing .tmx
                      </button>
                    </div>
                  )}

                  {newRoomTmxMode === 'existing' && tmxFiles.length > 0 ? (
                    <select
                      className="select-input"
                      value={newRoomTmx}
                      onChange={e => { setNewRoomTmx(e.target.value); setNewRoomError(null); }}
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
                      onChange={e => {
                        setNewRoomTmx(e.target.value);
                        setIsNewRoomTmxManuallyEdited(true);
                        setNewRoomError(null);
                      }}
                      placeholder="kitchen.tmx"
                    />
                  )}
                </div>

                {newRoomTmxMode === 'new' && (
                  <>
                    <div className="form-group-card">
                      <div className="form-row-2col">
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>Width (tiles):</label>
                          <input
                            type="number"
                            className="text-input num-input"
                            min={MIN_ROOM_SIZE}
                            max={projectScreenGuidelines.gameArea.width}
                            value={newRoomWidth}
                            onChange={e => {
                              setNewRoomWidth(parseInt(e.target.value, 10) || 0);
                              setNewRoomError(null);
                            }}
                          />
                          <span className="form-hint">
                            Max {projectScreenGuidelines.gameArea.width} ({Math.max(0, newRoomWidth) * defaultTileSize.tileWidth} px)
                          </span>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>Height (tiles):</label>
                          <input
                            type="number"
                            className="text-input num-input"
                            min={MIN_ROOM_SIZE}
                            max={projectScreenGuidelines.gameArea.height}
                            value={newRoomHeight}
                            onChange={e => {
                              setNewRoomHeight(parseInt(e.target.value, 10) || 0);
                              setNewRoomError(null);
                            }}
                          />
                          <span className="form-hint">
                            Max {projectScreenGuidelines.gameArea.height} ({Math.max(0, newRoomHeight) * defaultTileSize.tileHeight} px)
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Tileset PNG Image:</label>
                      {pngFiles.length > 0 ? (
                        <>
                          <select
                            className="select-input"
                            value={newRoomTilesetPng}
                            onChange={e => {
                              setNewRoomTilesetPng(e.target.value);
                              setNewRoomError(null);
                            }}
                          >
                            {pngFiles.map(f => (
                              <option key={f.relative_path} value={f.relative_path}>
                                {f.relative_path}
                              </option>
                            ))}
                          </select>
                          <span className="form-hint">
                            {isLoadingNewRoomTileset
                              ? 'Reading image dimensions...'
                              : newRoomTilesetDims
                                ? `${newRoomTilesetDims.width}×${newRoomTilesetDims.height} px → ${newRoomTilesetCount} tiles (${defaultTileSize.tileWidth}×${defaultTileSize.tileHeight} px)`
                                : 'Attached as first tileset (GID 1).'}
                          </span>
                        </>
                      ) : (
                        <span className="form-hint">
                          No .png files found in this project. You can attach a tileset later before compiling.
                        </span>
                      )}
                    </div>
                  </>
                )}

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
                  disabled={
                    !newRoomId.trim() ||
                    !newRoomTmx.trim() ||
                    Boolean(newRoomDimensionError) ||
                    (newRoomTmxMode === 'new' && pngFiles.length > 0 && (isLoadingNewRoomTileset || newRoomTilesetCount <= 0))
                  }
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
