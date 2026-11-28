import React, { useState, useEffect } from 'react';
import { Monitor, FolderOpen } from 'lucide-react';
import type { Platform } from '../types';
import { DEFAULT_PLATFORM } from '../constants';

interface SelectPlatformModalProps {
  isOpen: boolean;
  folderPath: string;
  onConfirm: (platform: Platform) => void;
  onCancel: () => void;
}

export const SelectPlatformModal: React.FC<SelectPlatformModalProps> = ({
  isOpen,
  folderPath,
  onConfirm,
  onCancel,
}) => {
  const [platform, setPlatform] = useState<Platform>(DEFAULT_PLATFORM);

  // Auto-detect a sensible initial platform from the folder name
  useEffect(() => {
    if (!folderPath) return;
    const lower = folderPath.toLowerCase();
    if (lower.includes('msx-wt') || lower.includes('msx_wt')) {
      setPlatform('msx-wt');
    } else if (lower.includes('msxmegarom')) {
      setPlatform('msxmegarom');
    } else if (lower.includes('msx')) {
      setPlatform('msx');
    } else if (lower.includes('cpc6128')) {
      setPlatform('cpc6128');
    } else if (lower.includes('cpc')) {
      setPlatform('cpc');
    } else {
      setPlatform(DEFAULT_PLATFORM);
    }
  }, [folderPath, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(platform);
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="modal-dialog modal-dialog-sm">
        <div className="modal-header">
          <div className="modal-title-group">
            <Monitor size={18} className="modal-icon text-accent" />
            <span className="modal-title">Select Project Platform</span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 12px 0', lineHeight: 1.4 }}>
              This project folder does not have a saved platform configuration. Select the target 8-bit platform for this project:
            </p>

            <div className="form-group">
              <label>Project Folder:</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-app)', padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={folderPath}>
                <FolderOpen size={14} className="text-accent" style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left' }}>{folderPath}</span>
              </div>
            </div>

            <div className="form-group">
              <label>Target Platform:</label>
              <select
                className="select-input"
                style={{ width: '100%', padding: '6px 8px' }}
                value={platform}
                onChange={e => setPlatform(e.target.value as Platform)}
                autoFocus
              >
                <optgroup label="Amstrad CPC">
                  <option value="cpc">Amstrad CPC 464 (64K Mode 0)</option>
                  <option value="cpc6128">Amstrad CPC 6128 (128K Mode 0)</option>
                </optgroup>
                <optgroup label="MSX">
                  <option value="msx">MSX 1 / 2 (Screen 2 256×192)</option>
                  <option value="msxmegarom">MSX MegaROM (Screen 2)</option>
                  <option value="msx-wt">MSX Wide Tile (Screen 2 16×8 Tiles)</option>
                </optgroup>
              </select>
              <span className="form-hint" style={{ marginTop: '6px' }}>
                {platform === 'msx-wt'
                  ? 'MSX Wide Tile: 256×192 graphics with 16×8 wide character cells.'
                  : ['cpc', 'cpc6128'].includes(platform)
                    ? 'Amstrad CPC: 160×200 Mode 0 graphics (even X coordinate byte alignment).'
                    : 'MSX: Standard Screen 2 256×192 resolution with 8×8 tiles.'}
              </span>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
            >
              Open Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
