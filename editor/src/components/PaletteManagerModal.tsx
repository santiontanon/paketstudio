import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  RotateCcw, 
  RotateCw, 
  RefreshCw, 
  Palette, 
  Sliders 
} from 'lucide-react';
import type { Platform } from '../types';
import { 
  PaletteColor, 
  clonePalette, 
  getPlatformPalette, 
  getPlatformDefaultTolerance, 
  rgbToHex, 
  hexToRgb 
} from '../utils/palettes';
import { 
  CPC_COLOR_COUNT, 
  MSX_COLOR_COUNT 
} from '../constants';

interface PaletteManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  platform: Platform;
  palette: PaletteColor[];
  tolerance: number;
  isCustomPalette: boolean;
  onApplyPalette: (newPalette: PaletteColor[], newTolerance: number) => void;
  onResetToDefault: () => void;
}

interface PaletteHistoryState {
  colors: PaletteColor[];
  tolerance: number;
}

const MAX_PALETTE_HISTORY = 30;

export const PaletteManagerModal: React.FC<PaletteManagerModalProps> = ({
  isOpen,
  onClose,
  platform,
  palette,
  tolerance,
  isCustomPalette,
  onApplyPalette,
  onResetToDefault
}) => {
  const isMsx = platform.startsWith('msx');
  const expectedCount = isMsx ? MSX_COLOR_COUNT : CPC_COLOR_COUNT;
  const platformName = isMsx ? 'MSX Screen 2' : 'Amstrad CPC';

  const [currentColors, setCurrentColors] = useState<PaletteColor[]>(() => clonePalette(palette));
  const [currentTolerance, setCurrentTolerance] = useState<number>(tolerance);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const [undoStack, setUndoStack] = useState<PaletteHistoryState[]>([]);
  const [redoStack, setRedoStack] = useState<PaletteHistoryState[]>([]);

  // Re-sync when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentColors(clonePalette(palette));
      setCurrentTolerance(tolerance);
      setSelectedIndex(0);
      setUndoStack([]);
      setRedoStack([]);
    }
  }, [isOpen, palette, tolerance]);

  const activeColor = currentColors[selectedIndex] || currentColors[0];

  const pushUndo = useCallback((prevColors: PaletteColor[], prevTolerance: number) => {
    setUndoStack(prev => {
      const next = [...prev, { colors: clonePalette(prevColors), tolerance: prevTolerance }];
      if (next.length > MAX_PALETTE_HISTORY) next.shift();
      return next;
    });
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, prev.length - 1));
    setRedoStack(prev => [...prev, { colors: clonePalette(currentColors), tolerance: currentTolerance }]);
    setCurrentColors(clonePalette(previous.colors));
    setCurrentTolerance(previous.tolerance);
  }, [undoStack, currentColors, currentTolerance]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, prev.length - 1));
    setUndoStack(prev => [...prev, { colors: clonePalette(currentColors), tolerance: currentTolerance }]);
    setCurrentColors(clonePalette(next.colors));
    setCurrentTolerance(next.tolerance);
  }, [redoStack, currentColors, currentTolerance]);

  // Keyboard shortcuts for Undo/Redo/Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleUndo, handleRedo, onClose]);

  // Color modification
  const updateActiveColorRgb = (r: number, g: number, b: number) => {
    const clampedR = Math.max(0, Math.min(255, Math.round(r)));
    const clampedG = Math.max(0, Math.min(255, Math.round(g)));
    const clampedB = Math.max(0, Math.min(255, Math.round(b)));
    const hex = rgbToHex(clampedR, clampedG, clampedB);

    pushUndo(currentColors, currentTolerance);

    setCurrentColors(prev => {
      const next = clonePalette(prev);
      if (next[selectedIndex]) {
        next[selectedIndex] = {
          ...next[selectedIndex],
          r: clampedR,
          g: clampedG,
          b: clampedB,
          hex
        };
      }
      return next;
    });
  };

  const handleHexChange = (newHex: string) => {
    const parsed = hexToRgb(newHex);
    if (parsed) {
      updateActiveColorRgb(parsed.r, parsed.g, parsed.b);
    }
  };

  const handleToleranceChange = (newTol: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(newTol)));
    pushUndo(currentColors, currentTolerance);
    setCurrentTolerance(clamped);
  };

  const handleResetToDefault = () => {
    const defaultPal = getPlatformPalette(platform);
    const defaultTol = getPlatformDefaultTolerance(platform);
    pushUndo(currentColors, currentTolerance);
    setCurrentColors(defaultPal);
    setCurrentTolerance(defaultTol);
  };

  const handleApply = () => {
    onApplyPalette(currentColors, currentTolerance);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="modal-card palette-manager-modal" 
        style={{ width: '680px', maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Modal Header */}
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Palette size={18} className="text-accent" />
            <div>
              <h3 style={{ margin: 0, fontSize: '15px' }}>Palette Manager</h3>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {platformName} ({expectedCount} Colors) &bull; Master RGB Hardware Palette
              </span>
            </div>
          </div>
          <button className="icon-action-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        {/* Modal Toolbar */}
        <div 
          style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            padding: '8px 16px', 
            background: 'var(--bg-surface-elevated)', 
            borderBottom: '1px solid var(--border-subtle)',
            fontSize: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button 
              className="btn btn-sm btn-secondary" 
              onClick={handleUndo} 
              disabled={undoStack.length === 0}
              title="Undo color edit (Ctrl+Z)"
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <RotateCcw size={13} />
              <span>Undo</span>
            </button>
            <button 
              className="btn btn-sm btn-secondary" 
              onClick={handleRedo} 
              disabled={redoStack.length === 0}
              title="Redo color edit (Ctrl+Y)"
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <RotateCw size={13} />
              <span>Redo</span>
            </button>
            <button 
              className="btn btn-sm btn-secondary" 
              onClick={handleResetToDefault}
              title="Revert all colors to official PAKET default hardware palette"
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <RefreshCw size={13} />
              <span>Defaults</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sliders size={13} style={{ opacity: 0.7 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Tolerance:</span>
            <input 
              type="number" 
              min={0} 
              max={255} 
              className="text-input" 
              style={{ width: '60px', padding: '2px 6px', fontSize: '12px' }}
              value={currentTolerance}
              onChange={e => handleToleranceChange(parseInt(e.target.value, 10) || 0)}
              title="Per-channel RGB distance tolerance used by PAKET compiler and editor (Default: 64 for CPC, 32 for MSX)"
            />
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '16px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Swatches Grid */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Palette Swatches</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Click a swatch to select and edit its RGB components
              </span>
            </div>

            <div 
              style={{ 
                display: 'grid', 
                gridTemplateColumns: isMsx ? 'repeat(8, 1fr)' : 'repeat(9, 1fr)', 
                gap: '6px',
                background: 'var(--bg-app)',
                padding: '10px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              {currentColors.map((col, idx) => {
                const isSelected = selectedIndex === idx;
                return (
                  <button
                    key={col.index}
                    onClick={() => setSelectedIndex(idx)}
                    title={`#${col.index}: ${col.name} (${col.hex})`}
                    style={{
                      height: '42px',
                      borderRadius: 'var(--radius-sm)',
                      border: isSelected ? '2px solid var(--accent-primary, #38bdf8)' : '1px solid var(--border-subtle)',
                      boxShadow: isSelected ? '0 0 0 2px var(--bg-surface), 0 0 8px rgba(56, 189, 248, 0.5)' : 'none',
                      backgroundColor: col.isTransparent ? 'transparent' : col.hex,
                      backgroundImage: col.isTransparent
                        ? 'repeating-linear-gradient(45deg, #444 25%, transparent 25%, transparent 75%, #444 75%, #444), repeating-linear-gradient(45deg, #444 25%, #222 25%, #222 75%, #444 75%, #444)'
                        : 'none',
                      backgroundSize: '8px 8px',
                      backgroundPosition: '0 0, 4px 4px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      padding: '2px 4px',
                      position: 'relative'
                    }}
                  >
                    <span 
                      style={{ 
                        fontSize: '9px', 
                        fontWeight: 700, 
                        color: (col.r * 0.299 + col.g * 0.587 + col.b * 0.114) > 140 ? '#000' : '#fff',
                        textShadow: (col.r * 0.299 + col.g * 0.587 + col.b * 0.114) > 140 ? 'none' : '0 1px 2px #000'
                      }}
                    >
                      {col.index}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Color Inspector */}
          {activeColor && (
            <div 
              style={{ 
                background: 'var(--bg-surface-elevated)', 
                border: '1px solid var(--border-subtle)', 
                borderRadius: 'var(--radius-md)', 
                padding: '14px',
                display: 'flex',
                gap: '16px'
              }}
            >
              {/* Color Box & Picker */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <div 
                  style={{ 
                    width: '72px', 
                    height: '72px', 
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: activeColor.isTransparent ? 'transparent' : activeColor.hex,
                    backgroundImage: activeColor.isTransparent
                      ? 'repeating-linear-gradient(45deg, #444 25%, transparent 25%, transparent 75%, #444 75%, #444), repeating-linear-gradient(45deg, #444 25%, #222 25%, #222 75%, #444 75%, #444)'
                      : 'none',
                    backgroundSize: '12px 12px',
                    boxShadow: 'inset 0 0 4px rgba(0,0,0,0.4)'
                  }}
                />
                {!activeColor.isTransparent && (
                  <label 
                    className="btn btn-xs btn-secondary"
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
                  >
                    <span>Pick</span>
                    <input 
                      type="color" 
                      value={activeColor.hex}
                      onChange={e => handleHexChange(e.target.value)}
                      style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                    />
                  </label>
                )}
              </div>

              {/* Sliders & Inputs */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>
                    Color #{activeColor.index}: {activeColor.name}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Hex:</span>
                    <input 
                      type="text" 
                      className="text-input"
                      value={activeColor.hex}
                      disabled={activeColor.isTransparent}
                      onChange={e => handleHexChange(e.target.value)}
                      style={{ width: '80px', padding: '2px 6px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>

                {activeColor.isTransparent ? (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0' }}>
                    Color index 0 is transparent in MSX screen modes.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {/* Red */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ width: '16px', fontSize: '11px', fontWeight: 600, color: '#f87171' }}>R</span>
                      <input 
                        type="range" 
                        min={0} 
                        max={255} 
                        value={activeColor.r}
                        onChange={e => updateActiveColorRgb(parseInt(e.target.value, 10) || 0, activeColor.g, activeColor.b)}
                        style={{ flex: 1, accentColor: '#f87171', height: '4px' }}
                      />
                      <input 
                        type="number" 
                        min={0} 
                        max={255} 
                        className="text-input"
                        value={activeColor.r}
                        onChange={e => updateActiveColorRgb(parseInt(e.target.value, 10) || 0, activeColor.g, activeColor.b)}
                        style={{ width: '50px', padding: '1px 4px', fontSize: '11px', textAlign: 'right' }}
                      />
                    </div>

                    {/* Green */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ width: '16px', fontSize: '11px', fontWeight: 600, color: '#4ade80' }}>G</span>
                      <input 
                        type="range" 
                        min={0} 
                        max={255} 
                        value={activeColor.g}
                        onChange={e => updateActiveColorRgb(activeColor.r, parseInt(e.target.value, 10) || 0, activeColor.b)}
                        style={{ flex: 1, accentColor: '#4ade80', height: '4px' }}
                      />
                      <input 
                        type="number" 
                        min={0} 
                        max={255} 
                        className="text-input"
                        value={activeColor.g}
                        onChange={e => updateActiveColorRgb(activeColor.r, parseInt(e.target.value, 10) || 0, activeColor.b)}
                        style={{ width: '50px', padding: '1px 4px', fontSize: '11px', textAlign: 'right' }}
                      />
                    </div>

                    {/* Blue */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ width: '16px', fontSize: '11px', fontWeight: 600, color: '#60a5fa' }}>B</span>
                      <input 
                        type="range" 
                        min={0} 
                        max={255} 
                        value={activeColor.b}
                        onChange={e => updateActiveColorRgb(activeColor.r, activeColor.g, parseInt(e.target.value, 10) || 0)}
                        style={{ flex: 1, accentColor: '#60a5fa', height: '4px' }}
                      />
                      <input 
                        type="number" 
                        min={0} 
                        max={255} 
                        className="text-input"
                        value={activeColor.b}
                        onChange={e => updateActiveColorRgb(activeColor.r, activeColor.g, parseInt(e.target.value, 10) || 0)}
                        style={{ width: '50px', padding: '1px 4px', fontSize: '11px', textAlign: 'right' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Status Note */}
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className={isCustomPalette ? 'text-accent' : ''}>
              {isCustomPalette 
                ? '★ Custom palette defined in .pak file.' 
                : 'Using standard platform default palette.'}
            </span>
            <span>
              Changes will be synchronized to your project&apos;s .pak file and applied to all image editing.
            </span>
          </div>
        </div>

        {/* Modal Footer */}
        <div 
          className="modal-footer" 
          style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            gap: '8px', 
            padding: '12px 16px', 
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)' 
          }}
        >
          {isCustomPalette ? (
            <button 
              className="btn btn-secondary" 
              onClick={() => {
                onResetToDefault();
                onClose();
              }}
              title="Revert to official platform defaults and remove custom palette from .pak"
              style={{ color: '#ef4444' }}
            >
              Reset to Defaults &amp; Remove from .pak
            </button>
          ) : <div />}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleApply}>
              Save to .pak
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
