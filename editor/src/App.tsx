import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { isTauri, safeInvoke as invoke, Channel } from './utils/ipc';
import { Header } from './components/Header';
import { ProjectExplorer } from './components/ProjectExplorer';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { MonacoEditorPane } from './components/MonacoEditorPane';
import { BottomConsole, BottomConsoleTab } from './components/BottomConsole';
import { NewProjectModal } from './components/NewProjectModal';
import { NewFileModal } from './components/NewFileModal';
import { ItemInspector } from './components/ItemInspector';
import { ObjectInspector } from './components/ObjectInspector';
import { RoomInspector } from './components/RoomInspector';
import { SelectPlatformModal } from './components/SelectPlatformModal';
import { PaletteManagerModal } from './components/PaletteManagerModal';
import { 
  parsePakFile, 
  updateItemInContent, 
  updateObjectInContent, 
  updateRoomInContent,
  insertItemIntoContent, 
  insertObjectIntoContent, 
  insertRoomIntoContent,
  deleteItemFromContent, 
  deleteObjectFromContent,
  deleteRoomFromContent,
  parseCustomPaletteFromContent,
  updateCustomPaletteInContent,
  removeCustomPaletteFromContent,
  ParsedCustomPalette
} from './utils/pakParser';
import { 
  PaletteColor, 
  getPlatformPalette, 
  getPlatformDefaultTolerance, 
  rgbToHex 
} from './utils/palettes';
import { normalizePath, isSamePath } from './utils/paths';
import {
  copiesAfterSavingAll,
  copiesAfterTextSave,
  isSameProjectFile,
  latestPakContent,
  viewTypeForFileName,
  type PakCopies
} from './utils/workspaceFiles';
import {
  DEFAULT_PLATFORM,
  DEFAULT_LANGUAGE,
  DEFAULT_MAIN_PAK,
  DEFAULT_OUTPUT_DIR,
  DEFAULT_EMULATOR_COMMAND,
  DEFAULT_COMPILER_ARGS,
  DEFAULT_EXPLORER_WIDTH,
  MIN_EXPLORER_WIDTH,
  MAX_EXPLORER_WIDTH,
  DEFAULT_CONSOLE_HEIGHT,
  MIN_CONSOLE_HEIGHT,
  MAX_CONSOLE_HEIGHT,
  STORAGE_KEYS,
  BINARY_EXTENSIONS,
  getTargetBinaryFilename,
} from './constants';
import type { 
  FileNode, 
  EditorTab, 
  CompilerProblem, 
  CompileResponse, 
  ProjectSettings, 
  SystemInfo,
  Platform,
  PakItem,
  PakObject,
  PakRoom
} from './types';
import './index.css';

const DEFAULT_SETTINGS: ProjectSettings = {
  javaPath: '',
  jarPath: '',
  selectedPlatform: DEFAULT_PLATFORM,
  language: DEFAULT_LANGUAGE,
  mainPakRelative: '',
  outputDirRelative: '',
  emulatorCommand: DEFAULT_EMULATOR_COMMAND,
  compilerArgs: DEFAULT_COMPILER_ARGS
};

const loadProjectSettings = (projPath: string, currentGlobal: ProjectSettings): ProjectSettings => {
  const savedJson = localStorage.getItem(`${STORAGE_KEYS.PROJECT_SETTINGS_PREFIX}${projPath}`);
  if (savedJson) {
    try {
      const parsed = JSON.parse(savedJson);
      return {
        ...currentGlobal,
        ...parsed,
        javaPath: currentGlobal.javaPath,
        jarPath: currentGlobal.jarPath,
      };
    } catch (e) {
      console.warn('Failed to parse project settings:', e);
    }
  }
  return {
    ...currentGlobal,
    selectedPlatform: DEFAULT_PLATFORM,
    language: DEFAULT_LANGUAGE,
    mainPakRelative: '',
    outputDirRelative: '',
    emulatorCommand: DEFAULT_EMULATOR_COMMAND,
    compilerArgs: DEFAULT_COMPILER_ARGS,
  };
};

