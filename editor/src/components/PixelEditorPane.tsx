import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { safeInvoke as invoke } from '../utils/ipc';
import { 
  ZoomIn, 
  ZoomOut, 
  Grid, 
  RotateCcw, 
  RotateCw, 
  Maximize2, 
  Save, 
  Pipette, 
  Eraser, 
  Pencil, 
  Check, 
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Wand2,
  Eye,
  EyeOff,
  Palette
} from 'lucide-react';
import type { Platform } from '../types';
import { 
  PaletteColor, 
  getPlatformPalette, 
  getPlatformDefaultTolerance, 
  isColorInPalette, 
  findNearestPaletteColor, 
  rgbToHex 
} from '../utils/palettes';
import { ResizeCanvasModal } from './ResizeCanvasModal';
import { 
  STORAGE_KEYS, 
  DEFAULT_PIXEL_GRID_PRESET, 
  DEFAULT_PIXEL_GRID_WIDTH, 
  DEFAULT_PIXEL_GRID_HEIGHT 
} from '../constants';

interface PixelEditorPaneProps {
  filePath: string;
  title: string;
  platform: Platform;
  palette?: PaletteColor[];
  tolerance?: number;
  onOpenPaletteManager?: () => void;
  onLogToConsole?: (msg: string) => void;
  onDirtyChange?: (isDirty: boolean, currentContent: string) => void;
  onSave?: () => Promise<void>;
}

type ToolType = 'pencil' | 'eraser' | 'picker';

const MAX_HISTORY_STEPS = 25;
const ZOOM_LEVELS = [1, 2, 4, 6, 8, 12, 16, 24, 32];

