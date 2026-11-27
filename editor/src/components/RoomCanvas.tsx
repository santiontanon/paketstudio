import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Grid,
  Plus,
  Trash2,
  Copy,
  Layers,
  Crosshair,
  User,
  Box,
  ArrowDown,
  X,
  AlertTriangle,
  RotateCcw,
  RotateCw,
  Shield,
  Pencil,
  Eraser,
  Pipette,
  Image as ImageIcon
} from 'lucide-react';
import { safeInvoke as invoke } from '../utils/ipc';
import type { TmxData, TmxObject, TmxLayer, TmxTileset, PakObject, FileNode, Platform } from '../types';
import type { ScreenGuidelines } from '../utils/screenAreas';
import { isCpcPlatform } from '../utils/screenAreas';
import {
  getNextAvailableObjectId,
  getPaketObjectId,
  setPaketObjectId,
  isObjectIdTaken
} from '../utils/tmxParser';
import { parentDir, isAbsolutePath } from '../utils/paths';
import { statePreviewImage } from '../utils/pakParser';
import { COMMON_DIRECTIONS, PLAYER_OBJECT_ID } from '../constants';
import { AddTilesetModal } from './AddTilesetModal';

export type RoomCanvasMode = 'objects' | 'background' | 'collision';
export type TileTool = 'brush' | 'eraser' | 'picker';

interface RoomCanvasProps {
  tmxData: TmxData;
  tmxFilePath?: string;
  projectObjects: PakObject[];
  projectPath: string;
  files: FileNode[];
  platform: Platform;
  screenGuidelines: ScreenGuidelines;
  roomOffsetX: number;
  roomOffsetY: number;
  onUpdateObject: (updated: TmxObject, prevId?: number) => void;
  onDeleteObject: (id: number) => void;
  onAddObject: (newObj: TmxObject) => void;
  selectedObjectId: number | null;
  onSelectObjectId: (id: number | null) => void;
  onMarkDirty: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCommitObjectChange: (updated: TmxObject, prevId?: number) => void;
  onUpdateTmxData?: (newData: TmxData) => void;
  onCommitTmxSnapshot?: (updated: TmxData, newSelectedObjId?: number | null) => void;
}

