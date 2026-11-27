import React, { useState, useMemo } from 'react';
import { safeInvoke as invoke } from '../utils/ipc';
import { FilePlus, X, AlertCircle } from 'lucide-react';
import type { FileNode, Platform } from '../types';
import {
  NEW_FILE_TYPES,
  DEFAULT_NEW_PAK_NAME,
  DEFAULT_NEW_PNG_NAME,
  DEFAULT_NEW_TMX_NAME,
  DEFAULT_IMAGE_WIDTH,
  DEFAULT_IMAGE_HEIGHT
} from '../constants';
import { getScreenGuidelines, getDefaultTileSize } from '../utils/screenAreas';
import { createEmptyTmxData, serializeTmxXml } from '../utils/tmxParser';

interface NewFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string;
  existingFiles: FileNode[];
  platform: Platform;
  pakTexts: string[];
  onFileCreated: (filePath: string, fileName: string) => void;
}

export const NewFileModal: React.FC<NewFileModalProps> = ({
  isOpen,
  onClose,
  projectPath,
  existingFiles,
  platform,
  pakTexts,
  onFileCreated
}) => {
  const [selectedExtension, setSelectedExtension] = useState<string>(NEW_FILE_TYPES[0].extension);
  const [fileName, setFileName] = useState<string>(DEFAULT_NEW_PAK_NAME);
  const [targetFolder, setTargetFolder] = useState<string>('');
  const [imageWidth, setImageWidth] = useState<number>(DEFAULT_IMAGE_WIDTH);
  const [imageHeight, setImageHeight] = useState<number>(DEFAULT_IMAGE_HEIGHT);
  const [imageHasTransparency, setImageHasTransparency] = useState<boolean>(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract distinct folders from existing files for location dropdown
  const folderOptions = useMemo(() => {
    const folders = new Set<string>();
    folders.add(''); // Root directory

    for (const file of existingFiles) {
      if (file.relative_path.includes('/')) {
        const parts = file.relative_path.split('/');
        parts.pop(); // remove filename
        let current = '';
        for (const part of parts) {
          current = current ? `${current}/${part}` : part;
          folders.add(current);
        }
      }
    }
    return Array.from(folders).sort();
  }, [existingFiles]);

  if (!isOpen) return null;

  const currentTypeConfig = NEW_FILE_TYPES.find(t => t.extension === selectedExtension) || NEW_FILE_TYPES[0];

  const handleTypeChange = (ext: string) => {
    setSelectedExtension(ext);
    if (ext === 'png') {
      setFileName(DEFAULT_NEW_PNG_NAME);
    } else if (ext === 'tmx') {
      setFileName(DEFAULT_NEW_TMX_NAME);
    } else {
      const lastDotIndex = fileName.lastIndexOf('.');
      if (lastDotIndex > 0) {
        const baseName = fileName.slice(0, lastDotIndex);
        setFileName(`${baseName}.${ext}`);
      } else if (fileName) {
        setFileName(`${fileName}.${ext}`);
      }
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let cleanName = fileName.trim();
    if (!cleanName) {
      setError('Please enter a file name.');
      return;
    }

    // Auto-append selected extension if missing
    if (!cleanName.toLowerCase().endsWith(`.${selectedExtension}`)) {
      cleanName = `${cleanName}.${selectedExtension}`;
    }

    // Determine target relative and absolute paths
    const relativePath = targetFolder ? `${targetFolder}/${cleanName}` : cleanName;
    const fullPath = `${projectPath}/${relativePath}`;

    // Check collision against existing files
    const alreadyExists = existingFiles.some(f => f.path.toLowerCase() === fullPath.toLowerCase() || f.relative_path.toLowerCase() === relativePath.toLowerCase());
    if (alreadyExists) {
      setError(`A file named "${relativePath}" already exists in this project.`);
      return;
    }

    setIsCreating(true);

    try {
      if (selectedExtension === 'png') {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, imageWidth);
        canvas.height = Math.max(1, imageHeight);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (!imageHasTransparency) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
        }
        const base64Data = canvas.toDataURL('image/png');
        await invoke('write_file_base64', {
          filePath: fullPath,
          base64Data,
        });
      } else if (selectedExtension === 'tmx') {
        const { tileWidth, tileHeight } = getDefaultTileSize(platform);
        const { gameArea } = getScreenGuidelines(platform, pakTexts, tileWidth, tileHeight);
        const tmxContent = serializeTmxXml(
          createEmptyTmxData(gameArea.width, gameArea.height, tileWidth, tileHeight)
        );
        await invoke('write_text_file', {
          filePath: fullPath,
          content: tmxContent,
        });
      } else {
        await invoke('write_text_file', {
          filePath: fullPath,
          content: currentTypeConfig.defaultContent,
        });
      }

      setIsCreating(false);
      onFileCreated(fullPath, cleanName);
      onClose();
    } catch (err: any) {
      setIsCreating(false);
      setError(err?.message || (typeof err === 'string' ? err : JSON.stringify(err)));
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <FilePlus size={16} />
            <span>New File</span>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleCreate} className="modal-body">
          {error && (
            <div className="modal-error">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="new-file-type">File Type:</label>
            <select
              id="new-file-type"
              className="select-input"
              value={selectedExtension}
              onChange={(e) => handleTypeChange(e.target.value)}
            >
              {NEW_FILE_TYPES.map(t => (
                <option key={t.extension} value={t.extension}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="new-file-name">File Name:</label>
            <input
              id="new-file-name"
              type="text"
              className="text-input"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder={`e.g. dialogues.${selectedExtension}`}
              autoFocus
            />
          </div>

          {selectedExtension === 'png' && (
            <div className="form-group-card">
              <div className="form-row-2col">
                <div className="form-group">
                  <label htmlFor="png-width">Width (px):</label>
                  <input
                    id="png-width"
                    type="number"
                    min={1}
                    max={4096}
                    className="text-input num-input"
                    value={imageWidth}
                    onChange={(e) => setImageWidth(parseInt(e.target.value, 10) || 0)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="png-height">Height (px):</label>
                  <input
                    id="png-height"
                    type="number"
                    min={1}
                    max={4096}
                    className="text-input num-input"
                    value={imageHeight}
                    onChange={(e) => setImageHeight(parseInt(e.target.value, 10) || 0)}
                  />
                </div>
              </div>

              <div className="checkbox-row" style={{ marginTop: '8px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={imageHasTransparency}
                    onChange={(e) => setImageHasTransparency(e.target.checked)}
                  />
                  <span>Transparent background (alpha channel)</span>
                </label>
              </div>
            </div>
          )}

          {folderOptions.length > 1 && (
            <div className="form-group">
              <label htmlFor="new-file-folder">Folder Location:</label>
              <select
                id="new-file-folder"
                className="select-input"
                value={targetFolder}
                onChange={(e) => setTargetFolder(e.target.value)}
              >
                {folderOptions.map(folder => (
                  <option key={folder} value={folder}>
                    {folder ? `/${folder}` : '/ (Project Root)'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isCreating}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isCreating}>
              {isCreating ? 'Creating...' : 'Create File'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