export const PixelEditorPane: React.FC<PixelEditorPaneProps> = ({
  filePath,
  title,
  platform,
  palette: paletteProp,
  tolerance: toleranceProp,
  onOpenPaletteManager,
  onLogToConsole,
  onDirtyChange,
  onSave
}) => {
  const [activeTool, setActiveTool] = useState<ToolType>('pencil');
  const [selectedColorIndex, setSelectedColorIndex] = useState<number>(1);
  const [zoomIndex, setZoomIndex] = useState<number>(4); // default 8x
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [gridPreset, setGridPreset] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.PIXEL_GRID_PRESET) || DEFAULT_PIXEL_GRID_PRESET;
  });
  const [customGridWidth, setCustomGridWidth] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PIXEL_GRID_CUSTOM_W);
    return saved ? Math.max(1, parseInt(saved, 10) || DEFAULT_PIXEL_GRID_WIDTH) : DEFAULT_PIXEL_GRID_WIDTH;
  });
  const [customGridHeight, setCustomGridHeight] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PIXEL_GRID_CUSTOM_H);
    return saved ? Math.max(1, parseInt(saved, 10) || DEFAULT_PIXEL_GRID_HEIGHT) : DEFAULT_PIXEL_GRID_HEIGHT;
  });
  const [hasAlpha, setHasAlpha] = useState<boolean>(true);

  // Palette adherence check state
  const [paletteCheckResult, setPaletteCheckResult] = useState<{
    checked: boolean;
    valid: boolean;
    invalidCount: number;
    invalidPixels: Array<{ x: number; y: number; r: number; g: number; b: number; hex: string }>;
  } | null>(null);
  const [showPaletteHighlight, setShowPaletteHighlight] = useState<boolean>(false);

  const handleGridPresetChange = (preset: string) => {
    setGridPreset(preset);
    localStorage.setItem(STORAGE_KEYS.PIXEL_GRID_PRESET, preset);
  };

  const handleCustomGridWidthChange = (val: number) => {
    const clamped = Math.max(1, val);
    setCustomGridWidth(clamped);
    localStorage.setItem(STORAGE_KEYS.PIXEL_GRID_CUSTOM_W, clamped.toString());
  };

  const handleCustomGridHeightChange = (val: number) => {
    const clamped = Math.max(1, val);
    setCustomGridHeight(clamped);
    localStorage.setItem(STORAGE_KEYS.PIXEL_GRID_CUSTOM_H, clamped.toString());
  };

  // Resolve active grid width & height
  const [gridW, gridH] = useMemo(() => {
    switch (gridPreset) {
      case '16x16': return [16, 16];
      case '24x24': return [24, 24];
      case '32x32': return [32, 32];
      case '1x1': return [1, 1];
      case 'custom': return [customGridWidth, customGridHeight];
      case '8x8':
      default:
        return [8, 8];
    }
  }, [gridPreset, customGridWidth, customGridHeight]);

  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverColor, setHoverColor] = useState<string | null>(null);

  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isResizeModalOpen, setIsResizeModalOpen] = useState<boolean>(false);

  // References
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isMouseDownRef = useRef<boolean>(false);
  const lastPixelRef = useRef<{ x: number; y: number } | null>(null);

  // Undo / Redo history
  const historyRef = useRef<ImageData[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);

  const palette = useMemo(() => paletteProp || getPlatformPalette(platform), [paletteProp, platform]);
  const activeTolerance = toleranceProp !== undefined ? toleranceProp : getPlatformDefaultTolerance(platform);
  const activeColor = palette[selectedColorIndex] || palette[0];
  const zoom = ZOOM_LEVELS[zoomIndex] || 8;

  const updateUndoRedoState = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const pushUndoState = useCallback(() => {
    const offscreen = offscreenCanvasRef.current;
    if (!offscreen) return;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);

    // Truncate any forward redo history
    const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    newHistory.push(imgData);

    if (newHistory.length > MAX_HISTORY_STEPS) {
      newHistory.shift();
    }

    historyRef.current = newHistory;
    historyIndexRef.current = newHistory.length - 1;
    updateUndoRedoState();
  }, [updateUndoRedoState]);

  // Redraw the visible scaled canvas from the offscreen source
  const renderDisplayCanvas = useCallback(() => {
    const displayCanvas = displayCanvasRef.current;
    const offscreen = offscreenCanvasRef.current;
    if (!displayCanvas || !offscreen) return;

    const ctx = displayCanvas.getContext('2d');
    if (!ctx) return;

    const w = offscreen.width;
    const h = offscreen.height;

    displayCanvas.width = w * zoom;
    displayCanvas.height = h * zoom;

    ctx.imageSmoothingEnabled = false;

    // Draw background checkerboard for transparent areas
    const checkerSize = 8;
    for (let y = 0; y < displayCanvas.height; y += checkerSize) {
      for (let x = 0; x < displayCanvas.width; x += checkerSize) {
        ctx.fillStyle = ((x / checkerSize + y / checkerSize) % 2 === 0) ? '#282b30' : '#1e2124';
        ctx.fillRect(x, y, checkerSize, checkerSize);
      }
    }

    // Draw offscreen pixel art stretched by zoom
    ctx.drawImage(offscreen, 0, 0, w * zoom, h * zoom);

    // Draw pixel grid if enabled
    if (showGrid) {
      const minCell = Math.min(gridW, gridH);
      const shouldDraw = minCell === 1 ? zoom >= 4 : (zoom * minCell >= 8 || zoom >= 2);

      if (shouldDraw) {
        // Draw subtle sub-pixel grid if zoomed in closely and main cell size > 1
        if (zoom >= 8 && (gridW > 1 || gridH > 1)) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let x = 1; x < w; x++) {
            if (x % gridW !== 0) {
              const px = Math.floor(x * zoom) + 0.5;
              ctx.moveTo(px, 0);
              ctx.lineTo(px, h * zoom);
            }
          }
          for (let y = 1; y < h; y++) {
            if (y % gridH !== 0) {
              const py = Math.floor(y * zoom) + 0.5;
              ctx.moveTo(0, py);
              ctx.lineTo(w * zoom, py);
            }
          }
          ctx.stroke();
        }

        // Draw primary cell grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= w; x += gridW) {
          const px = Math.floor(x * zoom) + 0.5;
          ctx.moveTo(px, 0);
          ctx.lineTo(px, h * zoom);
        }
        for (let y = 0; y <= h; y += gridH) {
          const py = Math.floor(y * zoom) + 0.5;
          ctx.moveTo(0, py);
          ctx.lineTo(w * zoom, py);
        }
        ctx.stroke();
      }
    }

    // Draw non-palette pixel highlights if enabled
    if (showPaletteHighlight && paletteCheckResult && !paletteCheckResult.valid) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.7)';
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1;
      for (const p of paletteCheckResult.invalidPixels) {
        ctx.fillRect(p.x * zoom, p.y * zoom, zoom, zoom);
        if (zoom >= 4) {
          ctx.strokeRect(p.x * zoom + 0.5, p.y * zoom + 0.5, zoom - 1, zoom - 1);
        }
      }
    }
  }, [zoom, showGrid, gridW, gridH, showPaletteHighlight, paletteCheckResult]);

  const renderDisplayCanvasRef = useRef(renderDisplayCanvas);
  renderDisplayCanvasRef.current = renderDisplayCanvas;

  // Load the image from disk via base64 (only when filePath changes)
  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setError(null);

    invoke<string>('read_file_base64', { filePath })
      .then((dataUrl) => {
        if (isCancelled) return;

        const img = new Image();
        img.onload = () => {
          if (isCancelled) return;

          const offscreen = document.createElement('canvas');
          offscreen.width = img.naturalWidth;
          offscreen.height = img.naturalHeight;
          const ctx = offscreen.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;

          ctx.drawImage(img, 0, 0);
          offscreenCanvasRef.current = offscreen;

          // Check if image has transparency
          const imgData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
          let detectedAlpha = false;
          for (let i = 3; i < imgData.data.length; i += 4) {
            if (imgData.data[i] < 255) {
              detectedAlpha = true;
              break;
            }
          }
          setHasAlpha(detectedAlpha);

          setCanvasDimensions({ width: offscreen.width, height: offscreen.height });

          // Reset history with initial state
          historyRef.current = [ctx.getImageData(0, 0, offscreen.width, offscreen.height)];
          historyIndexRef.current = 0;
          updateUndoRedoState();

          setIsLoading(false);
          renderDisplayCanvasRef.current();
        };

        img.onerror = () => {
          if (!isCancelled) {
            setError('Failed to parse image data.');
            setIsLoading(false);
          }
        };

        img.src = dataUrl;
      })
      .catch((err) => {
        if (!isCancelled) {
          console.error(`Failed to load image ${filePath}:`, err);
          setError(typeof err === 'string' ? err : 'Failed to read image file');
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [filePath, updateUndoRedoState]);

  // Re-render when zoom or grid changes
  useEffect(() => {
    renderDisplayCanvas();
  }, [renderDisplayCanvas]);

  // Notify parent of content / dirty changes
  const notifyDirty = useCallback(() => {
    setIsDirty(true);
    const offscreen = offscreenCanvasRef.current;
    if (offscreen && onDirtyChange) {
      const dataUrl = offscreen.toDataURL('image/png');
      onDirtyChange(true, dataUrl);
    }
  }, [onDirtyChange]);

  // Check palette adherence for the current image
  const handleCheckPalette = useCallback(() => {
    const offscreen = offscreenCanvasRef.current;
    if (!offscreen) return;
    const ctx = offscreen.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const imgData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
    const data = imgData.data;
    const invalidPixels: Array<{ x: number; y: number; r: number; g: number; b: number; hex: string }> = [];
    const w = offscreen.width;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      if (!isColorInPalette(r, g, b, palette, activeTolerance)) {
        const pixelIndex = i / 4;
        const x = pixelIndex % w;
        const y = Math.floor(pixelIndex / w);
        invalidPixels.push({ x, y, r, g, b, hex: rgbToHex(r, g, b) });
      }
    }

    if (invalidPixels.length === 0) {
      setPaletteCheckResult({ checked: true, valid: true, invalidCount: 0, invalidPixels: [] });
      setShowPaletteHighlight(false);
      onLogToConsole?.(`[PAKET Studio] Palette Check: All pixels in ${title} match the active palette! (Tolerance: ${activeTolerance})\n`);
    } else {
      setPaletteCheckResult({ checked: true, valid: false, invalidCount: invalidPixels.length, invalidPixels });
      setShowPaletteHighlight(true);
      let logMsg = `[PAKET Studio] Palette Check: Found ${invalidPixels.length} non-palette pixel(s) in ${title} (Tolerance: ${activeTolerance}):\n`;
      const preview = invalidPixels.slice(0, 25);
      for (const p of preview) {
        logMsg += `  Pixel (${p.x}, ${p.y}): RGB(${p.r}, ${p.g}, ${p.b}) -> ${p.hex}\n`;
      }
      if (invalidPixels.length > 25) {
        logMsg += `  ... and ${invalidPixels.length - 25} more pixel(s).\n`;
      }
      onLogToConsole?.(logMsg);
    }
  }, [palette, activeTolerance, onLogToConsole, title]);

  // Convert image to use current palette (nearest neighbor)
  const handleSnapToPalette = useCallback(() => {
    const offscreen = offscreenCanvasRef.current;
    if (!offscreen) return;
    const ctx = offscreen.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    pushUndoState();

    const imgData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
    const data = imgData.data;
    let convertedCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      if (!isColorInPalette(r, g, b, palette, activeTolerance)) {
        const nearest = findNearestPaletteColor(r, g, b, palette);
        data[i] = nearest.r;
        data[i + 1] = nearest.g;
        data[i + 2] = nearest.b;
        convertedCount++;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    notifyDirty();
    renderDisplayCanvas();
    setPaletteCheckResult({ checked: true, valid: true, invalidCount: 0, invalidPixels: [] });
    setShowPaletteHighlight(false);
    onLogToConsole?.(`[PAKET Studio] Converted ${convertedCount} non-conforming pixel(s) to nearest palette colors in ${title}. (Ctrl+Z to undo)\n`);
  }, [pushUndoState, palette, activeTolerance, notifyDirty, renderDisplayCanvas, onLogToConsole, title]);

  // Direct Save handler
  const handleSave = useCallback(async () => {
    const offscreen = offscreenCanvasRef.current;
    if (!offscreen) return;

    setIsSaving(true);
    setError(null);
    try {
      if (onSave) {
        await onSave();
      } else {
        const dataUrl = offscreen.toDataURL('image/png');
        await invoke('write_file_base64', {
          filePath,
          base64Data: dataUrl
        });
      }
      setIsDirty(false);
      setSaveSuccess(true);
      if (onDirtyChange) {
        const dataUrl = offscreen.toDataURL('image/png');
        onDirtyChange(false, dataUrl);
      }
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      console.error('Failed to save image:', err);
      setError(typeof err === 'string' ? err : 'Failed to save image file');
    } finally {
      setIsSaving(false);
    }
  }, [filePath, onDirtyChange, onSave]);

  // Apply pixel drawing at (px, py)
  const applyToolAtPixel = useCallback((px: number, py: number, tool: ToolType) => {
    const offscreen = offscreenCanvasRef.current;
    if (!offscreen) return;
    if (px < 0 || px >= offscreen.width || py < 0 || py >= offscreen.height) return;

    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    if (tool === 'pencil') {
      ctx.fillStyle = activeColor.hex;
      ctx.fillRect(px, py, 1, 1);
    } else if (tool === 'eraser') {
      if (hasAlpha) {
        ctx.clearRect(px, py, 1, 1);
      } else {
        // Erase to black
        ctx.fillStyle = '#000000';
        ctx.fillRect(px, py, 1, 1);
      }
    } else if (tool === 'picker') {
      const pixel = ctx.getImageData(px, py, 1, 1).data;
      if (pixel[3] === 0 && hasAlpha) {
        // Transparent
        const transIdx = palette.findIndex(c => c.isTransparent);
        if (transIdx !== -1) setSelectedColorIndex(transIdx);
      } else {
        // Find closest color in palette
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < palette.length; i++) {
          const c = palette[i];
          const dist = Math.abs(c.r - pixel[0]) + Math.abs(c.g - pixel[1]) + Math.abs(c.b - pixel[2]);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        setSelectedColorIndex(bestIdx);
        setActiveTool('pencil');
      }
    }
  }, [activeColor, hasAlpha, palette]);

  // Line drawing algorithm between previous and current pixel (Bresenham's)
  const drawLine = useCallback((x0: number, y0: number, x1: number, y1: number, tool: ToolType) => {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let currX = x0;
    let currY = y0;

    while (true) {
      applyToolAtPixel(currX, currY, tool);
      if (currX === x1 && currY === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        currX += sx;
      }
      if (e2 < dx) {
        err += dx;
        currY += sy;
      }
    }
  }, [applyToolAtPixel]);

  // Canvas Mouse Coordinates -> Pixel Coordinates
  const getPixelCoords = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = displayCanvasRef.current;
    const offscreen = offscreenCanvasRef.current;
    if (!canvas || !offscreen) return null;

    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const px = Math.floor(clientX / zoom);
    const py = Math.floor(clientY / zoom);

    if (px < 0 || px >= offscreen.width || py < 0 || py >= offscreen.height) {
      return null;
    }
    return { x: px, y: py };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 2) return; // Only left or right click
    const coords = getPixelCoords(e);
    if (!coords) return;

    isMouseDownRef.current = true;
    lastPixelRef.current = coords;

    // Right-click triggers eyedropper immediately
    const toolToUse = e.button === 2 ? 'picker' : activeTool;

    if (toolToUse !== 'picker') {
      pushUndoState();
    }

    applyToolAtPixel(coords.x, coords.y, toolToUse);
    renderDisplayCanvas();

    if (toolToUse !== 'picker') {
      notifyDirty();
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getPixelCoords(e);
    setCursorPos(coords);

    // Sample color under cursor for status bar
    const offscreen = offscreenCanvasRef.current;
    if (coords && offscreen) {
      const ctx = offscreen.getContext('2d');
      if (ctx) {
        const p = ctx.getImageData(coords.x, coords.y, 1, 1).data;
        if (p[3] === 0) {
          setHoverColor('Transparent');
        } else {
          setHoverColor(`RGB(${p[0]}, ${p[1]}, ${p[2]})`);
        }
      }
    } else {
      setHoverColor(null);
    }

    if (!isMouseDownRef.current || !coords) return;

    if (activeTool === 'picker') {
      applyToolAtPixel(coords.x, coords.y, 'picker');
      return;
    }

    const last = lastPixelRef.current;
    if (last && (last.x !== coords.x || last.y !== coords.y)) {
      drawLine(last.x, last.y, coords.x, coords.y, activeTool);
      lastPixelRef.current = coords;
      renderDisplayCanvas();
      notifyDirty();
    }
  };

  const handleMouseUp = () => {
    isMouseDownRef.current = false;
    lastPixelRef.current = null;
  };

  const handleMouseLeave = () => {
    isMouseDownRef.current = false;
    lastPixelRef.current = null;
    setCursorPos(null);
    setHoverColor(null);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent native browser context menu
  };

  // Undo / Redo actions
  const handleUndo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    const offscreen = offscreenCanvasRef.current;
    if (!offscreen) return;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    historyIndexRef.current -= 1;
    const targetState = historyRef.current[historyIndexRef.current];

    // Check if dimensions changed
    if (offscreen.width !== targetState.width || offscreen.height !== targetState.height) {
      offscreen.width = targetState.width;
      offscreen.height = targetState.height;
      setCanvasDimensions({ width: targetState.width, height: targetState.height });
    }

    ctx.putImageData(targetState, 0, 0);
    renderDisplayCanvas();
    updateUndoRedoState();
    notifyDirty();
  }, [notifyDirty, renderDisplayCanvas, updateUndoRedoState]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    const offscreen = offscreenCanvasRef.current;
    if (!offscreen) return;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    historyIndexRef.current += 1;
    const targetState = historyRef.current[historyIndexRef.current];

    if (offscreen.width !== targetState.width || offscreen.height !== targetState.height) {
      offscreen.width = targetState.width;
      offscreen.height = targetState.height;
      setCanvasDimensions({ width: targetState.width, height: targetState.height });
    }

    ctx.putImageData(targetState, 0, 0);
    renderDisplayCanvas();
    updateUndoRedoState();
    notifyDirty();
  }, [notifyDirty, renderDisplayCanvas, updateUndoRedoState]);

  // Resize Canvas action
  const handleResizeCanvas = useCallback((newWidth: number, newHeight: number) => {
    const offscreen = offscreenCanvasRef.current;
    if (!offscreen) return;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    pushUndoState();

    const oldData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);

    offscreen.width = newWidth;
    offscreen.height = newHeight;

    if (!hasAlpha) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, newWidth, newHeight);
    }

    ctx.putImageData(oldData, 0, 0);

    setCanvasDimensions({ width: newWidth, height: newHeight });
    renderDisplayCanvas();
    pushUndoState();
    notifyDirty();
  }, [hasAlpha, notifyDirty, pushUndoState, renderDisplayCanvas]);

  // Global keyboard shortcuts within editor pane
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (e.key === 'p' || e.key === 'P') {
        setActiveTool('pencil');
      } else if (e.key === 'e' || e.key === 'E') {
        setActiveTool('eraser');
      } else if (e.key === 'i' || e.key === 'I') {
        setActiveTool('picker');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  return (
    <div className="pixel-editor-container">
      {/* Top Toolbar */}
      <div className="pixel-editor-toolbar">
        <div className="toolbar-group">
          <span className="editor-file-title" title={filePath}>{title}</span>
          {canvasDimensions.width > 0 && (
            <span className="dimension-badge">
              {canvasDimensions.width} × {canvasDimensions.height} px
            </span>
          )}
          {isDirty && <span className="dirty-indicator">• Unsaved Changes</span>}
        </div>

        {/* Tool selectors */}
        <div className="toolbar-group">
          <button
            className={`tool-btn ${activeTool === 'pencil' ? 'active' : ''}`}
            onClick={() => setActiveTool('pencil')}
            title="Pencil Tool (P) - Draw pixel"
          >
            <Pencil size={15} />
            <span>Pencil</span>
          </button>
          <button
            className={`tool-btn ${activeTool === 'eraser' ? 'active' : ''}`}
            onClick={() => setActiveTool('eraser')}
            title="Eraser Tool (E) - Clear pixel"
          >
            <Eraser size={15} />
            <span>Eraser</span>
          </button>
          <button
            className={`tool-btn ${activeTool === 'picker' ? 'active' : ''}`}
            onClick={() => setActiveTool('picker')}
            title="Color Picker / Eyedropper (I or Right-Click)"
          >
            <Pipette size={15} />
            <span>Pick</span>
          </button>
        </div>

        {/* History actions */}
        <div className="toolbar-group">
          <button
            className="icon-action-btn"
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo (Cmd+Z)"
          >
            <RotateCcw size={14} />
          </button>
          <button
            className="icon-action-btn"
            onClick={handleRedo}
            disabled={!canRedo}
            title="Redo (Cmd+Shift+Z)"
          >
            <RotateCw size={14} />
          </button>
        </div>

        {/* Zoom & View Controls */}
        <div className="toolbar-group">
          <button
            className="icon-action-btn"
            onClick={() => setZoomIndex(z => Math.max(0, z - 1))}
            disabled={zoomIndex <= 0}
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <span className="zoom-text">{zoom}x</span>
          <button
            className="icon-action-btn"
            onClick={() => setZoomIndex(z => Math.min(ZOOM_LEVELS.length - 1, z + 1))}
            disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>

          <button
            className={`icon-action-btn ${showGrid ? 'active' : ''}`}
            onClick={() => setShowGrid(g => !g)}
            title="Toggle Grid"
          >
            <Grid size={14} />
          </button>

          <select
            className="select-input-sm"
            value={gridPreset}
            onChange={(e) => {
              handleGridPresetChange(e.target.value);
              if (!showGrid) setShowGrid(true);
            }}
            title="Grid Size"
            style={{ height: '22px', fontSize: '11px', padding: '1px 4px' }}
          >
            <option value="8x8">8x8</option>
            <option value="16x16">16x16</option>
            <option value="24x24">24x24</option>
            <option value="32x32">32x32</option>
            <option value="1x1">1x1 (Pixel)</option>
            <option value="custom">Custom...</option>
          </select>

          {gridPreset === 'custom' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
              <input
                type="number"
                min={1}
                max={512}
                value={customGridWidth}
                onChange={(e) => handleCustomGridWidthChange(parseInt(e.target.value, 10) || 1)}
                className="text-input-sm num-input"
                style={{ width: '38px', height: '22px', fontSize: '11px', padding: '1px 3px', textAlign: 'center' }}
                title="Custom Grid Width (px)"
              />
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>×</span>
              <input
                type="number"
                min={1}
                max={512}
                value={customGridHeight}
                onChange={(e) => handleCustomGridHeightChange(parseInt(e.target.value, 10) || 1)}
                className="text-input-sm num-input"
                style={{ width: '38px', height: '22px', fontSize: '11px', padding: '1px 3px', textAlign: 'center' }}
                title="Custom Grid Height (px)"
              />
            </div>
          )}
        </div>

        {/* Palette Verification & Correction */}
        <div className="toolbar-separator" />
        <div className="toolbar-group">
          <button
            className={`btn btn-sm ${paletteCheckResult?.checked ? (paletteCheckResult.valid ? 'btn-secondary' : 'btn-danger') : 'btn-secondary'}`}
            onClick={handleCheckPalette}
            title={`Check if image pixels adhere to the current ${platform.toUpperCase()} palette (Tolerance: ${activeTolerance})`}
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <CheckCircle2 size={13} className={paletteCheckResult?.checked ? (paletteCheckResult.valid ? 'text-success' : 'text-error') : ''} />
            <span>Check Palette</span>
          </button>

          {paletteCheckResult?.checked && !paletteCheckResult.valid && (
            <button
              className={`icon-action-btn ${showPaletteHighlight ? 'active' : ''}`}
              onClick={() => setShowPaletteHighlight(h => !h)}
              title={showPaletteHighlight ? "Hide non-palette pixel highlights" : "Highlight non-palette pixels on canvas"}
            >
              {showPaletteHighlight ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          )}

          <button
            className="btn btn-sm btn-secondary"
            onClick={handleSnapToPalette}
            title="Convert all non-conforming pixels to their nearest color in the active palette (Ctrl+Z to undo)"
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Wand2 size={13} />
            <span>Snap to Palette</span>
          </button>
        </div>

        {/* Resize Canvas & Save */}
        <div className="toolbar-group" style={{ marginLeft: 'auto' }}>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setIsResizeModalOpen(true)}
            title="Resize canvas dimensions"
          >
            <Maximize2 size={13} />
            <span>Resize</span>
          </button>

          <button
            className={`btn btn-sm ${isDirty ? 'btn-primary' : 'btn-secondary'}`}
            onClick={handleSave}
            disabled={isSaving}
            title="Save Image (Cmd+S)"
          >
            {saveSuccess ? <Check size={13} /> : <Save size={13} />}
            <span>{saveSuccess ? 'Saved!' : isSaving ? 'Saving...' : 'Save'}</span>
          </button>
        </div>
      </div>

      {/* Palette Adherence Warning Banner */}
      {paletteCheckResult?.checked && !paletteCheckResult.valid && (
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            padding: '6px 12px', 
            background: 'rgba(239, 68, 68, 0.15)', 
            borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
            fontSize: '11px',
            color: '#f87171'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertTriangle size={13} />
            <span>
              Found <strong>{paletteCheckResult.invalidCount}</strong> non-palette pixel(s) (Tolerance: {activeTolerance}). Coordinates printed to Console.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button 
              className="btn btn-xs btn-secondary" 
              onClick={() => setShowPaletteHighlight(h => !h)}
            >
              {showPaletteHighlight ? 'Hide Highlights' : 'Highlight on Canvas'}
            </button>
            <button 
              className="btn btn-xs btn-primary" 
              onClick={handleSnapToPalette}
              title="Automatically remap offending pixels to closest palette color"
            >
              Snap Colors
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace Area: Canvas + Palette Sidebar */}
      <div className="pixel-editor-body">
        {/* Canvas Viewport */}
        <div className="pixel-canvas-viewport">
          {isLoading && <div className="canvas-state-msg">Loading image...</div>}

          {error && (
            <div className="canvas-error-msg">
              <AlertCircle size={20} className="text-error" />
              <span>{error}</span>
            </div>
          )}

          <div className="canvas-scroll-container">
            <canvas
              ref={displayCanvasRef}
              className="pixel-display-canvas"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onContextMenu={handleContextMenu}
            />
          </div>
        </div>

        {/* Platform Palette Panel */}
        <div className="pixel-palette-sidebar">
          <div className="palette-sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="palette-title">
              {platform.toUpperCase()} Palette ({palette.length})
            </span>
            {onOpenPaletteManager && (
              <button
                className="icon-action-btn"
                onClick={onOpenPaletteManager}
                title="Manage Platform Palette"
                style={{ padding: '2px', height: '20px', width: '20px' }}
              >
                <Palette size={12} />
              </button>
            )}
          </div>

          <div className="palette-active-preview">
            <div
              className="active-color-box"
              style={{
                backgroundColor: activeColor.isTransparent ? 'transparent' : activeColor.hex,
                backgroundImage: activeColor.isTransparent
                  ? 'repeating-linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%, #333), repeating-linear-gradient(45deg, #333 25%, #222 25%, #222 75%, #333 75%, #333)'
                  : 'none',
                backgroundSize: '8px 8px',
                backgroundPosition: '0 0, 4px 4px'
              }}
            />
            <div className="active-color-meta">
              <span className="active-color-name">{activeColor.name}</span>
              <span className="active-color-code">
                {activeColor.isTransparent ? 'Alpha 0' : activeColor.hex.toUpperCase()}
              </span>
            </div>
          </div>

          <div className="palette-swatches-grid">
            {palette.map((color) => {
              const isSelected = selectedColorIndex === color.index;
              return (
                <button
                  key={color.index}
                  className={`palette-swatch-btn ${isSelected ? 'selected' : ''}`}
                  style={{
                    backgroundColor: color.isTransparent ? 'transparent' : color.hex,
                    backgroundImage: color.isTransparent
                      ? 'repeating-linear-gradient(45deg, #555 25%, transparent 25%, transparent 75%, #555 75%, #555), repeating-linear-gradient(45deg, #555 25%, #222 25%, #222 75%, #555 75%, #555)'
                      : 'none',
                    backgroundSize: '6px 6px',
                    backgroundPosition: '0 0, 3px 3px'
                  }}
                  onClick={() => {
                    setSelectedColorIndex(color.index);
                    if (activeTool === 'eraser') setActiveTool('pencil');
                  }}
                  title={`${color.index}: ${color.name} (${color.hex})`}
                >
                  <span className="swatch-number">{color.index}</span>
                </button>
              );
            })}
          </div>

          <div className="palette-info-footer">
            <div className="palette-tip">
              <strong>Tip:</strong> Right-click canvas to sample a color.
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="pixel-editor-statusbar">
        <div className="statusbar-item">
          {cursorPos ? `X: ${cursorPos.x}, Y: ${cursorPos.y}` : '—'}
        </div>
        <div className="statusbar-item">
          {hoverColor ? `Hover: ${hoverColor}` : `Color: ${activeColor.name}`}
        </div>
        <div className="statusbar-item">
          Mode: {hasAlpha ? 'Alpha Transparency' : 'Solid (No Alpha)'}
        </div>
      </div>

      {/* Resize Modal */}
      <ResizeCanvasModal
        isOpen={isResizeModalOpen}
        onClose={() => setIsResizeModalOpen(false)}
        currentWidth={canvasDimensions.width}
        currentHeight={canvasDimensions.height}
        onResize={handleResizeCanvas}
      />
    </div>
  );
};