export const RoomCanvas: React.FC<RoomCanvasProps> = ({
  tmxData,
  tmxFilePath,
  projectObjects,
  projectPath,
  files,
  platform,
  screenGuidelines,
  roomOffsetX,
  roomOffsetY,
  onUpdateObject,
  onDeleteObject,
  onAddObject,
  selectedObjectId,
  onSelectObjectId,
  onMarkDirty,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCommitObjectChange,
  onUpdateTmxData,
  onCommitTmxSnapshot,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const isCpc = isCpcPlatform(platform);

  // Active Canvas Mode: Objects vs Background vs Collision
  const [canvasMode, setCanvasMode] = useState<RoomCanvasMode>('objects');
  const [tileTool, setTileTool] = useState<TileTool>('brush');
  const [activeTilesetIndex, setActiveTilesetIndex] = useState<number>(0);
  const [selectedTileGid, setSelectedTileGid] = useState<number | null>(null);
  const [isPainting, setIsPainting] = useState<boolean>(false);
  const [isAddTilesetModalOpen, setIsAddTilesetModalOpen] = useState<boolean>(false);
  const [isConfirmingDeleteTileset, setIsConfirmingDeleteTileset] = useState<boolean>(false);

  const paintStrokeRef = useRef<Array<{ index: number; oldGid: number; newGid: number }>>([]);
  const lastPaintedCellRef = useRef<{ col: number; row: number } | null>(null);
  const tmxDataRef = useRef<TmxData>(tmxData);
  tmxDataRef.current = tmxData;

  // Zoom & View state
  const [zoom, setZoom] = useState<number>(2); // 1x, 2x, 3x, 4x, etc.
  const [gridSnap, setGridSnap] = useState<number>(isCpc ? 2 : 1); // 1, 2, 8, 16
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showCollision, setShowCollision] = useState<boolean>(true);
  const [showObjects, setShowObjects] = useState<boolean>(true);
  const [showGuidelines, setShowGuidelines] = useState<boolean>(true);
  const [showDepthLines, setShowDepthLines] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<'room' | 'screen'>('room');

  // Dragging state
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStartPosRef = useRef<{ x: number; y: number; depth: number } | null>(null);
  const [hoveredObjectId, setHoveredObjectId] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // Add Object menu dropdown state
  const [isAddMenuOpen, setIsAddMenuOpen] = useState<boolean>(false);

  // Selected object ID draft & validation error
  const [idDraft, setIdDraft] = useState<string>('');
  const [idError, setIdError] = useState<string | null>(null);

  // Image caches: tilesets and sprites
  const [tilesetImages, setTilesetImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [spriteImages, setSpriteImages] = useState<Map<string, HTMLImageElement>>(new Map());

  // Room pixel dimensions
  const roomPixelWidth = tmxData.width * tmxData.tilewidth;
  const roomPixelHeight = tmxData.height * tmxData.tileheight;

  // Screen / Full dimensions if viewMode === 'screen'
  const canvasWidth = viewMode === 'screen' ? Math.max(roomPixelWidth, screenGuidelines.screenWidth) : roomPixelWidth;
  const canvasHeight = viewMode === 'screen' ? Math.max(roomPixelHeight, screenGuidelines.screenHeight) : roomPixelHeight;

  // Origin offset for room when rendered inside full screen mode
  const roomOriginX = viewMode === 'screen'
    ? screenGuidelines.gameArea.pixelX + roomOffsetX * tmxData.tilewidth
    : 0;
  const roomOriginY = viewMode === 'screen'
    ? screenGuidelines.gameArea.pixelY + roomOffsetY * tmxData.tileheight
    : 0;

  // Directory of active TMX file
  const tmxDir = useMemo(() => (tmxFilePath ? parentDir(tmxFilePath) : ''), [tmxFilePath]);

  // Load Tileset Images
  useEffect(() => {
    if (!projectPath || !tmxData.tilesets.length) return;
    let isCancelled = false;

    const loadTilesets = async () => {
      const nextMap = new Map(tilesetImages);
      let changed = false;

      for (const ts of tmxData.tilesets) {
        const src = ts.image.source;
        if (!src || nextMap.has(src)) continue;

        // Candidate paths for tileset image
        const candidates: string[] = [];
        if (isAbsolutePath(src)) {
          candidates.push(src);
        } else {
          if (tmxDir) {
            // tmxFilePath is absolute, so this is the .tmx folder itself (tileset images,
            // including those of resolved .tsx tilesets, are relative to it).
            candidates.push(`${tmxDir}/${src}`);
          }
          candidates.push(`${projectPath}/${src}`);
          const match = files.find(f => f.name === src || f.relative_path.endsWith(`/${src}`));
          if (match && !candidates.includes(match.path)) {
            candidates.push(match.path);
          }
        }

        for (const candidate of candidates) {
          try {
            const dataUrl = await invoke<string>('read_file_base64', { filePath: candidate });
            if (isCancelled) return;
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject();
              img.src = dataUrl;
            });
            nextMap.set(src, img);
            changed = true;
            break;
          } catch {
            // try next candidate
          }
        }
      }

      if (changed && !isCancelled) {
        setTilesetImages(new Map(nextMap));
      }
    };

    loadTilesets();
    return () => { isCancelled = true; };
  }, [tmxData.tilesets, projectPath, tmxDir, files]);

  // Load Object Sprites
  useEffect(() => {
    if (!projectPath || !projectObjects.length) return;
    let isCancelled = false;

    const spriteFiles = new Set<string>();
    for (const obj of projectObjects) {
      for (const st of obj.states) {
        const sprite = statePreviewImage(st);
        if (sprite?.file) {
          spriteFiles.add(sprite.file);
        }
      }
    }

    const loadSprites = async () => {
      const nextMap = new Map(spriteImages);
      let changed = false;

      for (const file of spriteFiles) {
        if (nextMap.has(file)) continue;

        const candidates: string[] = [];
        if (file.startsWith('/')) {
          candidates.push(file);
        } else {
          if (tmxDir) candidates.push(`${projectPath}/${tmxDir}/${file}`);
          candidates.push(`${projectPath}/${file}`);
          const match = files.find(f => f.name === file || f.relative_path.endsWith(`/${file}`));
          if (match && !candidates.includes(match.path)) {
            candidates.push(match.path);
          }
        }

        for (const candidate of candidates) {
          try {
            const dataUrl = await invoke<string>('read_file_base64', { filePath: candidate });
            if (isCancelled) return;
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject();
              img.src = dataUrl;
            });
            nextMap.set(file, img);
            changed = true;
            break;
          } catch {
            // try next
          }
        }
      }

      if (changed && !isCancelled) {
        setSpriteImages(new Map(nextMap));
      }
    };

    loadSprites();
    return () => { isCancelled = true; };
  }, [projectObjects, projectPath, tmxDir, files]);

  // Active tileset currently selected in palette
  const activeTileset = useMemo(() => {
    if (tmxData.tilesets.length === 0) return null;
    if (activeTilesetIndex >= tmxData.tilesets.length) {
      return tmxData.tilesets[0];
    }
    return tmxData.tilesets[activeTilesetIndex];
  }, [tmxData.tilesets, activeTilesetIndex]);

  // Keep selectedTileGid synchronized with active tileset
  useEffect(() => {
    if (activeTileset) {
      if (
        selectedTileGid === null ||
        selectedTileGid < activeTileset.firstgid ||
        selectedTileGid >= activeTileset.firstgid + activeTileset.tilecount
      ) {
        setSelectedTileGid(activeTileset.firstgid);
      }
    } else {
      setSelectedTileGid(null);
    }
  }, [activeTileset, selectedTileGid]);

  // Handle adding a new tileset to the room map
  const handleAddTileset = useCallback((newTileset: TmxTileset) => {
    const nextTilesets = [...tmxData.tilesets, newTileset];
    const nextTmxData: TmxData = {
      ...tmxData,
      tilesets: nextTilesets,
    };
    if (onCommitTmxSnapshot) {
      onCommitTmxSnapshot(nextTmxData, selectedObjectId);
    } else if (onUpdateTmxData) {
      onUpdateTmxData(nextTmxData);
    }
    setActiveTilesetIndex(nextTilesets.length - 1);
    setSelectedTileGid(newTileset.firstgid);
    onMarkDirty();
  }, [tmxData, selectedObjectId, onCommitTmxSnapshot, onUpdateTmxData, onMarkDirty]);

  // Handle deleting a tileset from the room map
  const handleDeleteTileset = useCallback((index: number) => {
    const ts = tmxData.tilesets[index];
    if (!ts) return;

    const delFirstGid = ts.firstgid;
    const delCount = ts.tilecount;
    const delEndGid = delFirstGid + delCount;

    const nextLayers = tmxData.layers.map(layer => {
      const nextData = layer.data.map(gid => {
        if (gid >= delFirstGid && gid < delEndGid) {
          return 0; // tile cleared
        }
        if (gid >= delEndGid) {
          return gid - delCount; // shift down
        }
        return gid;
      });
      return { ...layer, data: nextData };
    });

    const nextTilesets = tmxData.tilesets
      .filter((_, i) => i !== index)
      .map(t => {
        if (t.firstgid >= delEndGid) {
          return { ...t, firstgid: t.firstgid - delCount };
        }
        return t;
      });

    const nextTmxData: TmxData = {
      ...tmxData,
      layers: nextLayers,
      tilesets: nextTilesets,
    };

    if (onCommitTmxSnapshot) {
      onCommitTmxSnapshot(nextTmxData, selectedObjectId);
    } else if (onUpdateTmxData) {
      onUpdateTmxData(nextTmxData);
    }

    const nextIndex = Math.max(0, Math.min(nextTilesets.length - 1, index));
    setActiveTilesetIndex(nextIndex);
    if (nextTilesets[nextIndex]) {
      setSelectedTileGid(nextTilesets[nextIndex].firstgid);
    } else {
      setSelectedTileGid(null);
    }
    setIsConfirmingDeleteTileset(false);
    onMarkDirty();
  }, [tmxData, selectedObjectId, onCommitTmxSnapshot, onUpdateTmxData, onMarkDirty]);

  // Helper to apply paint/erase/pick action on a map cell
  const applyTilePaint = useCallback((col: number, row: number, isRightClick: boolean) => {
    const currentData = tmxDataRef.current;
    if (col < 0 || col >= currentData.width || row < 0 || row >= currentData.height) return;

    const isCollision = canvasMode === 'collision';
    let targetLayerIndex = currentData.layers.findIndex(l =>
      isCollision ? l.name.toLowerCase().includes('collision') : !l.name.toLowerCase().includes('collision')
    );

    let nextLayers = [...currentData.layers];
    let targetLayer: TmxLayer;

    if (targetLayerIndex === -1) {
      targetLayer = {
        name: isCollision ? 'collision' : 'background',
        width: currentData.width,
        height: currentData.height,
        data: new Array(currentData.width * currentData.height).fill(0),
        visible: !isCollision,
      };
      if (isCollision) {
        nextLayers.push(targetLayer);
        targetLayerIndex = nextLayers.length - 1;
      } else {
        nextLayers.unshift(targetLayer);
        targetLayerIndex = 0;
      }
    } else {
      targetLayer = nextLayers[targetLayerIndex];
    }

    const cellIndex = row * currentData.width + col;
    const oldGid = targetLayer.data[cellIndex];

    if (tileTool === 'picker' && !isRightClick) {
      if (oldGid > 0) {
        setSelectedTileGid(oldGid);
        setTileTool('brush');
      }
      return;
    }

    const newGid = (isRightClick || tileTool === 'eraser')
      ? 0
      : (selectedTileGid ?? (activeTileset?.firstgid || 0));

    if (oldGid !== newGid) {
      paintStrokeRef.current.push({ index: cellIndex, oldGid, newGid });
      const nextData = [...targetLayer.data];
      nextData[cellIndex] = newGid;
      nextLayers[targetLayerIndex] = { ...targetLayer, data: nextData };

      const nextTmxData = { ...currentData, layers: nextLayers };
      tmxDataRef.current = nextTmxData;
      if (onUpdateTmxData) {
        onUpdateTmxData(nextTmxData);
      }
      onMarkDirty();
    }
  }, [canvasMode, tileTool, selectedTileGid, activeTileset, onUpdateTmxData, onMarkDirty]);

  // Currently selected object
  const selectedObject = useMemo(() => {
    if (selectedObjectId === null) return null;
    return tmxData.objects.find(o => o.id === selectedObjectId) || null;
  }, [tmxData.objects, selectedObjectId]);

  // Active object definition for the selected object
  const selectedObjDef = useMemo(() => {
    if (!selectedObject) return null;
    return projectObjects.find(o => o.id.toLowerCase() === selectedObject.name.toLowerCase()) || null;
  }, [selectedObject, projectObjects]);

  // Synchronize ID draft state with selected object
  useEffect(() => {
    if (selectedObject) {
      setIdDraft(getPaketObjectId(selectedObject).toString());
      setIdError(null);
    } else {
      setIdDraft('');
      setIdError(null);
    }
  }, [selectedObjectId]);

  // Render Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset & Clear
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Background fill
    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // If Screen Guidelines mode, draw Text and GUI Area placeholders
    if (viewMode === 'screen' && showGuidelines) {
      if (screenGuidelines.textArea) {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
        ctx.fillRect(
          screenGuidelines.textArea.pixelX,
          screenGuidelines.textArea.pixelY,
          screenGuidelines.textArea.pixelWidth,
          screenGuidelines.textArea.pixelHeight
        );
      }
      if (screenGuidelines.guiArea) {
        ctx.fillStyle = 'rgba(168, 85, 247, 0.08)';
        ctx.fillRect(
          screenGuidelines.guiArea.pixelX,
          screenGuidelines.guiArea.pixelY,
          screenGuidelines.guiArea.pixelWidth,
          screenGuidelines.guiArea.pixelHeight
        );
      }
    }

    // 1. Render Background Tile Layers
    const bgLayers = tmxData.layers.filter(l => !l.name.toLowerCase().includes('collision'));
    for (const layer of bgLayers) {
      if (!layer.visible) continue;

      for (let r = 0; r < layer.height; r++) {
        for (let c = 0; c < layer.width; c++) {
          const gid = layer.data[r * layer.width + c];
          if (!gid) continue;

          // Find tileset
          const ts = tmxData.tilesets
            .filter(t => t.firstgid <= gid)
            .sort((a, b) => b.firstgid - a.firstgid)[0];
          if (!ts) continue;

          const img = tilesetImages.get(ts.image.source);
          if (!img) continue;

          const localId = gid - ts.firstgid;
          const cols = ts.columns || Math.floor(ts.image.width / ts.tilewidth) || 1;
          const srcCol = localId % cols;
          const srcRow = Math.floor(localId / cols);

          const srcX = srcCol * ts.tilewidth;
          const srcY = srcRow * ts.tileheight;
          const destX = roomOriginX + c * tmxData.tilewidth;
          const destY = roomOriginY + r * tmxData.tileheight;

          ctx.drawImage(
            img,
            srcX,
            srcY,
            ts.tilewidth,
            ts.tileheight,
            destX,
            destY,
            tmxData.tilewidth,
            tmxData.tileheight
          );
        }
      }
    }

    // 2. Render Collision Mask Layer Overlay
    if (showCollision) {
      const colLayers = tmxData.layers.filter(l => l.name.toLowerCase().includes('collision'));
      for (const layer of colLayers) {
        for (let r = 0; r < layer.height; r++) {
          for (let c = 0; c < layer.width; c++) {
            const gid = layer.data[r * layer.width + c];
            if (!gid) continue;

            const ts = tmxData.tilesets
              .filter(t => t.firstgid <= gid)
              .sort((a, b) => b.firstgid - a.firstgid)[0];

            const destX = roomOriginX + c * tmxData.tilewidth;
            const destY = roomOriginY + r * tmxData.tileheight;

            if (ts) {
              const img = tilesetImages.get(ts.image.source);
              if (img) {
                ctx.save();
                ctx.globalAlpha = 0.65;
                const localId = gid - ts.firstgid;
                const cols = ts.columns || Math.floor(ts.image.width / ts.tilewidth) || 1;
                const srcCol = localId % cols;
                const srcRow = Math.floor(localId / cols);
                ctx.drawImage(
                  img,
                  srcCol * ts.tilewidth,
                  srcRow * ts.tileheight,
                  ts.tilewidth,
                  ts.tileheight,
                  destX,
                  destY,
                  tmxData.tilewidth,
                  tmxData.tileheight
                );
                ctx.restore();
                continue;
              }
            }

            // Fallback overlay for collision tile
            ctx.fillStyle = 'rgba(239, 68, 68, 0.45)';
            ctx.fillRect(destX, destY, tmxData.tilewidth, tmxData.tileheight);
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
            ctx.lineWidth = 1;
            ctx.strokeRect(destX + 0.5, destY + 0.5, tmxData.tilewidth - 1, tmxData.tileheight - 1);
          }
        }
      }
    }

    // 3. Render Grid Overlay
    if (showGrid && gridSnap > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;

      const stepX = gridSnap;
      const stepY = gridSnap === 2 && isCpc ? 4 : gridSnap;

      for (let x = roomOriginX; x <= roomOriginX + roomPixelWidth; x += stepX) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, roomOriginY);
        ctx.lineTo(x + 0.5, roomOriginY + roomPixelHeight);
        ctx.stroke();
      }

      for (let y = roomOriginY; y <= roomOriginY + roomPixelHeight; y += stepY) {
        ctx.beginPath();
        ctx.moveTo(roomOriginX, y + 0.5);
        ctx.lineTo(roomOriginX + roomPixelWidth, y + 0.5);
        ctx.stroke();
      }
    }

    // 4. Render Screen Guidelines (Text Area, Game Area, GUI Area) only in Full Screen mode
    if (viewMode === 'screen' && showGuidelines) {
      ctx.lineWidth = 1;

      // Game Area Border
      if (screenGuidelines.gameArea) {
        ctx.strokeStyle = '#38bdf8'; // Sky blue
        ctx.strokeRect(
          screenGuidelines.gameArea.pixelX + 0.5,
          screenGuidelines.gameArea.pixelY + 0.5,
          screenGuidelines.gameArea.pixelWidth - 1,
          screenGuidelines.gameArea.pixelHeight - 1
        );
      }

      // Text Area Outline
      if (screenGuidelines.textArea) {
        ctx.strokeStyle = '#fbbf24'; // Amber
        ctx.strokeRect(
          screenGuidelines.textArea.pixelX + 0.5,
          screenGuidelines.textArea.pixelY + 0.5,
          screenGuidelines.textArea.pixelWidth - 1,
          screenGuidelines.textArea.pixelHeight - 1
        );
      }

      // GUI Area Outline
      if (screenGuidelines.guiArea) {
        ctx.strokeStyle = '#c084fc'; // Purple
        ctx.strokeRect(
          screenGuidelines.guiArea.pixelX + 0.5,
          screenGuidelines.guiArea.pixelY + 0.5,
          screenGuidelines.guiArea.pixelWidth - 1,
          screenGuidelines.guiArea.pixelHeight - 1
        );
      }
    }

    // 5. Render Placed Objects sorted by depth
    if (showObjects) {
      const sortedObjects = [...tmxData.objects].sort((a, b) => {
        const dA = a.depth ?? (a.y + a.height);
        const dB = b.depth ?? (b.y + b.height);
        return dA - dB;
      });

      for (const obj of sortedObjects) {
        const isSelected = obj.id === selectedObjectId;
        const isHovered = obj.id === hoveredObjectId;
        const isPlayer = getPaketObjectId(obj) === PLAYER_OBJECT_ID || obj.name.toLowerCase() === 'player';

        const objX = roomOriginX + obj.x;
        const objY = roomOriginY + obj.y;
        const objW = obj.width;
        const objH = obj.height;

        // Try to find sprite graphic
        const def = projectObjects.find(o => o.id.toLowerCase() === obj.name.toLowerCase());
        const stateObj = def?.states.find(s => s.name === obj.state && (!obj.direction || s.direction === obj.direction))
          || def?.states.find(s => s.name === obj.state)
          || def?.states[0];

        let drawnSprite = false;
        const sprite = statePreviewImage(stateObj);
        if (sprite?.file) {
          const img = spriteImages.get(sprite.file);
          if (img) {
            const { x1, y1, x2 = x1 + objW, y2 = y1 + objH } = sprite;
            const sw = Math.max(1, x2 - x1);
            const sh = Math.max(1, y2 - y1);

            ctx.drawImage(img, x1, y1, sw, sh, objX, objY, objW, objH);
            drawnSprite = true;
          }
        }

        // Fallback placeholder box if sprite not available
        if (!drawnSprite) {
          ctx.fillStyle = isPlayer ? 'rgba(59, 130, 246, 0.35)' : 'rgba(16, 185, 129, 0.3)';
          ctx.fillRect(objX, objY, objW, objH);
          ctx.strokeStyle = isPlayer ? '#3b82f6' : '#10b981';
          ctx.lineWidth = 1;
          ctx.strokeRect(objX + 0.5, objY + 0.5, objW - 1, objH - 1);
        }

        // Depth Line Indicator
        if (showDepthLines) {
          const depthVal = obj.depth ?? (obj.y + obj.height);
          const depthY = roomOriginY + depthVal;

          ctx.strokeStyle = isSelected ? '#f59e0b' : 'rgba(245, 158, 11, 0.4)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(objX - 4, depthY + 0.5);
          ctx.lineTo(objX + objW + 4, depthY + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Selection / Hover Highlight
        if (isSelected || isHovered) {
          ctx.strokeStyle = isSelected ? '#2563eb' : '#60a5fa';
          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.strokeRect(objX - 0.5, objY - 0.5, objW + 1, objH + 1);

          // Name and ID Tag
          ctx.fillStyle = isSelected ? '#2563eb' : 'rgba(30, 41, 59, 0.85)';
          const label = `#${getPaketObjectId(obj)} ${obj.name}`;
          ctx.font = '10px monospace';
          const textW = ctx.measureText(label).width + 6;
          const textH = 14;

          const tagY = objY > 16 ? objY - textH : objY + objH + 2;
          ctx.fillRect(objX, tagY, textW, textH);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, objX + 3, tagY + 10);
        }
      }
    }

    // 6. Render Tile Brush / Cursor Preview when in tile editing mode
    if (canvasMode !== 'objects' && mousePos) {
      const hoverCol = Math.floor(mousePos.x / tmxData.tilewidth);
      const hoverRow = Math.floor(mousePos.y / tmxData.tileheight);

      if (hoverCol >= 0 && hoverCol < tmxData.width && hoverRow >= 0 && hoverRow < tmxData.height) {
        const destX = roomOriginX + hoverCol * tmxData.tilewidth;
        const destY = roomOriginY + hoverRow * tmxData.tileheight;

        if (tileTool === 'brush' && selectedTileGid) {
          const ts = tmxData.tilesets
            .filter(t => t.firstgid <= selectedTileGid)
            .sort((a, b) => b.firstgid - a.firstgid)[0];

          if (ts) {
            const img = tilesetImages.get(ts.image.source);
            if (img) {
              ctx.save();
              ctx.globalAlpha = 0.75;
              const localId = selectedTileGid - ts.firstgid;
              const cols = ts.columns || Math.floor(ts.image.width / ts.tilewidth) || 1;
              const srcCol = localId % cols;
              const srcRow = Math.floor(localId / cols);
              ctx.drawImage(
                img,
                srcCol * ts.tilewidth,
                srcRow * ts.tileheight,
                ts.tilewidth,
                ts.tileheight,
                destX,
                destY,
                tmxData.tilewidth,
                tmxData.tileheight
              );
              ctx.restore();
            }
          }
          ctx.strokeStyle = canvasMode === 'collision' ? '#f59e0b' : '#3b82f6';
          ctx.lineWidth = 1;
          ctx.strokeRect(destX + 0.5, destY + 0.5, tmxData.tilewidth - 1, tmxData.tileheight - 1);
        } else if (tileTool === 'eraser') {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
          ctx.fillRect(destX, destY, tmxData.tilewidth, tmxData.tileheight);
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 1;
          ctx.strokeRect(destX + 0.5, destY + 0.5, tmxData.tilewidth - 1, tmxData.tileheight - 1);
        } else if (tileTool === 'picker') {
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(destX + 0.5, destY + 0.5, tmxData.tilewidth - 1, tmxData.tileheight - 1);
        }
      }
    }
  }, [
    tmxData,
    viewMode,
    screenGuidelines,
    showGuidelines,
    showCollision,
    showGrid,
    gridSnap,
    showObjects,
    showDepthLines,
    selectedObjectId,
    hoveredObjectId,
    tilesetImages,
    spriteImages,
    projectObjects,
    canvasWidth,
    canvasHeight,
    roomPixelWidth,
    roomPixelHeight,
    roomOriginX,
    roomOriginY,
    isCpc,
    canvasMode,
    tileTool,
    selectedTileGid,
    mousePos
  ]);

  // Convert mouse event coordinates to room pixel space
  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;

    const rawX = clientX * scaleX;
    const rawY = clientY * scaleY;

    return {
      x: Math.round(rawX - roomOriginX),
      y: Math.round(rawY - roomOriginY)
    };
  }, [canvasWidth, canvasHeight, roomOriginX, roomOriginY]);

  // Find object at room coordinates
  const findObjectAt = useCallback((x: number, y: number): TmxObject | null => {
    // Search in reverse order so top-most visually rendered objects get hit first
    const reversed = [...tmxData.objects].reverse();
    for (const obj of reversed) {
      if (x >= obj.x && x <= obj.x + obj.width && y >= obj.y && y <= obj.y + obj.height) {
        return obj;
      }
    }
    return null;
  }, [tmxData.objects]);

  // Mouse Down: Selection & Start Drag or Tile Paint
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);

    // If in Background or Collision mode: handle tile painting
    if (canvasMode !== 'objects') {
      const isRightClick = e.button === 2;
      if (e.button === 0 || isRightClick) {
        const col = Math.floor(coords.x / tmxData.tilewidth);
        const row = Math.floor(coords.y / tmxData.tileheight);
        setIsPainting(true);
        paintStrokeRef.current = [];
        lastPaintedCellRef.current = { col, row };
        applyTilePaint(col, row, isRightClick);
      }
      return;
    }

    if (e.button !== 0) return; // Only left click for objects
    const hit = findObjectAt(coords.x, coords.y);

    if (hit) {
      onSelectObjectId(hit.id);
      setIsDragging(true);
      setDragOffset({
        x: coords.x - hit.x,
        y: coords.y - hit.y
      });
      dragStartPosRef.current = {
        x: hit.x,
        y: hit.y,
        depth: hit.depth ?? (hit.y + hit.height)
      };
    } else {
      onSelectObjectId(null);
    }
  };

  // Mouse Move: Hover, Object Dragging, or Continuous Tile Painting
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);
    setMousePos(coords);

    if (canvasMode !== 'objects') {
      if (isPainting) {
        const col = Math.floor(coords.x / tmxData.tilewidth);
        const row = Math.floor(coords.y / tmxData.tileheight);
        if (
          !lastPaintedCellRef.current ||
          lastPaintedCellRef.current.col !== col ||
          lastPaintedCellRef.current.row !== row
        ) {
          lastPaintedCellRef.current = { col, row };
          applyTilePaint(col, row, e.buttons === 2);
        }
      }
      return;
    }

    if (isDragging && selectedObject) {
      let nextX = coords.x - dragOffset.x;
      let nextY = coords.y - dragOffset.y;

      // Enforce CPC even X
      if (isCpc) {
        nextX = Math.round(nextX / 2) * 2;
      }

      // Grid Snapping
      if (gridSnap > 1) {
        nextX = Math.round(nextX / gridSnap) * gridSnap;
        nextY = Math.round(nextY / gridSnap) * gridSnap;
        if (isCpc) {
          nextX = Math.round(nextX / 2) * 2;
        }
      }

      // Clamp within map bounds
      nextX = Math.max(0, Math.min(roomPixelWidth - selectedObject.width, nextX));
      nextY = Math.max(0, Math.min(roomPixelHeight - selectedObject.height, nextY));

      // Auto update depth maintaining relative baseline offset
      const originalDepthOffset = (selectedObject.depth ?? (selectedObject.y + selectedObject.height)) - selectedObject.y;
      const nextDepth = nextY + originalDepthOffset;

      if (nextX !== selectedObject.x || nextY !== selectedObject.y) {
        onUpdateObject({
          ...selectedObject,
          x: nextX,
          y: nextY,
          depth: nextDepth
        });
        onMarkDirty();
      }
    } else {
      const hit = findObjectAt(coords.x, coords.y);
      setHoveredObjectId(hit ? hit.id : null);
    }
  };

  // Mouse Up: End Drag or Tile Paint Stroke
  const handleMouseUp = useCallback(() => {
    if (isPainting) {
      setIsPainting(false);
      lastPaintedCellRef.current = null;
      if (paintStrokeRef.current.length > 0 && onCommitTmxSnapshot) {
        onCommitTmxSnapshot(tmxDataRef.current, selectedObjectId);
      }
      paintStrokeRef.current = [];
      return;
    }

    if (isDragging && selectedObject && dragStartPosRef.current) {
      const currentDepth = selectedObject.depth ?? (selectedObject.y + selectedObject.height);
      if (
        selectedObject.x !== dragStartPosRef.current.x ||
        selectedObject.y !== dragStartPosRef.current.y ||
        currentDepth !== dragStartPosRef.current.depth
      ) {
        onCommitObjectChange(selectedObject);
      }
    }
    setIsDragging(false);
    dragStartPosRef.current = null;
  }, [isPainting, isDragging, selectedObject, selectedObjectId, onCommitTmxSnapshot, onCommitObjectChange]);

  useEffect(() => {
    if (!isDragging && !isPainting) return;
    const onWindowMouseUp = () => handleMouseUp();
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => window.removeEventListener('mouseup', onWindowMouseUp);
  }, [isDragging, isPainting, handleMouseUp]);

  // Keyboard navigation & Shortcuts (Nudge, Delete, Duplicate, Modes, Tools)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if focus is inside an input/select/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Mode switching shortcuts
      if (e.key === '1') {
        setCanvasMode('objects');
        return;
      }
      if (e.key === '2') {
        setCanvasMode('background');
        return;
      }
      if (e.key === '3') {
        setCanvasMode('collision');
        setShowCollision(true);
        return;
      }

      // Tool switching shortcuts in tile modes
      if (canvasMode !== 'objects') {
        if (e.key.toLowerCase() === 'b') {
          setTileTool('brush');
          return;
        }
        if (e.key.toLowerCase() === 'e') {
          setTileTool('eraser');
          return;
        }
        if (e.key.toLowerCase() === 'i') {
          setTileTool('picker');
          return;
        }
      }

      if (!selectedObject) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDeleteObject(selectedObject.id);
        onSelectObjectId(null);
        onMarkDirty();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onSelectObjectId(null);
        return;
      }

      // Duplicate object (Cmd+D / Ctrl+D)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const nextId = getNextAvailableObjectId(tmxData.objects, false);
        let offset = 8;
        if (isCpc) offset = 8; // already even
        // setPaketObjectId: a copied ID property must not give the clone the original's ID.
        const cloned: TmxObject = setPaketObjectId({
          ...selectedObject,
          id: nextId,
          x: Math.min(roomPixelWidth - selectedObject.width, selectedObject.x + offset),
          y: Math.min(roomPixelHeight - selectedObject.height, selectedObject.y + offset),
          depth: (selectedObject.depth ?? (selectedObject.y + selectedObject.height)) + offset
        }, nextId);
        onAddObject(cloned);
        onSelectObjectId(nextId);
        onMarkDirty();
        return;
      }

      // Arrow keys nudge
      const step = e.shiftKey ? 8 : (isCpc ? 2 : 1);
      let dx = 0;
      let dy = 0;

      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;

      if (dx !== 0 || dy !== 0) {
        e.preventDefault();
        let newX = selectedObject.x + dx;
        let newY = selectedObject.y + dy;

        if (isCpc) newX = Math.round(newX / 2) * 2;
        newX = Math.max(0, Math.min(roomPixelWidth - selectedObject.width, newX));
        newY = Math.max(0, Math.min(roomPixelHeight - selectedObject.height, newY));

        const originalDepthOffset = (selectedObject.depth ?? (selectedObject.y + selectedObject.height)) - selectedObject.y;
        const updated = {
          ...selectedObject,
          x: newX,
          y: newY,
          depth: newY + originalDepthOffset
        };
        onUpdateObject(updated);
        onCommitObjectChange(updated);
        onMarkDirty();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedObject, tmxData.objects, isCpc, roomPixelWidth, roomPixelHeight, onUpdateObject, onCommitObjectChange, onDeleteObject, onAddObject, onSelectObjectId, onMarkDirty]);

  // Handle Add Object from Menu
  const handleAddNewObject = (objDef: PakObject) => {
    const isPlayer = objDef.id.toLowerCase() === 'player';
    const nextId = getNextAvailableObjectId(tmxData.objects, isPlayer);

    let w = 16;
    let h = 16;
    const defaultState = objDef.states[0];
    const defaultSprite = statePreviewImage(defaultState);
    if (defaultSprite?.x2 !== undefined && defaultSprite?.y2 !== undefined) {
      w = defaultSprite.x2 - defaultSprite.x1;
      h = defaultSprite.y2 - defaultSprite.y1;
    }

    // Place near center of room
    let placeX = Math.floor((roomPixelWidth - w) / 2);
    let placeY = Math.floor((roomPixelHeight - h) / 2);
    if (isCpc) placeX = Math.round(placeX / 2) * 2;

    const newObj: TmxObject = {
      id: nextId,
      name: objDef.id,
      x: placeX,
      y: placeY,
      width: w,
      height: h,
      depth: placeY + h,
      direction: defaultState?.direction || 'down',
      state: defaultState?.name || 'idle'
    };

    onAddObject(newObj);
    onSelectObjectId(nextId);
    onMarkDirty();
    setIsAddMenuOpen(false);
  };

  return (
    <div className="room-canvas-container" ref={containerRef}>
      {/* Top Toolbar */}
      <div className="room-canvas-toolbar">
        {/* Mode Selector: Objects | Background | Collision */}
        <div className="toolbar-group">
          <button
            type="button"
            className={`btn-toolbar-toggle ${canvasMode === 'objects' ? 'active' : ''}`}
            onClick={() => setCanvasMode('objects')}
            title="Edit Room Objects (Shortcut: 1)"
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Box size={13} />
            <span className="btn-label-sm">Objects</span>
          </button>
          <button
            type="button"
            className={`btn-toolbar-toggle ${canvasMode === 'background' ? 'active' : ''}`}
            onClick={() => setCanvasMode('background')}
            title="Edit Background Tile Layer (Shortcut: 2)"
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Layers size={13} />
            <span className="btn-label-sm">Background</span>
          </button>
          <button
            type="button"
            className={`btn-toolbar-toggle ${canvasMode === 'collision' ? 'active' : ''}`}
            onClick={() => {
              setCanvasMode('collision');
              setShowCollision(true);
            }}
            title="Edit Collision Mask Tile Layer (Shortcut: 3)"
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Shield size={13} />
            <span className="btn-label-sm">Collision</span>
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* Tile Editing Tools: Paint, Erase, Pick */}
        {canvasMode !== 'objects' && (
          <>
            <div className="toolbar-group">
              <button
                type="button"
                className={`icon-action-btn ${tileTool === 'brush' ? 'active' : ''}`}
                onClick={() => setTileTool('brush')}
                title="Paint Tile (B) - Left click/drag to place selected tile"
              >
                <Pencil size={13} />
                <span className="btn-label-sm">Paint</span>
              </button>
              <button
                type="button"
                className={`icon-action-btn ${tileTool === 'eraser' ? 'active' : ''}`}
                onClick={() => setTileTool('eraser')}
                title="Erase Tile (E) - Or right-click anywhere to erase"
              >
                <Eraser size={13} />
                <span className="btn-label-sm">Erase</span>
              </button>
              <button
                type="button"
                className={`icon-action-btn ${tileTool === 'picker' ? 'active' : ''}`}
                onClick={() => setTileTool('picker')}
                title="Pick Tile from Map (I)"
              >
                <Pipette size={13} />
                <span className="btn-label-sm">Pick</span>
              </button>
            </div>

            <div className="toolbar-divider" />
          </>
        )}

        {/* Zoom Controls */}
        <div className="toolbar-group">
          <button
            type="button"
            className="icon-action-btn"
            onClick={() => setZoom(z => Math.max(1, z - 1))}
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <span className="toolbar-value-badge">{zoom}×</span>
          <button
            type="button"
            className="icon-action-btn"
            onClick={() => setZoom(z => Math.min(6, z + 1))}
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* Undo / Redo Controls */}
        <div className="toolbar-group">
          <button
            type="button"
            className="icon-action-btn"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Cmd+Z)"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            className="icon-action-btn"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Cmd+Shift+Z)"
          >
            <RotateCw size={14} />
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* View Mode Toggle: Room Map vs Full Screen */}
        <div className="toolbar-group">
          <button
            type="button"
            className={`btn-toolbar-toggle ${viewMode === 'room' ? 'active' : ''}`}
            onClick={() => setViewMode('room')}
            title="View room map boundaries only"
          >
            Room Map
          </button>
          <button
            type="button"
            className={`btn-toolbar-toggle ${viewMode === 'screen' ? 'active' : ''}`}
            onClick={() => setViewMode('screen')}
            title={`View full screen context (${screenGuidelines.screenWidth}×${screenGuidelines.screenHeight})`}
          >
            Full Screen
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* Layer Visibility Toggles */}
        <div className="toolbar-group">
          <button
            type="button"
            className={`icon-action-btn ${showCollision ? 'active' : ''}`}
            onClick={() => setShowCollision(v => !v)}
            title="Toggle Collision Layer Overlay"
          >
            <Layers size={14} />
            <span className="btn-label-sm">Collision</span>
          </button>

          <button
            type="button"
            className={`icon-action-btn ${showObjects ? 'active' : ''}`}
            onClick={() => setShowObjects(v => !v)}
            title="Toggle Objects Visibility"
          >
            <Box size={14} />
            <span className="btn-label-sm">Objects</span>
          </button>

          {viewMode === 'screen' && (
            <button
              type="button"
              className={`icon-action-btn ${showGuidelines ? 'active' : ''}`}
              onClick={() => setShowGuidelines(v => !v)}
              title="Toggle Screen Area Guidelines (Text/Game/GUI)"
            >
              <Crosshair size={14} />
              <span className="btn-label-sm">Guidelines</span>
            </button>
          )}

          <button
            type="button"
            className={`icon-action-btn ${showDepthLines ? 'active' : ''}`}
            onClick={() => setShowDepthLines(v => !v)}
            title="Toggle Object Depth Lines"
          >
            <ArrowDown size={14} />
            <span className="btn-label-sm">Depth</span>
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* Grid & Snapping Controls */}
        <div className="toolbar-group">
          <button
            type="button"
            className={`icon-action-btn ${showGrid ? 'active' : ''}`}
            onClick={() => setShowGrid(v => !v)}
            title="Toggle Canvas Grid"
          >
            <Grid size={14} />
          </button>
          <select
            className="select-input-sm"
            value={gridSnap}
            onChange={e => setGridSnap(parseInt(e.target.value, 10))}
            title="Snap to grid"
          >
            <option value="1">Snap: 1px {isCpc && '(X even: 2px)'}</option>
            <option value="2">Snap: 2px</option>
            <option value="4">Snap: 4px</option>
            <option value="8">Snap: 8px (Tiles)</option>
            <option value="16">Snap: 16px</option>
          </select>
        </div>

        {/* Mode-specific actions (Right side) */}
        {canvasMode === 'objects' ? (
          <div className="toolbar-group ml-auto" style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setIsAddMenuOpen(o => !o)}
              title="Place object into this room"
            >
              <Plus size={13} />
              <span>Add Object</span>
            </button>

            {isAddMenuOpen && (
              <div className="add-obj-dropdown-menu">
                <div className="dropdown-title">Select Object to Place:</div>
                {projectObjects.length === 0 ? (
                  <div className="dropdown-empty">No objects defined in project yet.</div>
                ) : (
                  projectObjects.map(obj => (
                    <button
                      key={obj.id}
                      type="button"
                      className="dropdown-item"
                      onClick={() => handleAddNewObject(obj)}
                    >
                      {obj.id.toLowerCase() === 'player' ? <User size={13} /> : <Box size={13} />}
                      <span>{obj.id}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="toolbar-group ml-auto" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setIsAddTilesetModalOpen(true)}
              title="Add a PNG tileset to this room"
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Plus size={13} />
              <span>Add Tileset</span>
            </button>
          </div>
        )}
      </div>

      {/* Canvas Viewport Stage */}
      <div
        className="room-canvas-viewport"
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          className="room-canvas-scale-wrapper"
          style={{
            width: canvasWidth * zoom,
            height: canvasHeight * zoom,
          }}
        >
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            style={{
              width: canvasWidth * zoom,
              height: canvasHeight * zoom,
            }}
            className="room-canvas-element"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onContextMenu={e => e.preventDefault()}
          />
        </div>

        {/* Hover Coordinate HUD */}
        <div className="canvas-coords-hud">
          {mousePos ? (
            <span>
              {canvasMode !== 'objects' ? (
                <>
                  <strong style={{ color: 'var(--accent-primary)' }}>
                    Tile ({Math.floor(mousePos.x / tmxData.tilewidth)}, {Math.floor(mousePos.y / tmxData.tileheight)})
                  </strong>
                  {' | '}
                </>
              ) : null}
              X: {mousePos.x} px | Y: {mousePos.y} px {isCpc && mousePos.x % 2 !== 0 && '(CPC odd X)'}
            </span>
          ) : (
            <span>
              Map: {tmxData.width}×{tmxData.height} tiles ({roomPixelWidth}×{roomPixelHeight} px)
            </span>
          )}
        </div>
      </div>

      {/* Floating Selected Object Properties Panel */}
      {canvasMode === 'objects' && selectedObject && (
        <div className="room-selected-object-bar">
          <div className="obj-bar-header">
            <div className="obj-bar-title">
              {getPaketObjectId(selectedObject) === PLAYER_OBJECT_ID ? <User size={14} className="text-primary" /> : <Box size={14} className="text-accent" />}
              <span className="font-semibold">{selectedObject.name}</span>
              <span className="obj-id-tag">ID: #{getPaketObjectId(selectedObject)}</span>
              {isCpc && selectedObject.x % 2 !== 0 && (
                <span className="obj-warning-badge" title="Amstrad CPC requires even X coordinates">
                  <AlertTriangle size={11} /> Odd X!
                </span>
              )}
            </div>
            <button
              type="button"
              className="icon-action-btn"
              onClick={() => onSelectObjectId(null)}
              title="Deselect (Esc)"
            >
              <X size={13} />
            </button>
          </div>

          <div className="obj-bar-fields">
            {/* ID Input */}
            <div className="obj-bar-field">
              <label>ID:</label>
              <input
                type="number"
                className={`text-input-sm ${idError ? 'input-error' : ''}`}
                style={{ width: '48px' }}
                value={idDraft}
                min={1}
                max={63}
                onChange={e => {
                  const valStr = e.target.value;
                  setIdDraft(valStr);

                  if (!valStr.trim()) {
                    setIdError('Required');
                    return;
                  }

                  const val = parseInt(valStr, 10);
                  if (isNaN(val) || val < 1 || val > 63) {
                    setIdError('Must be 1-63');
                    return;
                  }

                  const isPlayer = selectedObject.name.toLowerCase() === 'player';
                  if (val === PLAYER_OBJECT_ID && !isPlayer) {
                    setIdError('ID 63 reserved for player');
                    return;
                  }
                  if (val !== PLAYER_OBJECT_ID && isPlayer) {
                    setIdError('Player must be ID 63');
                    return;
                  }

                  if (isObjectIdTaken(tmxData.objects, selectedObject, val)) {
                    setIdError(`ID ${val} already in use`);
                    return;
                  }

                  // Valid & Unique! Edits the object's ID property instead, if it has one.
                  setIdError(null);
                  const oldId = selectedObject.id;
                  const updated = setPaketObjectId(selectedObject, val);
                  onCommitObjectChange(updated, oldId);
                  onSelectObjectId(updated.id);
                  onMarkDirty();
                }}
                onBlur={() => {
                  if (idError || !idDraft.trim()) {
                    setIdDraft(getPaketObjectId(selectedObject).toString());
                    setIdError(null);
                  }
                }}
              />
              {idError && (
                <span className="obj-warning-badge" style={{ fontSize: '10px' }} title={idError}>
                  <AlertTriangle size={11} /> {idError}
                </span>
              )}
            </div>

            {/* State Dropdown */}
            <div className="obj-bar-field">
              <label>State:</label>
              {selectedObjDef && selectedObjDef.states.length > 0 ? (
                <select
                  className="select-input-sm"
                  value={selectedObject.state || selectedObjDef.states[0].name}
                  onChange={e => {
                    onCommitObjectChange({ ...selectedObject, state: e.target.value });
                    onMarkDirty();
                  }}
                >
                  {Array.from(new Set(selectedObjDef.states.map(s => s.name))).map(st => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className="text-input-sm"
                  value={selectedObject.state || 'idle'}
                  onChange={e => {
                    onCommitObjectChange({ ...selectedObject, state: e.target.value });
                    onMarkDirty();
                  }}
                />
              )}
            </div>

            {/* Direction Dropdown */}
            <div className="obj-bar-field">
              <label>Dir:</label>
              <select
                className="select-input-sm"
                value={selectedObject.direction || 'down'}
                onChange={e => {
                  onCommitObjectChange({ ...selectedObject, direction: e.target.value });
                  onMarkDirty();
                }}
              >
                {COMMON_DIRECTIONS.map(dir => (
                  <option key={dir} value={dir}>{dir}</option>
                ))}
              </select>
            </div>

            {/* X Coordinate */}
            <div className="obj-bar-field">
              <label>X:</label>
              <input
                type="number"
                className="text-input-sm"
                value={selectedObject.x}
                onChange={e => {
                  let val = parseInt(e.target.value, 10) || 0;
                  if (isCpc) {
                    val = Math.round(val / 2) * 2;
                  }
                  onCommitObjectChange({ ...selectedObject, x: val });
                  onMarkDirty();
                }}
              />
            </div>

            {/* Y Coordinate */}
            <div className="obj-bar-field">
              <label>Y:</label>
              <input
                type="number"
                className="text-input-sm"
                value={selectedObject.y}
                onChange={e => {
                  const val = parseInt(e.target.value, 10) || 0;
                  const deltaY = val - selectedObject.y;
                  const currentDepth = selectedObject.depth ?? (selectedObject.y + selectedObject.height);
                  onCommitObjectChange({
                    ...selectedObject,
                    y: val,
                    depth: currentDepth + deltaY
                  });
                  onMarkDirty();
                }}
              />
            </div>

            {/* Depth */}
            <div className="obj-bar-field">
              <label>Depth:</label>
              <input
                type="number"
                className="text-input-sm"
                value={selectedObject.depth ?? (selectedObject.y + selectedObject.height)}
                onChange={e => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    onCommitObjectChange({ ...selectedObject, depth: val });
                    onMarkDirty();
                  }
                }}
              />
              <button
                type="button"
                className="btn-link-action"
                onClick={() => {
                  onCommitObjectChange({
                    ...selectedObject,
                    depth: selectedObject.y + selectedObject.height
                  });
                  onMarkDirty();
                }}
                title="Reset depth to object base (Y + Height)"
              >
                Base
              </button>
            </div>

            {/* Actions */}
            <div className="obj-bar-actions ml-auto">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const nextId = getNextAvailableObjectId(tmxData.objects, false);
                  const cloned: TmxObject = setPaketObjectId({
                    ...selectedObject,
                    id: nextId,
                    x: Math.min(roomPixelWidth - selectedObject.width, selectedObject.x + (isCpc ? 8 : 8)),
                    y: Math.min(roomPixelHeight - selectedObject.height, selectedObject.y + 8),
                    depth: (selectedObject.depth ?? (selectedObject.y + selectedObject.height)) + 8
                  }, nextId);
                  onAddObject(cloned);
                  onSelectObjectId(nextId);
                  onMarkDirty();
                }}
                title="Duplicate Object (Cmd+D)"
              >
                <Copy size={12} />
                <span>Clone</span>
              </button>

              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  onDeleteObject(selectedObject.id);
                  onSelectObjectId(null);
                  onMarkDirty();
                }}
                title="Delete Object (Delete key)"
              >
                <Trash2 size={12} />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tileset Palette Drawer (Visible in Background / Collision tile painting modes) */}
      {canvasMode !== 'objects' && (
        <div className="tileset-palette-bar">
          <div className="tileset-palette-header">
            {/* Tilesets Tab Group */}
            <div className="tileset-tabs-group">
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginRight: '4px' }}>
                Tilesets:
              </span>
              {tmxData.tilesets.map((ts, idx) => (
                <button
                  key={`${ts.name}-${ts.firstgid}`}
                  type="button"
                  className={`tileset-tab-btn ${idx === activeTilesetIndex ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTilesetIndex(idx);
                    setSelectedTileGid(ts.firstgid);
                  }}
                  title={`${ts.name} (${ts.tilecount} tiles, ${ts.tilewidth}×${ts.tileheight}px)`}
                >
                  <ImageIcon size={12} />
                  <span>{ts.name}</span>
                  <span style={{ opacity: 0.75, fontSize: '10px' }}>({ts.tilecount})</span>
                </button>
              ))}

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setIsAddTilesetModalOpen(true)}
                title="Add PNG tileset to room"
                style={{ padding: '2px 6px', fontSize: '11px' }}
              >
                <Plus size={12} />
                <span>Add</span>
              </button>
            </div>

            {/* Selected Tile Info & Delete Tileset */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {selectedTileGid !== null && activeTileset && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  <span>Active Tile:</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-main)' }}>
                    GID #{selectedTileGid} (Local #{selectedTileGid - activeTileset.firstgid})
                  </span>
                </div>
              )}

              {activeTileset && (
                <div>
                  {isConfirmingDeleteTileset ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '10px', color: '#ef4444' }}>Delete &amp; clear tiles?</span>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDeleteTileset(activeTilesetIndex)}
                        style={{ padding: '2px 6px', fontSize: '10px' }}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setIsConfirmingDeleteTileset(false)}
                        style={{ padding: '2px 6px', fontSize: '10px' }}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="icon-action-btn"
                      onClick={() => setIsConfirmingDeleteTileset(true)}
                      title={`Remove tileset "${activeTileset.name}" from this room`}
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Swatches Grid */}
          {activeTileset ? (
            <div className="tileset-swatches-grid">
              {(() => {
                const ts = activeTileset;
                const cols = ts.columns || Math.max(1, Math.floor(ts.image.width / ts.tilewidth));
                const img = tilesetImages.get(ts.image.source);
                const scale = 3;
                const swatches: React.ReactNode[] = [];

                for (let localId = 0; localId < ts.tilecount; localId++) {
                  const gid = ts.firstgid + localId;
                  const srcCol = localId % cols;
                  const srcRow = Math.floor(localId / cols);
                  const srcX = srcCol * ts.tilewidth;
                  const srcY = srcRow * ts.tileheight;
                  const isSelected = selectedTileGid === gid && tileTool === 'brush';

                  swatches.push(
                    <button
                      key={gid}
                      type="button"
                      className={`tile-palette-swatch ${isSelected ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedTileGid(gid);
                        setTileTool('brush');
                      }}
                      title={`Tile #${localId} (GID: ${gid})`}
                      style={{
                        width: `${ts.tilewidth * scale}px`,
                        height: `${ts.tileheight * scale}px`,
                        backgroundImage: img ? `url(${img.src})` : undefined,
                        backgroundPosition: `-${srcX * scale}px -${srcY * scale}px`,
                        backgroundSize: `${ts.image.width * scale}px ${ts.image.height * scale}px`,
                      }}
                    />
                  );
                }
                return swatches;
              })()}
            </div>
          ) : (
            <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
              No tilesets defined for this room. Click &quot;Add Tileset&quot; to add a PNG image.
            </div>
          )}
        </div>
      )}

      {/* Add Tileset Modal */}
      <AddTilesetModal
        isOpen={isAddTilesetModalOpen}
        onClose={() => setIsAddTilesetModalOpen(false)}
        files={files}
        projectPath={projectPath}
        tmxFilePath={tmxFilePath}
        defaultTileWidth={tmxData.tilewidth}
        defaultTileHeight={tmxData.tileheight}
        existingTilesets={tmxData.tilesets}
        onAddTileset={handleAddTileset}
      />
    </div>
  );
};
