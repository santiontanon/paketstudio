import React, { useState, useEffect, useMemo } from 'react';
import { X, Image as ImageIcon, Plus, AlertCircle } from 'lucide-react';
import { safeInvoke as invoke } from '../utils/ipc';
import type { FileNode, TmxTileset } from '../types';
import { getNextFirstGid } from '../utils/tmxParser';

interface AddTilesetModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: FileNode[];
  projectPath: string;
  tmxFilePath?: string;
  defaultTileWidth: number;
  defaultTileHeight: number;
  existingTilesets: TmxTileset[];
  onAddTileset: (tileset: TmxTileset) => void;
}

export const AddTilesetModal: React.FC<AddTilesetModalProps> = ({
  isOpen,
  onClose,
  files,
  projectPath,
  tmxFilePath,
  defaultTileWidth,
  defaultTileHeight,
  existingTilesets,
  onAddTileset,
}) => {
  const [selectedFileRel, setSelectedFileRel] = useState<string>('');
  const [tilesetName, setTilesetName] = useState<string>('');
  const [tileWidth, setTileWidth] = useState<number>(defaultTileWidth || 8);
  const [tileHeight, setTileHeight] = useState<number>(defaultTileHeight || 8);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Available PNG image files in the project
  const pngFiles = useMemo(() => {
    return files.filter(f => f.extension.toLowerCase() === 'png' && !f.is_dir);
  }, [files]);

  // Set of existing tileset image sources (normalized)
  const existingSources = useMemo(() => {
    return new Set(existingTilesets.map(t => t.image.source.toLowerCase().trim()));
  }, [existingTilesets]);

  // Compute directory of current TMX file
  const tmxDir = useMemo(() => {
    if (!tmxFilePath) return '';
    const norm = tmxFilePath.replace(/\\/g, '/');
    const idx = norm.lastIndexOf('/');
    return idx >= 0 ? norm.substring(0, idx) : '';
  }, [tmxFilePath]);

  // Next available firstgid
  const nextFirstGid = useMemo(() => getNextFirstGid(existingTilesets), [existingTilesets]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTileWidth(defaultTileWidth || 8);
      setTileHeight(defaultTileHeight || 8);
      setErrorMessage(null);

      // Select first unused PNG if available
      const firstAvailable = pngFiles.find(f => !existingSources.has(f.name.toLowerCase()));
      if (firstAvailable) {
        setSelectedFileRel(firstAvailable.relative_path);
        const baseName = firstAvailable.name.replace(/\.png$/i, '');
        setTilesetName(baseName);
      } else if (pngFiles.length > 0) {
        setSelectedFileRel(pngFiles[0].relative_path);
        setTilesetName(pngFiles[0].name.replace(/\.png$/i, ''));
      } else {
        setSelectedFileRel('');
        setTilesetName('');
      }
    }
  }, [isOpen, defaultTileWidth, defaultTileHeight, pngFiles, existingSources]);

  // Load selected PNG to inspect its natural width and height
  useEffect(() => {
    if (!isOpen || !selectedFileRel || !projectPath) {
      setImageDimensions(null);
      setImagePreviewUrl(null);
      return;
    }

    let isCancelled = false;
    setLoadingImage(true);
    setErrorMessage(null);

    const fullPath = selectedFileRel.startsWith('/')
      ? selectedFileRel
      : `${projectPath}/${selectedFileRel}`;

    invoke<string>('read_file_base64', { filePath: fullPath })
      .then(base64Data => {
        if (isCancelled) return;
        const img = new Image();
        img.onload = () => {
          if (isCancelled) return;
          setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
          setImagePreviewUrl(base64Data);
          setLoadingImage(false);
        };
        img.onerror = () => {
          if (isCancelled) return;
          setErrorMessage('Failed to decode image file dimensions.');
          setLoadingImage(false);
        };
        img.src = base64Data;
      })
      .catch(err => {
        if (isCancelled) return;
        setErrorMessage(`Could not read image file: ${err}`);
        setLoadingImage(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, selectedFileRel, projectPath]);

  // Calculated columns and tilecount
  const columns = useMemo(() => {
    if (!imageDimensions || tileWidth <= 0) return 0;
    return Math.floor(imageDimensions.width / tileWidth);
  }, [imageDimensions, tileWidth]);

  const rows = useMemo(() => {
    if (!imageDimensions || tileHeight <= 0) return 0;
    return Math.floor(imageDimensions.height / tileHeight);
  }, [imageDimensions, tileHeight]);

  const tilecount = useMemo(() => {
    return columns * rows;
  }, [columns, rows]);

  // Handle changing selected image file
  const handleSelectFile = (relPath: string) => {
    setSelectedFileRel(relPath);
    const matched = pngFiles.find(f => f.relative_path === relPath);
    if (matched) {
      const baseName = matched.name.replace(/\.png$/i, '');
      setTilesetName(baseName);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFileRel || !imageDimensions) {
      setErrorMessage('Please select a valid image file.');
      return;
    }
    const cleanName = tilesetName.trim();
    if (!cleanName) {
      setErrorMessage('Tileset name cannot be empty.');
      return;
    }
    if (tileWidth <= 0 || tileHeight <= 0) {
      setErrorMessage('Tile dimensions must be positive integers.');
      return;
    }
    if (tilecount <= 0) {
      setErrorMessage('Selected tile size results in 0 tiles for this image.');
      return;
    }

    // Determine relative source filename from TMX location
    let relativeSource = selectedFileRel.split('/').pop() || selectedFileRel;
    if (tmxDir) {
      const normImg = selectedFileRel.replace(/\\/g, '/');
      const normTmxDir = tmxDir.replace(/\\/g, '/');
      if (normImg.startsWith(normTmxDir + '/')) {
        relativeSource = normImg.substring(normTmxDir.length + 1);
      }
    }

    const newTileset: TmxTileset = {
      firstgid: nextFirstGid,
      name: cleanName,
      tilewidth: tileWidth,
      tileheight: tileHeight,
      tilecount,
      columns,
      image: {
        source: relativeSource,
        width: imageDimensions.width,
        height: imageDimensions.height,
      },
    };

    onAddTileset(newTileset);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal-card"
        style={{ width: '480px', maxWidth: '95vw' }}
      >
        <div className="modal-header">
          <div className="modal-title-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ImageIcon size={18} className="text-accent" />
            <span className="modal-title" style={{ fontWeight: 600, fontSize: '14px' }}>
              Add Tileset to Room
            </span>
          </div>
          <button className="icon-action-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {errorMessage && (
              <div
                style={{
                  padding: '8px 12px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '4px',
                  color: '#ef4444',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AlertCircle size={14} />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* PNG File Selection */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                Tileset PNG Image:
              </label>
              {pngFiles.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '6px' }}>
                  No .png files found in this project.
                </div>
              ) : (
                <select
                  className="select-input"
                  value={selectedFileRel}
                  onChange={e => handleSelectFile(e.target.value)}
                  style={{ width: '100%', fontSize: '12px' }}
                >
                  {pngFiles.map(f => (
                    <option key={f.relative_path} value={f.relative_path}>
                      {f.name} {existingSources.has(f.name.toLowerCase()) ? '(Already added)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Tileset Name */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                Tileset Name:
              </label>
              <input
                type="text"
                className="text-input"
                value={tilesetName}
                onChange={e => setTilesetName(e.target.value)}
                placeholder="e.g. bg-tiles"
                style={{ width: '100%', fontSize: '12px' }}
              />
            </div>

            {/* Tile Dimensions */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Tile Width (px):
                </label>
                <input
                  type="number"
                  min={1}
                  max={256}
                  className="text-input"
                  value={tileWidth}
                  onChange={e => setTileWidth(parseInt(e.target.value, 10) || 8)}
                  style={{ width: '100%', fontSize: '12px' }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Tile Height (px):
                </label>
                <input
                  type="number"
                  min={1}
                  max={256}
                  className="text-input"
                  value={tileHeight}
                  onChange={e => setTileHeight(parseInt(e.target.value, 10) || 8)}
                  style={{ width: '100%', fontSize: '12px' }}
                />
              </div>
            </div>

            {/* Image Preview & Calculations */}
            {imageDimensions && (
              <div
                style={{
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '10px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  fontSize: '11px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                  <span>Image Dimensions:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
                    {imageDimensions.width} &times; {imageDimensions.height} px
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                  <span>Grid Slicing:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
                    {columns} columns &times; {rows} rows
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                  <span>Total Tile Count:</span>
                  <span style={{ fontWeight: 600, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
                    {tilecount} tiles
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                  <span>Starting GID (firstgid):</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
                    {nextFirstGid}
                  </span>
                </div>

                {imagePreviewUrl && (
                  <div
                    style={{
                      marginTop: '6px',
                      padding: '8px',
                      background: '#0d1117',
                      borderRadius: '4px',
                      display: 'flex',
                      justifyContent: 'center',
                      maxHeight: '100px',
                      overflow: 'hidden',
                    }}
                  >
                    <img
                      src={imagePreviewUrl}
                      alt="Tileset Preview"
                      style={{
                        maxHeight: '84px',
                        imageRendering: 'pixelated',
                        objectFit: 'contain',
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            className="modal-footer"
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              padding: '12px 16px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
            }}
          >
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loadingImage || tilecount <= 0 || !selectedFileRel}
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Plus size={14} />
              <span>Add Tileset</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
