import React, { useRef, useEffect } from 'react';
import Editor, { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { registerPaketLanguage } from '../utils/paketLang';
import { PixelEditorPane } from './PixelEditorPane';
import type { EditorTab, Platform } from '../types';
import type { PaletteColor } from '../utils/palettes';
import { IMAGE_EXTENSIONS } from '../constants';
import { FileCode2, Save, FolderPlus, FolderOpen } from 'lucide-react';

interface MonacoEditorPaneProps {
  activeTab: EditorTab | null;
  platform: Platform;
  palette?: PaletteColor[];
  tolerance?: number;
  onOpenPaletteManager?: () => void;
  onLogToConsole?: (msg: string) => void;
  onContentChange: (newContent: string, isDirty: boolean) => void;
  onSave: () => void;
  onCompile: () => void;
  onNewProject?: () => void;
  onOpenFolder?: () => void;
  hasProject?: boolean;
}

export const MonacoEditorPane: React.FC<MonacoEditorPaneProps> = ({
  activeTab,
  platform,
  palette,
  tolerance,
  onOpenPaletteManager,
  onLogToConsole,
  onContentChange,
  onSave,
  onCompile,
  onNewProject,
  onOpenFolder,
  hasProject,
}) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<string[]>([]);

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const onCompileRef = useRef(onCompile);
  onCompileRef.current = onCompile;

  const handleEditorWillMount = (monaco: Monaco) => {
    monacoRef.current = monaco;
    registerPaketLanguage(monaco);
  };

  const handleEditorDidMount = (editorInstance: editor.IStandaloneCodeEditor) => {
    editorRef.current = editorInstance;

    // Custom Save Command: Cmd+S / Ctrl+S
    editorInstance.addCommand(
      // KeyMod.CtrlCmd | KeyCode.KeyS
      2048 | 49,
      () => {
        onSaveRef.current();
      }
    );

    // F5 to Compile
    editorInstance.addCommand(
      // KeyCode.F5
      63,
      () => {
        onCompileRef.current();
      }
    );
  };

  // When targetLine changes (e.g. user clicked a compiler error), scroll and highlight
  useEffect(() => {
    if (!editorRef.current) return;

    if (activeTab?.targetLine && activeTab.targetLine > 0) {
      const line = activeTab.targetLine;
      editorRef.current.revealLineInCenter(line);
      editorRef.current.setPosition({ lineNumber: line, column: 1 });
      editorRef.current.focus();

      // Add line highlight decoration
      if (monacoRef.current) {
        decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, [
          {
            range: new monacoRef.current.Range(line, 1, line, 1),
            options: {
              isWholeLine: true,
              className: 'monaco-error-line-highlight',
              glyphMarginClassName: 'monaco-error-glyph',
            },
          },
        ]);
      }
    } else {
      // Clear line highlight decorations when there is no targetLine
      if (decorationsRef.current.length > 0) {
        decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, []);
      }
    }
  }, [activeTab?.targetLine, activeTab?.id]);

  if (!activeTab) {
    return (
      <div className="editor-empty-state">
        <div className="retro-banner">
          <FileCode2 size={48} className="retro-icon" />
          <h2>PAKET Studio</h2>
          <p>8-bit Point & Click Adventure Game IDE</p>

          {!hasProject && onNewProject && onOpenFolder && (
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', margin: '20px 0 10px 0' }}>
              <button className="btn btn-primary" onClick={onNewProject}>
                <FolderPlus size={16} />
                <span>New Project</span>
              </button>
              <button className="btn btn-secondary" onClick={onOpenFolder}>
                <FolderOpen size={16} />
                <span>Open Folder</span>
              </button>
            </div>
          )}

          <div className="shortcuts-card">
            <h4>Quick Shortcuts</h4>
            <ul>
              <li><kbd>F5</kbd> Compile Game to Target Platform</li>
              <li><kbd>Cmd/Ctrl + S</kbd> Save Active File</li>
              <li>Click any compiler error in the bottom panel to jump to line</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // If the file is an image, display the pixel-art editor
  const ext = activeTab.filePath.split('.').pop()?.toLowerCase() || '';
  if (IMAGE_EXTENSIONS.has(ext)) {
    return (
      <PixelEditorPane
        key={activeTab.filePath}
        filePath={activeTab.filePath}
        title={activeTab.title}
        platform={platform}
        initialDataUrl={activeTab.isDirty && activeTab.content ? activeTab.content : undefined}
        isTabDirty={activeTab.isDirty}
        palette={palette}
        tolerance={tolerance}
        onOpenPaletteManager={onOpenPaletteManager}
        onLogToConsole={onLogToConsole}
        onDirtyChange={(dirty, currentContent) => {
          onContentChange(currentContent, dirty);
        }}
        onSave={async () => {
          await onSave();
        }}
      />
    );
  }

  const isPak = ext === 'pak';
  const language = isPak ? 'paket' : ext === 'json' ? 'json' : ext === 'xml' || ext === 'tmx' ? 'xml' : 'plaintext';

  return (
    <div className="monaco-wrapper">
      <div className="editor-status-bar">
        <div className="status-left">
          <span className="file-indicator">{activeTab.filePath}</span>
          {activeTab.isDirty && <span className="unsaved-badge">Unsaved Changes</span>}
        </div>
        <div className="status-right">
          <button className="btn btn-sm btn-secondary" onClick={onSave} title="Save File (Cmd+S)">
            <Save size={13} />
            <span>Save</span>
          </button>
          <span className="lang-badge">{language.toUpperCase()}</span>
        </div>
      </div>

      <div className="editor-container">
        <Editor
          key={activeTab.id}
          path={activeTab.filePath}
          height="100%"
          language={language}
          theme="paket-dark"
          value={activeTab.content}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorDidMount}
          onChange={(val) => onContentChange(val || '', true)}
          options={{
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace",
            lineNumbers: 'on',
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
            renderWhitespace: 'selection',
            bracketPairColorization: { enabled: true },
          }}
        />
      </div>
    </div>
  );
};
