import React, { useState, useEffect, useMemo } from 'react';
import { Maximize2, X, AlertTriangle, AlertCircle } from 'lucide-react';
import type { TmxData } from '../types';
import { MIN_ROOM_SIZE } from '../constants';
import { getMaxRoomSize, validateRoomDimensions } from '../utils/screenAreas';
import { getObjectsOutsideRoomBounds } from '../utils/tmxParser';

const MAX_LISTED_OBJECT_NAMES = 4;

interface ResizeRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  tmxData: TmxData;
  offsetX: number;
  offsetY: number;
  gameAreaWidth: number;
  gameAreaHeight: number;
  onResize: (newWidth: number, newHeight: number) => void;
}

export const ResizeRoomModal: React.FC<ResizeRoomModalProps> = ({
  isOpen,
  onClose,
  tmxData,
  offsetX,
  offsetY,
  gameAreaWidth,
  gameAreaHeight,
  onResize,
}) => {
  const [width, setWidth] = useState<number>(tmxData.width);
  const [height, setHeight] = useState<number>(tmxData.height);

  useEffect(() => {
    if (isOpen) {
      setWidth(tmxData.width);
      setHeight(tmxData.height);
    }
  }, [isOpen, tmxData.width, tmxData.height]);

  const { maxWidth, maxHeight } = useMemo(
    () => getMaxRoomSize(gameAreaWidth, gameAreaHeight, offsetX, offsetY),
    [gameAreaWidth, gameAreaHeight, offsetX, offsetY]
  );

  const validationError = useMemo(
    () => validateRoomDimensions(width, height, offsetX, offsetY, gameAreaWidth, gameAreaHeight),
    [width, height, offsetX, offsetY, gameAreaWidth, gameAreaHeight]
  );

  const affectedObjects = useMemo(() => {
    if (validationError) return [];
    return getObjectsOutsideRoomBounds(
      tmxData.objects,
      width,
      height,
      tmxData.tilewidth,
      tmxData.tileheight
    );
  }, [validationError, tmxData.objects, tmxData.tilewidth, tmxData.tileheight, width, height]);

  if (!isOpen) return null;

  const isUnchanged = width === tmxData.width && height === tmxData.height;
  const isShrinkingTiles = width < tmxData.width || height < tmxData.height;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError || isUnchanged) return;
    onResize(width, height);
    onClose();
  };

  const affectedNames = affectedObjects
    .slice(0, MAX_LISTED_OBJECT_NAMES)
    .map(o => o.name || `#${o.id}`)
    .join(', ');
  const remainingCount = affectedObjects.length - MAX_LISTED_OBJECT_NAMES;

  return (
    <div
      className="modal-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-dialog modal-dialog-sm">
        <div className="modal-header">
          <div className="modal-title-group">
            <Maximize2 size={18} className="modal-icon" />
            <span className="modal-title">Resize Room</span>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="modal-instruction">
              Enter new room dimensions in tiles. Existing tiles are anchored to the top-left corner.
            </p>

            {validationError && (
              <div className="inspector-alert error" style={{ marginBottom: '12px' }}>
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span>{validationError}</span>
              </div>
            )}

            {affectedObjects.length > 0 && (
              <div
                className="inspector-alert"
                style={{
                  marginBottom: '12px',
                  background: 'rgba(245, 158, 11, 0.12)',
                  borderColor: 'rgba(245, 158, 11, 0.4)',
                  color: '#f59e0b',
                }}
              >
                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                <span>
                  {affectedObjects.length === 1 ? '1 placed object' : `${affectedObjects.length} placed objects`} (
                  {affectedNames}
                  {remainingCount > 0 ? `, +${remainingCount} more` : ''}) will be clamped inside the new room bounds. You can undo this change.
                </span>
              </div>
            )}

            <div className="form-group-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Width (tiles)</label>
                <input
                  type="number"
                  className="text-input num-input"
                  min={MIN_ROOM_SIZE}
                  max={maxWidth}
                  value={width}
                  onChange={e => setWidth(parseInt(e.target.value, 10) || 0)}
                  autoFocus
                />
                <span className="form-hint">
                  Max {maxWidth} ({Math.max(0, width) * tmxData.tilewidth} px)
                </span>
              </div>

              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Height (tiles)</label>
                <input
                  type="number"
                  className="text-input num-input"
                  min={MIN_ROOM_SIZE}
                  max={maxHeight}
                  value={height}
                  onChange={e => setHeight(parseInt(e.target.value, 10) || 0)}
                />
                <span className="form-hint">
                  Max {maxHeight} ({Math.max(0, height) * tmxData.tileheight} px)
                </span>
              </div>
            </div>

            <div className="form-help-text" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span>
                Current: {tmxData.width} × {tmxData.height} tiles ({tmxData.width * tmxData.tilewidth} × {tmxData.height * tmxData.tileheight} px)
              </span>
              <span>
                Game area: {gameAreaWidth} × {gameAreaHeight} tiles
                {(offsetX > 0 || offsetY > 0) ? ` (room offset: ${offsetX}, ${offsetY})` : ''}
              </span>
              {isShrinkingTiles && !validationError && affectedObjects.length === 0 && (
                <span>Tiles outside the new size will be cropped (undoable).</span>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={Boolean(validationError) || isUnchanged}
            >
              Resize
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
