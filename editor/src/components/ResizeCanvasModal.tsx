import React, { useState } from 'react';
import { Maximize2, X } from 'lucide-react';

interface ResizeCanvasModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentWidth: number;
  currentHeight: number;
  onResize: (newWidth: number, newHeight: number) => void;
}

export const ResizeCanvasModal: React.FC<ResizeCanvasModalProps> = ({
  isOpen,
  onClose,
  currentWidth,
  currentHeight,
  onResize,
}) => {
  const [width, setWidth] = useState<number>(currentWidth);
  const [height, setHeight] = useState<number>(currentHeight);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (width < 1 || height < 1) {
      setError('Dimensions must be at least 1 × 1.');
      return;
    }
    if (width > 4096 || height > 4096) {
      setError('Dimensions cannot exceed 4096 × 4096.');
      return;
    }
    setError(null);
    onResize(width, height);
    onClose();
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-dialog modal-dialog-sm">
        <div className="modal-header">
          <div className="modal-title-group">
            <Maximize2 size={18} className="modal-icon" />
            <span className="modal-title">Resize Canvas</span>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="modal-instruction">
              Enter new dimensions for the image canvas. Existing artwork will be anchored to the top-left corner.
            </p>

            {error && <div className="modal-error-banner">{error}</div>}

            <div className="form-group-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Width (pixels)</label>
                <input
                  type="number"
                  className="form-input"
                  min={1}
                  max={4096}
                  value={width}
                  onChange={(e) => setWidth(parseInt(e.target.value, 10) || 0)}
                  autoFocus
                />
              </div>

              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Height (pixels)</label>
                <input
                  type="number"
                  className="form-input"
                  min={1}
                  max={4096}
                  value={height}
                  onChange={(e) => setHeight(parseInt(e.target.value, 10) || 0)}
                />
              </div>
            </div>

            <div className="form-help-text">
              Current size: {currentWidth} × {currentHeight} px
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Resize
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

