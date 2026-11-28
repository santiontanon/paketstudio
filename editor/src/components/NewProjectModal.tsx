import React, { useState } from 'react';
import { safeInvoke as invoke } from '../utils/ipc';
import { FolderPlus, FolderOpen, X, AlertCircle } from 'lucide-react';
import type { Platform } from '../types';

import { DEFAULT_PROJECT_NAME, DEFAULT_PLATFORM, STORAGE_KEYS } from '../constants';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (newProjectPath: string, platform: Platform) => void;
  defaultDestination: string;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  onClose,
  onProjectCreated,
  defaultDestination
}) => {
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
  const [platform, setPlatform] = useState<Platform>(DEFAULT_PLATFORM);
  const [destinationDir, setDestinationDir] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.LAST_DESTINATION) || defaultDestination;
  });
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!destinationDir && defaultDestination) {
      setDestinationDir(defaultDestination);
    }
  }, [defaultDestination]);

  if (!isOpen) return null;

  const handleBrowseDestination = async () => {
    try {
      const selected = await invoke<string | null>('pick_folder');
      if (selected) {
        setDestinationDir(selected);
      }
    } catch (err) {
      console.error('Failed to pick folder:', err);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = projectName.trim();
    if (!trimmedName) {
      setError('Please enter a project name.');
      return;
    }

    if (!destinationDir.trim()) {
      setError('Please select or specify a destination folder.');
      return;
    }

    setIsCreating(true);

    try {
      localStorage.setItem(STORAGE_KEYS.LAST_DESTINATION, destinationDir.trim());
      const newPath = await invoke<string>('create_project', {
        parentDir: destinationDir.trim(),
        projectName: trimmedName,
        platform,
      });

      setIsCreating(false);
      onProjectCreated(newPath, platform);
      onClose();
    } catch (err: any) {
      setIsCreating(false);
      setError(err?.message || (typeof err === 'string' ? err : JSON.stringify(err)));
    }
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title">
            <FolderPlus size={16} />
            <span>New PAKET Project</span>
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
            <label>Project Name:</label>
            <input
              type="text"
              className="text-input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. CastleEscape"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Target Platform:</label>
            <select
              className="select-input"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
            >
              <optgroup label="Amstrad CPC">
                <option value="cpc">Amstrad CPC 464 (64K)</option>
                <option value="cpc6128">Amstrad CPC 6128 (128K)</option>
              </optgroup>
              <optgroup label="MSX">
                <option value="msx">MSX (Screen 2)</option>
                <option value="msxmegarom">MSX MegaROM (Screen 2)</option>
                <option value="msx-wt">MSX Wide Tile (Screen 2)</option>
              </optgroup>
            </select>
            <span className="form-hint">
              {platform === 'msx-wt'
                ? 'Initialized from MSX Wide Tile template (Screen 2 with wide tile layouts & assets).'
                : ['cpc', 'cpc6128'].includes(platform)
                  ? 'Initialized from CPC starter template (160x200 Mode 0 screen, starter room & assets).'
                  : 'Initialized from MSX starter template (Screen 2 256x192 graphics, starter room & assets).'}
            </span>
          </div>

          <div className="form-group">
            <label>Destination Directory:</label>
            <div className="input-with-button">
              <input
                type="text"
                className="text-input"
                value={destinationDir}
                onChange={(e) => setDestinationDir(e.target.value)}
                placeholder="/path/to/my-games"
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleBrowseDestination}
              >
                <FolderOpen size={14} />
                <span>Browse...</span>
              </button>
            </div>
            {destinationDir && projectName.trim() && (
              <span className="form-hint">
                Will create: <code>{destinationDir}/{projectName.trim()}</code>
              </span>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isCreating}
            >
              {isCreating ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