export const App: React.FC = () => {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState<boolean>(false);
  const [isNewFileModalOpen, setIsNewFileModalOpen] = useState<boolean>(false);
  const [pendingOpenFolder, setPendingOpenFolder] = useState<string | null>(null);
  const [isSelectPlatformModalOpen, setIsSelectPlatformModalOpen] = useState<boolean>(false);

  const [projectItems, setProjectItems] = useState<PakItem[]>([]);
  const [projectObjects, setProjectObjects] = useState<PakObject[]>([]);
  const [projectRooms, setProjectRooms] = useState<PakRoom[]>([]);
  const [inMemoryPakFiles, setInMemoryPakFiles] = useState<PakCopies>({});

  const [consoleOutput, setConsoleOutput] = useState<string>('');
  const [problems, setProblems] = useState<CompilerProblem[]>([]);
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [lastCompileStatus, setLastCompileStatus] = useState<boolean | null>(null);
  const [bottomConsoleTab, setBottomConsoleTab] = useState<BottomConsoleTab>('console');
  const [isBottomConsoleCollapsed, setIsBottomConsoleCollapsed] = useState<boolean>(false);

  // Platform Palette Manager state
  const [isPaletteManagerOpen, setIsPaletteManagerOpen] = useState<boolean>(false);
  const [projectPalette, setProjectPalette] = useState<PaletteColor[]>(() =>
    getPlatformPalette(DEFAULT_PLATFORM)
  );
  const [projectPaletteTolerance, setProjectPaletteTolerance] = useState<number>(() =>
    getPlatformDefaultTolerance(DEFAULT_PLATFORM)
  );
  const [customPaletteSourceFile, setCustomPaletteSourceFile] = useState<string | null>(null);

  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    detected_java: undefined,
    detected_jar: undefined,
  });

  const [settings, setSettings] = useState<ProjectSettings>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  });

  const isLoadingProjectRef = useRef<boolean>(false);

  // Resizable layout panes
  const [explorerWidth, setExplorerWidth] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.EXPLORER_WIDTH);
    return saved ? Math.max(MIN_EXPLORER_WIDTH, Math.min(MAX_EXPLORER_WIDTH, parseInt(saved, 10))) : DEFAULT_EXPLORER_WIDTH;
  });

  const [consoleHeight, setConsoleHeight] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CONSOLE_HEIGHT);
    return saved ? Math.max(MIN_CONSOLE_HEIGHT, Math.min(MAX_CONSOLE_HEIGHT, parseInt(saved, 10))) : DEFAULT_CONSOLE_HEIGHT;
  });

  // Vertical resize for Project Explorer
  const handleExplorerResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = explorerWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(MIN_EXPLORER_WIDTH, Math.min(MAX_EXPLORER_WIDTH, startWidth + delta));
      setExplorerWidth(newWidth);
      localStorage.setItem(STORAGE_KEYS.EXPLORER_WIDTH, newWidth.toString());
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.classList.remove('is-resizing-col');
    };

    document.body.classList.add('is-resizing-col');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [explorerWidth]);

  // Horizontal resize for Bottom Console
  const handleConsoleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = consoleHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const newHeight = Math.max(MIN_CONSOLE_HEIGHT, Math.min(MAX_CONSOLE_HEIGHT, startHeight + delta));
      setConsoleHeight(newHeight);
      localStorage.setItem(STORAGE_KEYS.CONSOLE_HEIGHT, newHeight.toString());
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.classList.remove('is-resizing-row');
    };

    document.body.classList.add('is-resizing-row');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [consoleHeight]);

  // Helper to match paths whether relative or absolute
  const isMatchingFilePath = (pathA: string, pathB: string) => {
    return isSamePath(pathA, pathB) || normalizePath(pathA).endsWith('/' + normalizePath(pathB)) || normalizePath(pathB).endsWith('/' + normalizePath(pathA));
  };

  // Parse all items, objects, rooms, and custom palette across .pak files in project
  const reloadProjectInspectors = useCallback(async (currentFiles: FileNode[], platformOverride?: Platform) => {
    const activePlat = platformOverride || settings.selectedPlatform;
    const pakFiles = currentFiles.filter(f => f.extension.toLowerCase() === 'pak' && !f.is_dir);
    const allItems: PakItem[] = [];
    const allObjects: PakObject[] = [];
    const allRooms: PakRoom[] = [];
    let customPal: (ParsedCustomPalette & { sourceFile: string }) | null = null;

    for (const pf of pakFiles) {
      try {
        const content = await invoke<string>('read_text_file', { filePath: pf.path });
        const { items, objects, rooms } = parsePakFile(content, pf.relative_path);
        allItems.push(...items);
        allObjects.push(...objects);
        allRooms.push(...rooms);

        if (!customPal) {
          const parsedPal = parseCustomPaletteFromContent(content, activePlat);
          if (parsedPal) {
            customPal = { ...parsedPal, sourceFile: pf.relative_path };
          }
        }
      } catch (err) {
        console.warn(`Could not parse ${pf.relative_path}:`, err);
      }
    }

    setProjectItems(allItems);
    setProjectObjects(allObjects);
    setProjectRooms(allRooms);

    if (customPal) {
      const defaultPal = getPlatformPalette(activePlat);
      const fullColors: PaletteColor[] = customPal.colors.map((c, idx) => ({
        index: idx,
        name: defaultPal[idx]?.name || `Color ${idx}`,
        hex: rgbToHex(c.r, c.g, c.b),
        r: c.r,
        g: c.g,
        b: c.b,
        isTransparent: defaultPal[idx]?.isTransparent ?? false,
      }));
      setProjectPalette(fullColors);
      setProjectPaletteTolerance(
        customPal.tolerance !== undefined
          ? customPal.tolerance
          : getPlatformDefaultTolerance(activePlat)
      );
      setCustomPaletteSourceFile(customPal.sourceFile);
    } else {
      setProjectPalette(getPlatformPalette(activePlat));
      setProjectPaletteTolerance(getPlatformDefaultTolerance(activePlat));
      setCustomPaletteSourceFile(null);
    }
  }, [settings.selectedPlatform]);

  // Unified project open function
  const openProject = useCallback(async (dirPath: string, overridePlatform?: Platform) => {
    isLoadingProjectRef.current = true;
    const cleanDirPath = normalizePath(dirPath);
    try {
      const fileList = await invoke<FileNode[]>('list_project_files', { projectPath: cleanDirPath });
      setProjectPath(cleanDirPath);
      localStorage.setItem(STORAGE_KEYS.LAST_PROJECT_PATH, cleanDirPath);
      setFiles(fileList);
      setInMemoryPakFiles({});
      setTabs([]);
      setActiveTabId(null);
      setProblems([]);
      setLastCompileStatus(null);
      setConsoleOutput(`Opened project folder: ${cleanDirPath}\n`);

      const pakFiles = fileList.filter(f => f.extension.toLowerCase() === 'pak');
      const loaded = loadProjectSettings(cleanDirPath, settings);
      if (overridePlatform) {
        loaded.selectedPlatform = overridePlatform;
      }
      let effectiveMain = loaded.mainPakRelative;
      if (!effectiveMain || !pakFiles.some(p => p.relative_path === effectiveMain)) {
        if (pakFiles.length > 0) {
          const preferred = pakFiles.find(p => p.name === DEFAULT_MAIN_PAK && p.relative_path.startsWith(loaded.selectedPlatform))
            || pakFiles.find(p => p.name === DEFAULT_MAIN_PAK)
            || pakFiles[0];
          effectiveMain = preferred.relative_path;
        }
      }

      setSettings({ ...loaded, mainPakRelative: effectiveMain });
      await reloadProjectInspectors(fileList, loaded.selectedPlatform);

      if (effectiveMain) {
        try {
          const matchedPak = pakFiles.find(p => p.relative_path === effectiveMain);
          const mainPath = matchedPak ? matchedPak.path : `${cleanDirPath}/${effectiveMain}`;
          const content = await invoke<string>('read_text_file', { filePath: mainPath });
          const newTab: EditorTab = {
            id: mainPath,
            filePath: mainPath,
            title: effectiveMain.split('/').pop() || effectiveMain,
            content,
            isDirty: false
          };
          setTabs([newTab]);
          setActiveTabId(newTab.id);
        } catch (e) {
          console.warn('Could not auto-open main pak:', e);
        }
      }
    } catch (err) {
      console.error('Failed to open project at:', dirPath, err);
      localStorage.removeItem(STORAGE_KEYS.LAST_PROJECT_PATH);
      setProjectPath(null);
    } finally {
      setTimeout(() => {
        isLoadingProjectRef.current = false;
      }, 100);
    }
  }, [settings]);

  // Auto-restore last opened project on startup
  useEffect(() => {
    const lastProject = localStorage.getItem(STORAGE_KEYS.LAST_PROJECT_PATH);
    if (lastProject) {
      openProject(lastProject);
    }
  }, []);

  // Save global & project settings on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({
      javaPath: settings.javaPath,
      jarPath: settings.jarPath,
    }));

    if (projectPath && !isLoadingProjectRef.current) {
      const projectData = {
        selectedPlatform: settings.selectedPlatform,
        language: settings.language,
        mainPakRelative: settings.mainPakRelative,
        outputDirRelative: settings.outputDirRelative,
        emulatorCommand: settings.emulatorCommand,
        compilerArgs: settings.compilerArgs,
      };
      localStorage.setItem(
        `${STORAGE_KEYS.PROJECT_SETTINGS_PREFIX}${projectPath}`,
        JSON.stringify(projectData)
      );
    }
  }, [settings, projectPath]);

  // Query system information on mount or project change
  useEffect(() => {
    invoke<SystemInfo>('get_system_info', {
      projectDir: projectPath,
      customJava: settings.javaPath || null,
      customJar: settings.jarPath || null,
    }).then((info) => {
      setSystemInfo(info);
    }).catch(console.error);
  }, [projectPath, settings.javaPath, settings.jarPath]);

  // Refresh project files
  const refreshFiles = useCallback(async (dir: string) => {
    try {
      const fileList = await invoke<FileNode[]>('list_project_files', { projectPath: dir });
      setFiles(fileList);
      setInMemoryPakFiles({});
      await reloadProjectInspectors(fileList);

      // Auto-select main pak file if not selected
      const pakFiles = fileList.filter(f => f.extension.toLowerCase() === 'pak');
      if (pakFiles.length > 0) {
        setSettings(prev => {
          if (!prev.mainPakRelative || !pakFiles.some(p => p.relative_path === prev.mainPakRelative)) {
            // Prefer DEFAULT_MAIN_PAK
            const preferred = pakFiles.find(p => p.name === DEFAULT_MAIN_PAK && p.relative_path.startsWith(prev.selectedPlatform))
              || pakFiles.find(p => p.name === DEFAULT_MAIN_PAK)
              || pakFiles[0];
            return { ...prev, mainPakRelative: preferred.relative_path };
          }
          return prev;
        });
      }
    } catch (err) {
      console.error('Failed to list files:', err);
    }
  }, []);

  // Open Folder handler
  const handleOpenFolder = async () => {
    try {
      const selected = await invoke<string | null>('pick_folder');
      if (selected) {
        const hasSavedSettings = Boolean(localStorage.getItem(`${STORAGE_KEYS.PROJECT_SETTINGS_PREFIX}${selected}`));
        if (hasSavedSettings) {
          await openProject(selected);
        } else {
          setPendingOpenFolder(selected);
          setIsSelectPlatformModalOpen(true);
        }
      }
    } catch (err) {
      console.error('Failed to pick folder:', err);
    }
  };

  // Confirm Platform for a new folder without saved state
  const handleConfirmPlatformForFolder = async (platform: Platform) => {
    if (!pendingOpenFolder) return;
    const folder = pendingOpenFolder;
    setIsSelectPlatformModalOpen(false);
    setPendingOpenFolder(null);

    const initialProjectSettings = {
      selectedPlatform: platform,
      language: DEFAULT_LANGUAGE,
      mainPakRelative: DEFAULT_MAIN_PAK,
      outputDirRelative: '',
      emulatorCommand: DEFAULT_EMULATOR_COMMAND,
      compilerArgs: DEFAULT_COMPILER_ARGS,
    };
    localStorage.setItem(
      `${STORAGE_KEYS.PROJECT_SETTINGS_PREFIX}${folder}`,
      JSON.stringify(initialProjectSettings)
    );

    await openProject(folder, platform);
  };

  // Close Project handler
  const handleCloseProject = () => {
    localStorage.removeItem(STORAGE_KEYS.LAST_PROJECT_PATH);
    setProjectPath(null);
    setFiles([]);
    setTabs([]);
    setActiveTabId(null);
    setProblems([]);
    setLastCompileStatus(null);
    setProjectItems([]);
    setProjectObjects([]);
    setInMemoryPakFiles({});
    setConsoleOutput('Project closed.\n');
    setSettings(prev => ({ ...prev, mainPakRelative: '' }));
  };

  // Project Created handler
  const handleProjectCreated = async (newProjectPath: string, platform: Platform) => {
    const initialProjectSettings = {
      selectedPlatform: platform,
      language: DEFAULT_LANGUAGE,
      mainPakRelative: DEFAULT_MAIN_PAK,
      outputDirRelative: '',
      emulatorCommand: DEFAULT_EMULATOR_COMMAND,
      compilerArgs: DEFAULT_COMPILER_ARGS,
    };
    localStorage.setItem(
      `${STORAGE_KEYS.PROJECT_SETTINGS_PREFIX}${newProjectPath}`,
      JSON.stringify(initialProjectSettings)
    );

    await openProject(newProjectPath);
    setConsoleOutput(`Created new PAKET project for ${platform.toUpperCase()} at:\n${newProjectPath}\n`);
  };

  // Handle new file created
  const handleFileCreated = async (filePath: string, fileName: string) => {
    if (!projectPath) return;
    await refreshFiles(projectPath);

    try {
      const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : '';
      let content = '';
      if (!BINARY_EXTENSIONS.has(ext)) {
        content = await invoke<string>('read_text_file', { filePath });
      }

      const newTab: EditorTab = {
        id: filePath,
        filePath,
        title: fileName,
        content,
        isDirty: false,
        // Without a view type, a new PNG would open in the pixel editor but be saved as text.
        viewType: viewTypeForFileName(fileName)
      };

      setTabs(prev => {
        const exists = prev.some(t => t.filePath === filePath);
        if (exists) {
          return prev.map(t => t.filePath === filePath ? newTab : t);
        }
        return [...prev, newTab];
      });
      setActiveTabId(newTab.id);
      setConsoleOutput(prev => `${prev}\nCreated new file: ${fileName}\n`);
    } catch (err) {
      console.error('Failed to open newly created file:', err);
    }
  };

  // Handle renaming a file from Project Explorer
  const handleRenameFile = async (file: FileNode, newName: string) => {
    if (!projectPath) return;

    const normOldPath = normalizePath(file.path);
    const lastSlash = normOldPath.lastIndexOf('/');
    const parentDir = lastSlash !== -1 ? normOldPath.substring(0, lastSlash + 1) : '';
    const newPath = `${parentDir}${newName}`;

    await invoke('rename_file', { oldPath: file.path, newPath });

    const normFileRel = normalizePath(file.relative_path);
    const relSlash = normFileRel.lastIndexOf('/');
    const parentRel = relSlash !== -1 ? normFileRel.substring(0, relSlash + 1) : '';
    const newRelative = `${parentRel}${newName}`;

    let matchedOldTabId: string | null = null;

    // Update open tabs if the file was open
    setTabs(prev => prev.map(t => {
      const normTabPath = normalizePath(t.filePath);
      const normTabId = normalizePath(t.id);
      const isMatch = normTabPath === normOldPath
        || normTabId === normOldPath
        || normTabPath.endsWith(`/${normFileRel}`)
        || normTabPath === normFileRel;

      if (isMatch) {
        matchedOldTabId = t.id;
        return {
          ...t,
          id: newPath,
          filePath: newPath,
          title: newName
        };
      }
      return t;
    }));

    // Update activeTabId if it pointed to this file
    setActiveTabId(prevActiveId => {
      if (!prevActiveId) return prevActiveId;
      const normActiveId = normalizePath(prevActiveId);
      if (
        normActiveId === normOldPath ||
        (matchedOldTabId && prevActiveId === matchedOldTabId) ||
        normActiveId.endsWith(`/${normFileRel}`) ||
        normActiveId === normFileRel
      ) {
        return newPath;
      }
      return prevActiveId;
    });

    // Update in-memory pak files if present
    setInMemoryPakFiles(prev => {
      const next = { ...prev };
      let changed = false;
      for (const [key, data] of Object.entries(prev)) {
        const normKey = normalizePath(key);
        if (normKey === normFileRel || normKey === normOldPath) {
          delete next[key];
          next[newRelative] = data;
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    // Update settings if mainPakRelative matches
    if (normalizePath(settings.mainPakRelative) === normFileRel) {
      setSettings(s => ({ ...s, mainPakRelative: newRelative }));
    }

    await refreshFiles(projectPath);
    setConsoleOutput(prev => `${prev}\nRenamed: ${file.name} -> ${newName}\n`);
  };

  // Handle deleting a file from Project Explorer
  const handleDeleteFile = async (file: FileNode) => {
    if (!projectPath) return;

    const normOldPath = normalizePath(file.path);
    const normFileRel = normalizePath(file.relative_path);

    await invoke('delete_file', { filePath: file.path });

    // Close tab if open and select remaining tab if active tab was closed
    setTabs(prev => {
      const remaining = prev.filter(t => {
        const normTabPath = normalizePath(t.filePath);
        const normTabId = normalizePath(t.id);
        const isMatch = normTabPath === normOldPath
          || normTabId === normOldPath
          || normTabPath.endsWith(`/${normFileRel}`)
          || normTabPath === normFileRel;
        return !isMatch;
      });

      setActiveTabId(prevActiveId => {
        if (!prevActiveId) return null;
        const normActiveId = normalizePath(prevActiveId);
        if (
          normActiveId === normOldPath ||
          normActiveId.endsWith(`/${normFileRel}`) ||
          normActiveId === normFileRel
        ) {
          return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
        }
        return prevActiveId;
      });

      return remaining;
    });

    // Remove from inMemoryPakFiles
    setInMemoryPakFiles(prev => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(prev)) {
        const normKey = normalizePath(key);
        if (normKey === normFileRel || normKey === normOldPath) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    if (normalizePath(settings.mainPakRelative) === normFileRel) {
      setSettings(s => ({ ...s, mainPakRelative: '' }));
    }

    await refreshFiles(projectPath);
    setConsoleOutput(prev => `${prev}\nDeleted file: ${file.name}\n`);
  };

  // Open a file into a tab
  const handleFileSelect = async (file: FileNode) => {
    // Check if already open
    const existing = tabs.find(t => isSamePath(t.filePath, file.path) || isSamePath(t.id, file.path));
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    try {
      // Binary / image files
      const ext = file.extension.toLowerCase();
      let content = '';
      let isDirty = false;
      // A .pak the panels have edited but not saved opens with those edits, so the tab stays the newest copy.
      const panelCopy = ext === 'pak' ? inMemoryPakFiles[file.relative_path] : undefined;
      if (panelCopy?.isDirty) {
        content = panelCopy.content;
        isDirty = true;
      } else if (!BINARY_EXTENSIONS.has(ext)) {
        content = await invoke<string>('read_text_file', { filePath: file.path });
      }

      const newTab: EditorTab = {
        id: file.path,
        filePath: file.path,
        title: file.name,
        content,
        isDirty,
        viewType: viewTypeForFileName(file.name)
      };

      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
    } catch (err) {
      console.error(`Failed to read file ${file.path}:`, err);
    }
  };

  // Open Item Inspector tab
  const handleOpenItemInspector = () => {
    const tabId = 'special:items';
    const existing = tabs.find(t => t.id === tabId);
    if (existing) {
      setActiveTabId(tabId);
      return;
    }

    const newTab: EditorTab = {
      id: tabId,
      filePath: 'special:items',
      title: 'Items',
      content: '',
      isDirty: false,
      viewType: 'items'
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
  };

  // Open Object Inspector tab
  const handleOpenObjectInspector = () => {
    const tabId = 'special:objects';
    const existing = tabs.find(t => t.id === tabId);
    if (existing) {
      setActiveTabId(tabId);
      return;
    }

    const newTab: EditorTab = {
      id: tabId,
      filePath: 'special:objects',
      title: 'Objects',
      content: '',
      isDirty: false,
      viewType: 'objects'
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
  };

  // Open Room Inspector tab
  const handleOpenRoomInspector = () => {
    const tabId = 'special:rooms';
    const existing = tabs.find(t => t.id === tabId);
    if (existing) {
      setActiveTabId(tabId);
      return;
    }

    const newTab: EditorTab = {
      id: tabId,
      filePath: 'special:rooms',
      title: 'Rooms',
      content: '',
      isDirty: false,
      viewType: 'rooms'
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);
  };

  // Jump from inspector to line in code editor
  const handleOpenCodeAtLine = async (relPath: string, line: number) => {
    if (!projectPath) return;
    const fullPath = relPath.startsWith('/') ? relPath : `${projectPath}/${relPath}`;
    const title = relPath.split('/').pop() || relPath;

    const existing = tabs.find(t => isSamePath(t.filePath, fullPath) || isSamePath(t.filePath, relPath) || t.filePath.endsWith(relPath));
    if (existing) {
      setActiveTabId(existing.id);
      setTabs(prev => prev.map(t =>
        t.id === existing.id
          ? { ...t, targetLine: line, viewType: 'code' }
          : { ...t, targetLine: undefined }
      ));
    } else {
      try {
        const content = await invoke<string>('read_text_file', { filePath: fullPath });
        const newTab: EditorTab = {
          id: fullPath,
          filePath: fullPath,
          title,
          content,
          isDirty: false,
          targetLine: line,
          viewType: 'code'
        };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newTab.id);
      } catch (err) {
        console.error(`Failed to open ${fullPath}:`, err);
      }
    }
  };

  // Tab content change
  const handleContentChange = (newContent: string) => {
    setTabs(prev => prev.map(tab => {
      if (tab.id === activeTabId) {
        return { ...tab, content: newContent, isDirty: true };
      }
      return tab;
    }));

    const currentTab = tabs.find(t => t.id === activeTabId);
    if (currentTab && currentTab.filePath.toLowerCase().endsWith('.pak')) {
      const parsedPal = parseCustomPaletteFromContent(newContent, settings.selectedPlatform);
      if (parsedPal) {
        const defaultPal = getPlatformPalette(settings.selectedPlatform);
        const fullColors: PaletteColor[] = parsedPal.colors.map((c, idx) => ({
          index: idx,
          name: defaultPal[idx]?.name || `Color ${idx}`,
          hex: rgbToHex(c.r, c.g, c.b),
          r: c.r,
          g: c.g,
          b: c.b,
          isTransparent: defaultPal[idx]?.isTransparent ?? false,
        }));
        setProjectPalette(fullColors);
        if (parsedPal.tolerance !== undefined) {
          setProjectPaletteTolerance(parsedPal.tolerance);
        }
        setCustomPaletteSourceFile(currentTab.filePath);
      } else if (customPaletteSourceFile && isMatchingFilePath(customPaletteSourceFile, currentTab.filePath)) {
        setProjectPalette(getPlatformPalette(settings.selectedPlatform));
        setProjectPaletteTolerance(getPlatformDefaultTolerance(settings.selectedPlatform));
        setCustomPaletteSourceFile(null);
      }
    }
  };

  // Read the newest text of a .pak file: its open tab, else the panels' copy, else the file on disk
  const getPakContentInMemory = useCallback(async (relPath: string): Promise<string> => {
    const inEditor = latestPakContent(relPath, inMemoryPakFiles, tabs);
    if (inEditor !== undefined) {
      return inEditor;
    }
    if (!projectPath) return '';
    const fullPath = relPath.startsWith('/') ? relPath : `${projectPath}/${relPath}`;
    return await invoke<string>('read_text_file', { filePath: fullPath });
  }, [inMemoryPakFiles, tabs, projectPath]);

  // Transfer item edit to in-memory .pak file and update in-memory items
  const handleTransferItemToMemory = useCallback(async (relPath: string, updatedItem: PakItem, targetId: string) => {
    const currentContent = await getPakContentInMemory(relPath);
    const newContent = updateItemInContent(currentContent, updatedItem, targetId);

    setInMemoryPakFiles(prev => ({
      ...prev,
      [relPath]: { content: newContent, isDirty: true }
    }));

    setTabs(prev => prev.map(t => {
      if (isSameProjectFile(t.filePath, relPath)) {
        return { ...t, content: newContent, isDirty: true };
      }
      if (t.id === 'special:items') {
        return { ...t, isDirty: true };
      }
      return t;
    }));

    const { items: newItems } = parsePakFile(newContent, relPath);
    setProjectItems(prev => {
      const others = prev.filter(it => it.filePath !== relPath);
      return [...others, ...newItems];
    });
  }, [getPakContentInMemory]);

  // Delete item from in-memory .pak file
  const handleDeleteItemFromMemory = useCallback(async (relPath: string, targetId: string) => {
    const currentContent = await getPakContentInMemory(relPath);
    const newContent = deleteItemFromContent(currentContent, targetId, relPath);

    setInMemoryPakFiles(prev => ({
      ...prev,
      [relPath]: { content: newContent, isDirty: true }
    }));

    setTabs(prev => prev.map(t => {
      if (isSameProjectFile(t.filePath, relPath)) {
        return { ...t, content: newContent, isDirty: true };
      }
      if (t.id === 'special:items') {
        return { ...t, isDirty: true };
      }
      return t;
    }));

    const { items: newItems } = parsePakFile(newContent, relPath);
    setProjectItems(prev => {
      const others = prev.filter(it => it.filePath !== relPath);
      return [...others, ...newItems];
    });
  }, [getPakContentInMemory]);

  // Create new item in in-memory .pak file
  const handleCreateItemInMemory = useCallback(async (relPath: string, newItem: PakItem) => {
    const currentContent = await getPakContentInMemory(relPath);
    const newContent = insertItemIntoContent(currentContent, newItem);

    setInMemoryPakFiles(prev => ({
      ...prev,
      [relPath]: { content: newContent, isDirty: true }
    }));

    setTabs(prev => prev.map(t => {
      if (isSameProjectFile(t.filePath, relPath)) {
        return { ...t, content: newContent, isDirty: true };
      }
      if (t.id === 'special:items') {
        return { ...t, isDirty: true };
      }
      return t;
    }));

    const { items: newItems } = parsePakFile(newContent, relPath);
    setProjectItems(prev => {
      const others = prev.filter(it => it.filePath !== relPath);
      return [...others, ...newItems];
    });
  }, [getPakContentInMemory]);

  // Transfer object edit to in-memory .pak file and update in-memory objects
  const handleTransferObjectToMemory = useCallback(async (relPath: string, updatedObj: PakObject, targetId: string) => {
    const currentContent = await getPakContentInMemory(relPath);
    const newContent = updateObjectInContent(currentContent, updatedObj, targetId);

    setInMemoryPakFiles(prev => ({
      ...prev,
      [relPath]: { content: newContent, isDirty: true }
    }));

    setTabs(prev => prev.map(t => {
      if (isSameProjectFile(t.filePath, relPath)) {
        return { ...t, content: newContent, isDirty: true };
      }
      if (t.id === 'special:objects') {
        return { ...t, isDirty: true };
      }
      return t;
    }));

    const { objects: newObjects } = parsePakFile(newContent, relPath);
    setProjectObjects(prev => {
      const others = prev.filter(o => o.filePath !== relPath);
      return [...others, ...newObjects];
    });
  }, [getPakContentInMemory]);

  // Delete object from in-memory .pak file
  const handleDeleteObjectFromMemory = useCallback(async (relPath: string, targetId: string) => {
    const currentContent = await getPakContentInMemory(relPath);
    const newContent = deleteObjectFromContent(currentContent, targetId, relPath);

    setInMemoryPakFiles(prev => ({
      ...prev,
      [relPath]: { content: newContent, isDirty: true }
    }));

    setTabs(prev => prev.map(t => {
      if (isSameProjectFile(t.filePath, relPath)) {
        return { ...t, content: newContent, isDirty: true };
      }
      if (t.id === 'special:objects') {
        return { ...t, isDirty: true };
      }
      return t;
    }));

    const { objects: newObjects } = parsePakFile(newContent, relPath);
    setProjectObjects(prev => {
      const others = prev.filter(o => o.filePath !== relPath);
      return [...others, ...newObjects];
    });
  }, [getPakContentInMemory]);

  // Create new object in in-memory .pak file
  const handleCreateObjectInMemory = useCallback(async (relPath: string, newObj: PakObject) => {
    const currentContent = await getPakContentInMemory(relPath);
    const newContent = insertObjectIntoContent(currentContent, newObj);

    setInMemoryPakFiles(prev => ({
      ...prev,
      [relPath]: { content: newContent, isDirty: true }
    }));

    setTabs(prev => prev.map(t => {
      if (isSameProjectFile(t.filePath, relPath)) {
        return { ...t, content: newContent, isDirty: true };
      }
      if (t.id === 'special:objects') {
        return { ...t, isDirty: true };
      }
      return t;
    }));

    const { objects: newObjects } = parsePakFile(newContent, relPath);
    setProjectObjects(prev => {
      const others = prev.filter(o => o.filePath !== relPath);
      return [...others, ...newObjects];
    });
  }, [getPakContentInMemory]);

  // Transfer room edit to in-memory .pak file and update in-memory rooms
  const handleTransferRoomToMemory = useCallback(async (relPath: string, updatedRoom: PakRoom, targetId: string) => {
    const currentContent = await getPakContentInMemory(relPath);
    const newContent = updateRoomInContent(currentContent, updatedRoom, targetId);

    setInMemoryPakFiles(prev => ({
      ...prev,
      [relPath]: { content: newContent, isDirty: true }
    }));

    setTabs(prev => prev.map(t => {
      if (isSameProjectFile(t.filePath, relPath)) {
        return { ...t, content: newContent, isDirty: true };
      }
      if (t.id === 'special:rooms') {
        return { ...t, isDirty: true };
      }
      return t;
    }));

    const { rooms: newRooms } = parsePakFile(newContent, relPath);
    setProjectRooms(prev => {
      const others = prev.filter(r => r.filePath !== relPath);
      return [...others, ...newRooms];
    });
  }, [getPakContentInMemory]);

  // Delete room from in-memory .pak file
  const handleDeleteRoomFromMemory = useCallback(async (relPath: string, targetId: string) => {
    const currentContent = await getPakContentInMemory(relPath);
    const newContent = deleteRoomFromContent(currentContent, targetId, relPath);

    setInMemoryPakFiles(prev => ({
      ...prev,
      [relPath]: { content: newContent, isDirty: true }
    }));

    setTabs(prev => prev.map(t => {
      if (isSameProjectFile(t.filePath, relPath)) {
        return { ...t, content: newContent, isDirty: true };
      }
      if (t.id === 'special:rooms') {
        return { ...t, isDirty: true };
      }
      return t;
    }));

    const { rooms: newRooms } = parsePakFile(newContent, relPath);
    setProjectRooms(prev => {
      const others = prev.filter(r => r.filePath !== relPath);
      return [...others, ...newRooms];
    });
  }, [getPakContentInMemory]);

  // Create new room in in-memory .pak file and optionally starter .tmx
  const handleCreateRoomInMemory = useCallback(async (relPath: string, newRoom: PakRoom, tmxContent?: string) => {
    if (tmxContent && projectPath) {
      const tmxFullPath = `${projectPath}/${newRoom.tmxFile}`;
      try {
        await invoke('write_text_file', { filePath: tmxFullPath, content: tmxContent });
        await refreshFiles(projectPath);
      } catch (err) {
        console.error('Failed to create initial TMX file:', err);
      }
    }

    const currentContent = await getPakContentInMemory(relPath);
    const newContent = insertRoomIntoContent(currentContent, newRoom);

    setInMemoryPakFiles(prev => ({
      ...prev,
      [relPath]: { content: newContent, isDirty: true }
    }));

    setTabs(prev => prev.map(t => {
      if (isSameProjectFile(t.filePath, relPath)) {
        return { ...t, content: newContent, isDirty: true };
      }
      if (t.id === 'special:rooms') {
        return { ...t, isDirty: true };
      }
      return t;
    }));

    const { rooms: newRooms } = parsePakFile(newContent, relPath);
    setProjectRooms(prev => {
      const others = prev.filter(r => r.filePath !== relPath);
      return [...others, ...newRooms];
    });
  }, [getPakContentInMemory, projectPath, refreshFiles]);

  // Save all dirty in-memory files and tabs to disk
  const handleSaveAllDirtyFiles = useCallback(async () => {
    if (!projectPath) return;

    const unsavedCopies: string[] = [];
    for (const [relPath, fileData] of Object.entries(inMemoryPakFiles)) {
      if (fileData.isDirty) {
        const fullPath = relPath.startsWith('/') ? relPath : `${projectPath}/${relPath}`;
        try {
          await invoke('write_text_file', { filePath: fullPath, content: fileData.content });
          setConsoleOutput(prev => prev + `Saved: ${relPath}\n`);
        } catch (err) {
          console.error(`Failed to save ${relPath}:`, err);
          unsavedCopies.push(relPath);
        }
      }
    }

    const savedTextTabs: Array<{ filePath: string; content: string }> = [];
    for (const tab of tabs) {
      if (tab.isDirty && !tab.filePath.startsWith('special:')) {
        try {
          if (tab.viewType === 'image') {
            await invoke('write_file_base64', { filePath: tab.filePath, base64Data: tab.content });
          } else {
            await invoke('write_text_file', { filePath: tab.filePath, content: tab.content });
            savedTextTabs.push({ filePath: tab.filePath, content: tab.content });
          }
          setConsoleOutput(prev => prev + `Saved: ${tab.title}\n`);
        } catch (err) {
          console.error(`Failed to save ${tab.title}:`, err);
        }
      }
    }

    // A tab saved after the panels' copy of the same file holds newer text: the copy takes that
    // text, so a later panel edit doesn't start from (and save) older text.
    setInMemoryPakFiles(prev => copiesAfterSavingAll(prev, savedTextTabs, unsavedCopies));

    setTabs(prev => prev.map(t => ({ ...t, isDirty: false })));
  }, [projectPath, inMemoryPakFiles, tabs]);

  const hasDirtyPakFiles = useMemo(() => {
    return Object.values(inMemoryPakFiles).some(f => f.isDirty);
  }, [inMemoryPakFiles]);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const inspectorSaveHandlerRef = useRef<(() => Promise<void>) | null>(null);

  const handleRegisterInspectorSave = useCallback((handler: () => Promise<void>) => {
    inspectorSaveHandlerRef.current = handler;
  }, []);

  // Save current active tab
  const handleSaveActiveTab = useCallback(async () => {
    const currentTabs = tabsRef.current;
    const currentActiveId = activeTabIdRef.current;
    const current = currentTabs.find(t => t.id === currentActiveId);
    if (!current) return;

    if (current.id === 'special:items' || current.id === 'special:objects' || current.id === 'special:rooms') {
      if (inspectorSaveHandlerRef.current) {
        await inspectorSaveHandlerRef.current();
      } else {
        await handleSaveAllDirtyFiles();
      }
      return;
    }

    try {
      if (current.viewType === 'image') {
        await invoke('write_file_base64', {
          filePath: current.filePath,
          base64Data: current.content
        });
      } else {
        await invoke('write_text_file', {
          filePath: current.filePath,
          content: current.content
        });
      }

      setTabs(prev => prev.map(t => (t.id === current.id ? { ...t, isDirty: false } : t)));
      setConsoleOutput(prev => prev + `Saved: ${current.title}\n`);

      // If a .pak file was saved in Monaco, the panels' copy of it is now older than the file:
      // replace it with the saved text so the next panel edit starts from it, and reload the inspectors.
      if (current.filePath.toLowerCase().endsWith('.pak')) {
        setInMemoryPakFiles(prev => copiesAfterTextSave(prev, current.filePath, current.content));
        reloadProjectInspectors(files);
      }
    } catch (err) {
      console.error('Failed to save file:', err);
      setConsoleOutput(prev => prev + `Error saving ${current.title}: ${err}\n`);
    }
  }, [handleSaveAllDirtyFiles, files, reloadProjectInspectors]);

  // Apply changes from Palette Manager and save to .pak file
  const handleApplyPalette = useCallback(async (newPalette: PaletteColor[], newTolerance: number) => {
    if (!projectPath) return;

    let targetRelPath = customPaletteSourceFile;
    if (!targetRelPath) {
      if (settings.mainPakRelative) {
        targetRelPath = settings.mainPakRelative;
      } else {
        const firstPak = files.find(f => f.extension.toLowerCase() === 'pak' && !f.is_dir);
        if (firstPak) {
          targetRelPath = firstPak.relative_path;
        }
      }
    }

    if (!targetRelPath) {
      setProjectPalette(newPalette);
      setProjectPaletteTolerance(newTolerance);
      setIsPaletteManagerOpen(false);
      return;
    }

    try {
      const currentContent = await getPakContentInMemory(targetRelPath);
      const newContent = updateCustomPaletteInContent(
        currentContent,
        settings.selectedPlatform,
        newPalette,
        newTolerance
      );

      const fullPath = targetRelPath.startsWith('/') ? targetRelPath : `${projectPath}/${targetRelPath}`;
      await invoke('write_text_file', { filePath: fullPath, content: newContent });

      setInMemoryPakFiles(prev => ({
        ...prev,
        [targetRelPath!]: { content: newContent, isDirty: false }
      }));

      setTabs(prev => prev.map(t => {
        if (isMatchingFilePath(t.filePath, targetRelPath!)) {
          return { ...t, content: newContent, isDirty: false };
        }
        return t;
      }));

      setProjectPalette(newPalette);
      setProjectPaletteTolerance(newTolerance);
      setCustomPaletteSourceFile(targetRelPath);
      setIsPaletteManagerOpen(false);
      setConsoleOutput(prev => prev + `Applied custom palette to ${targetRelPath}\n`);
    } catch (err) {
      console.error('Failed to apply palette:', err);
      setConsoleOutput(prev => prev + `Error applying palette: ${err}\n`);
    }
  }, [projectPath, customPaletteSourceFile, settings.mainPakRelative, settings.selectedPlatform, files, getPakContentInMemory]);

  // Reset palette to platform default and remove custom definition from .pak if present
  const handleResetPaletteToDefault = useCallback(async () => {
    if (customPaletteSourceFile && projectPath) {
      const targetRelPath = customPaletteSourceFile;
      try {
        const currentContent = await getPakContentInMemory(targetRelPath);
        const newContent = removeCustomPaletteFromContent(currentContent);
        const fullPath = targetRelPath.startsWith('/') ? targetRelPath : `${projectPath}/${targetRelPath}`;
        await invoke('write_text_file', { filePath: fullPath, content: newContent });

        setInMemoryPakFiles(prev => ({
          ...prev,
          [targetRelPath]: { content: newContent, isDirty: false }
        }));

        setTabs(prev => prev.map(t => {
          if (isMatchingFilePath(t.filePath, targetRelPath)) {
            return { ...t, content: newContent, isDirty: false };
          }
          return t;
        }));

        setConsoleOutput(prev => prev + `Removed custom palette from ${targetRelPath}\n`);
      } catch (err) {
        console.error('Failed to reset custom palette:', err);
      }
    }

    setProjectPalette(getPlatformPalette(settings.selectedPlatform));
    setProjectPaletteTolerance(getPlatformDefaultTolerance(settings.selectedPlatform));
    setCustomPaletteSourceFile(null);
    setIsPaletteManagerOpen(false);
    setConsoleOutput(prev => prev + `Reset palette to ${settings.selectedPlatform.toUpperCase()} defaults\n`);
  }, [customPaletteSourceFile, projectPath, settings.selectedPlatform, getPakContentInMemory]);

  // Open an image file into a tab by filename or path
  const handleOpenImageFile = useCallback((fileName: string) => {
    if (!projectPath || !fileName) return;
    const clean = fileName.trim().toLowerCase();
    const matched = files.find(f => f.name.toLowerCase() === clean || f.relative_path.toLowerCase() === clean);
    if (matched) {
      handleFileSelect(matched);
    } else {
      const fallback = files.find(f => f.relative_path.toLowerCase().endsWith(clean));
      if (fallback) {
        handleFileSelect(fallback);
      }
    }
  }, [projectPath, files]);

  // Close tab
  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const remaining = tabs.filter(t => t.id !== id);
    setTabs(remaining);

    if (activeTabId === id) {
      setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  };

  // Kill running compilation
  const handleKillCompile = async () => {
    if (!isCompiling) return;
    try {
      await invoke('kill_compile');
      setConsoleOutput(prev => prev + '\n\x1b[33m⏹ [PAKET Studio] Compilation stopped by user.\x1b[0m\n');
    } catch (err) {
      console.error('Failed to kill compiler:', err);
    } finally {
      setIsCompiling(false);
    }
  };

  // Compile project
  const handleCompile = async () => {
    if (!projectPath || isCompiling) return;

    // Clear previous line highlights
    setTabs(prev => prev.map(t => ({ ...t, targetLine: undefined })));

    // 1. Save all dirty in-memory files and tabs before compiling
    await handleSaveAllDirtyFiles();

    setIsCompiling(true);
    setBottomConsoleTab('console');
    setIsBottomConsoleCollapsed(false);
    const mainPak = settings.mainPakRelative || DEFAULT_MAIN_PAK;
    const outputDir = settings.outputDirRelative || DEFAULT_OUTPUT_DIR;

    setConsoleOutput(`[PAKET Studio] Starting compilation...\n`);
    setConsoleOutput(prev => prev + `Target Platform: ${settings.selectedPlatform} | Language: ${settings.language}\n`);
    setConsoleOutput(prev => prev + `Source: ${mainPak} -> Destination: ${outputDir}\n\n`);

    const onOutput = new Channel<string>();
    onOutput.onmessage = (message) => {
      setConsoleOutput(prev => prev + message + '\n');
    };

    try {
      const res = await invoke<CompileResponse>('compile_game', {
        onOutput,
        projectDir: projectPath,
        mainPak,
        platform: settings.selectedPlatform,
        language: settings.language,
        outputDir,
        compilerArgs: settings.compilerArgs || DEFAULT_COMPILER_ARGS,
        javaPath: settings.javaPath || null,
        jarPath: settings.jarPath || null,
      });

      setProblems(res.problems);
      setLastCompileStatus(res.success);

      if (res.success) {
        setConsoleOutput(prev => prev + `\n\x1b[32m✔ BUILD SUCCESSFUL!\x1b[0m\n`);
        setProblems([]);
        setTabs(prev => prev.map(t => ({ ...t, targetLine: undefined })));
        await refreshFiles(projectPath);
      } else if (res.problems.some(p => p.message.includes('cancelled') || p.message.includes('stopped'))) {
        setConsoleOutput(prev => prev + `\n\x1b[33m⏹ BUILD CANCELLED.\x1b[0m\n`);
        setProblems([]);
      } else {
        const errWord = res.problems.length === 1 ? 'error' : 'errors';
        setConsoleOutput(prev => prev + `\n\x1b[31m✖ BUILD FAILED with ${res.problems.length} ${errWord}.\x1b[0m\n`);
      }
    } catch (err: any) {
      setLastCompileStatus(false);
      const errMsg = typeof err === 'string' ? err : JSON.stringify(err);
      setConsoleOutput(prev => prev + `\n✖ COMPILER EXECUTION ERROR:\n${errMsg}\n`);
      setProblems([{ message: errMsg, raw: errMsg }]);
    } finally {
      setIsCompiling(false);
    }
  };

  // Run Emulator
  const handleRunEmulator = async () => {
    if (!projectPath) return;

    // Ensure bottom console is open and visible
    setBottomConsoleTab('console');
    setIsBottomConsoleCollapsed(false);

    // Find compiled target binary in output dir
    const outDir = settings.outputDirRelative || DEFAULT_OUTPUT_DIR;
    const fullOutDir = `${projectPath}/${outDir}`;
    const filename = getTargetBinaryFilename(settings.selectedPlatform, settings.language, settings.targetFormat);
    const targetFile = `${fullOutDir}/${filename}`;

    setConsoleOutput(prev => prev + `[PAKET Studio] Launching emulator for: ${targetFile}...\n`);

    try {
      const res = await invoke<string>('run_emulator', {
        emulatorCmd: settings.emulatorCommand,
        workingDir: projectPath,
        targetFile,
      });
      setConsoleOutput(prev => prev + `${res}\n`);
    } catch (err) {
      setConsoleOutput(prev => prev + `Emulator launch error: ${err}\n`);
    }
  };

  // Jump to error line in Monaco
  const handleProblemClick = async (file?: string, line?: number) => {
    if (!file || !projectPath) return;

    // Resolve file path
    let fullPath = file;
    if (!file.startsWith('/')) {
      fullPath = `${projectPath}/${file}`;
    }

    // Find or open tab
    let existingTab = tabs.find(t => t.filePath === fullPath || t.filePath.endsWith(file));
    if (!existingTab) {
      try {
        const content = await invoke<string>('read_text_file', { filePath: fullPath });
        const newTab: EditorTab = {
          id: fullPath,
          filePath: fullPath,
          title: file.split(/[/\\]/).pop() || file,
          content,
          isDirty: false,
          targetLine: line,
        };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newTab.id);
        return;
      } catch (err) {
        console.error('Could not open file from error:', err);
        return;
      }
    }

    // If already open, set targetLine and focus
    setActiveTabId(existingTab.id);
    setTabs(prev => prev.map(t => (t.id === existingTab?.id ? { ...t, targetLine: line } : t)));
  };

  // Global keyboard shortcuts: Cmd/Ctrl+S (Save) and F5 (Compile)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveActiveTab();
      } else if (e.key === 'F5') {
        e.preventDefault();
        handleCompile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveActiveTab, handleCompile]);

  const pakFileOptions = files
    .filter(f => f.extension.toLowerCase() === 'pak')
    .map(f => f.relative_path);

  if (!isTauri()) {
    return (
      <div className="browser-blocked-container">
        <div className="browser-blocked-card">
          <img src="/paket-logo.png" width="64" alt="PAKET Logo" />
          <h2>Native Desktop App Required</h2>
          <p>
            PAKET Studio requires native filesystem access and subprocess execution (Java compiler, emulators).
            Running directly in a web browser is not supported.
          </p>
          <div className="terminal-instruction">
            <span className="instruction-label">To launch PAKET Studio desktop app:</span>
            <code>npm run tauri dev</code>
            <span className="instruction-sub">or launch the compiled native binary from your terminal.</span>
          </div>
        </div>
      </div>
    );
  }

  const activeTab = tabs.find(t => t.id === activeTabId) || null;

  return (
    <div className="app-shell">
      <Header
        projectPath={projectPath}
        onOpenFolder={handleOpenFolder}
        onNewProject={() => setIsNewProjectModalOpen(true)}
        onCloseProject={handleCloseProject}
        selectedPlatform={settings.selectedPlatform}
        onPlatformChange={(p: Platform) => {
          setSettings(s => ({ ...s, selectedPlatform: p }));
          reloadProjectInspectors(files, p);
        }}
        language={settings.language}
        onLanguageChange={(l: string) => setSettings(s => ({ ...s, language: l }))}
        outputDir={settings.outputDirRelative}
        onOutputDirChange={(d: string) => setSettings(s => ({ ...s, outputDirRelative: d }))}
        onCompile={handleCompile}
        onKillCompile={handleKillCompile}
        onRunEmulator={handleRunEmulator}
        onOpenPaletteManager={() => setIsPaletteManagerOpen(true)}
        onOpenSettings={() => {
          setBottomConsoleTab('settings');
          setIsBottomConsoleCollapsed(false);
        }}
        isCompiling={isCompiling}
        lastCompileStatus={lastCompileStatus}
        pakFiles={pakFileOptions}
        selectedMainPak={settings.mainPakRelative}
        onMainPakChange={(p: string) => setSettings(s => ({ ...s, mainPakRelative: p }))}
      />

      <div className="main-content-layout">
        <ProjectExplorer
          files={files}
          onFileSelect={handleFileSelect}
          activeFilePath={activeTab?.filePath}
          projectPath={projectPath}
          onOpenFolder={handleOpenFolder}
          onNewProject={() => setIsNewProjectModalOpen(true)}
          onNewFile={() => setIsNewFileModalOpen(true)}
          onRenameFile={handleRenameFile}
          onDeleteFile={handleDeleteFile}
          itemsCount={projectItems.length}
          objectsCount={projectObjects.length}
          roomsCount={projectRooms.length}
          onOpenItemInspector={handleOpenItemInspector}
          onOpenObjectInspector={handleOpenObjectInspector}
          onOpenRoomInspector={handleOpenRoomInspector}
          width={explorerWidth}
        />

        <div
          className="resizer-vertical"
          onMouseDown={handleExplorerResizeStart}
          title="Drag to resize Project Explorer"
        />

        <main className="editor-workspace">
          <WorkspaceTabs
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={setActiveTabId}
            onCloseTab={handleCloseTab}
          />

          <div className="workspace-pane">
            {activeTab?.viewType === 'items' && projectPath ? (
              <ItemInspector
                items={projectItems}
                projectPath={projectPath}
                files={files}
                onOpenCodeAtLine={handleOpenCodeAtLine}
                onTransferToMemory={handleTransferItemToMemory}
                onDeleteItemFromMemory={handleDeleteItemFromMemory}
                onCreateItemInMemory={handleCreateItemInMemory}
                onSaveAll={handleSaveAllDirtyFiles}
                hasUnsavedChanges={hasDirtyPakFiles}
                onOpenImageFile={handleOpenImageFile}
                onRegisterSaveHandler={handleRegisterInspectorSave}
              />
            ) : activeTab?.viewType === 'objects' && projectPath ? (
              <ObjectInspector
                objects={projectObjects}
                projectPath={projectPath}
                files={files}
                onOpenCodeAtLine={handleOpenCodeAtLine}
                onTransferToMemory={handleTransferObjectToMemory}
                onDeleteObjectFromMemory={handleDeleteObjectFromMemory}
                onCreateObjectInMemory={handleCreateObjectInMemory}
                onSaveAll={handleSaveAllDirtyFiles}
                hasUnsavedChanges={hasDirtyPakFiles}
                onOpenImageFile={handleOpenImageFile}
                onRegisterSaveHandler={handleRegisterInspectorSave}
              />
            ) : activeTab?.viewType === 'rooms' && projectPath ? (
              <RoomInspector
                rooms={projectRooms}
                projectPath={projectPath}
                files={files}
                projectObjects={projectObjects}
                platform={settings.selectedPlatform}
                inMemoryPakFiles={inMemoryPakFiles}
                onOpenCodeAtLine={handleOpenCodeAtLine}
                onTransferToMemory={handleTransferRoomToMemory}
                onDeleteRoomFromMemory={handleDeleteRoomFromMemory}
                onCreateRoomInMemory={handleCreateRoomInMemory}
                onSaveAll={handleSaveAllDirtyFiles}
                hasUnsavedChanges={hasDirtyPakFiles}
                onRegisterSaveHandler={handleRegisterInspectorSave}
                onOpenTmxFile={(tmxName) => {
                  const matched = files.find(f => f.name.toLowerCase() === tmxName.toLowerCase());
                  if (matched) handleFileSelect(matched);
                }}
              />
            ) : (
              <MonacoEditorPane
                activeTab={activeTab}
                platform={settings.selectedPlatform}
                palette={projectPalette}
                tolerance={projectPaletteTolerance}
                onOpenPaletteManager={() => setIsPaletteManagerOpen(true)}
                onLogToConsole={(msg: string) => setConsoleOutput(prev => prev + msg)}
                onContentChange={handleContentChange}
                onSave={handleSaveActiveTab}
                onCompile={handleCompile}
                onNewProject={() => setIsNewProjectModalOpen(true)}
                onOpenFolder={handleOpenFolder}
                hasProject={Boolean(projectPath)}
              />
            )}
          </div>

          <BottomConsole
            consoleOutput={consoleOutput}
            problems={problems}
            isCompiling={isCompiling}
            onKillCompile={handleKillCompile}
            onClearConsole={() => setConsoleOutput('')}
            onProblemClick={handleProblemClick}
            settings={settings}
            onUpdateSettings={(newSettings) => setSettings(s => ({ ...s, ...newSettings }))}
            systemInfo={systemInfo}
            height={consoleHeight}
            onResizeStart={handleConsoleResizeStart}
            projectPath={projectPath}
            activeTab={bottomConsoleTab}
            onTabChange={setBottomConsoleTab}
            isCollapsed={isBottomConsoleCollapsed}
            onToggleCollapse={setIsBottomConsoleCollapsed}
          />
        </main>
      </div>

      <NewProjectModal
        isOpen={isNewProjectModalOpen}
        onClose={() => setIsNewProjectModalOpen(false)}
        onProjectCreated={handleProjectCreated}
        defaultDestination={systemInfo.default_project_dir || projectPath || ''}
      />

      {projectPath && (
        <NewFileModal
          isOpen={isNewFileModalOpen}
          onClose={() => setIsNewFileModalOpen(false)}
          projectPath={projectPath}
          existingFiles={files}
          onFileCreated={handleFileCreated}
        />
      )}

      <SelectPlatformModal
        isOpen={isSelectPlatformModalOpen}
        folderPath={pendingOpenFolder || ''}
        onConfirm={handleConfirmPlatformForFolder}
        onCancel={() => {
          setIsSelectPlatformModalOpen(false);
          setPendingOpenFolder(null);
        }}
      />

      <PaletteManagerModal
        isOpen={isPaletteManagerOpen}
        onClose={() => setIsPaletteManagerOpen(false)}
        platform={settings.selectedPlatform}
        palette={projectPalette}
        tolerance={projectPaletteTolerance}
        isCustomPalette={Boolean(customPaletteSourceFile)}
        onApplyPalette={handleApplyPalette}
        onResetToDefault={handleResetPaletteToDefault}
      />
    </div>
  );
};

export default App;
