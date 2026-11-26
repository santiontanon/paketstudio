export type Platform = 'cpc' | 'cpc6128' | 'msx' | 'msxmegarom' | 'msx-wt';

export interface FileNode {
  name: string;
  path: string;
  relative_path: string;
  is_dir: boolean;
  extension: string;
  size: number;
}

export interface CompilerProblem {
  message: string;
  file?: string;
  line?: number;
  raw: string;
}

export interface CompileResponse {
  success: boolean;
  exit_code?: number;
  stdout: string;
  stderr: string;
  problems: CompilerProblem[];
  java_used: string;
  jar_used: string;
  output_dir: string;
}

export interface SystemInfo {
  detected_java?: string;
  detected_jar?: string;
  detected_jar_version?: string;
  default_project_dir?: string;
}

export type TabViewType = 'code' | 'image' | 'items' | 'objects' | 'rooms';

export interface EditorTab {
  id: string;
  filePath: string;
  title: string;
  content: string;
  isDirty: boolean;
  targetLine?: number;
  viewType?: TabViewType;
}

export interface PakImageRef {
  file: string;
  x1: number;
  y1: number;
  x2?: number;
  y2?: number;
}

export interface PakAnimationRef {
  speed: number;
  /** The order frames are played in, as indices into `frames` (animation(speed, ...sequence)). */
  sequence?: number[];
  frames: PakImageRef[];
}

export interface PakItem {
  id: string;
  name: string;
  description: string;
  image?: PakImageRef;
  defaultUseMessage?: string;
  rules: string[];
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface PakObjectState {
  name: string;
  direction: string;
  image?: PakImageRef;
  animation?: PakAnimationRef;
  collisionMask?: string[];
  selectionType?: 'pixel' | 'box' | 'none';
  rules: string[];
  /**
   * The state's lines exactly as read from the .pak file, including blank and comment lines just
   * before it. Saving rewrites only the directives that changed; states without one are generated.
   */
  source?: string[];
}

export interface PakObject {
  id: string;
  name: string;
  description: string;
  states: PakObjectState[];
  rules: string[];
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface PakRoom {
  id: string;
  tmxFile: string;
  x: number;
  y: number;
  subroom?: boolean;
  /** Header flags other than `subroom` (e.g. `lock-player-zoom-75`), kept so a rewritten header doesn't drop them. */
  otherFlags?: string[];
  rules: string[];
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface TmxObject {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth?: number;
  direction?: string;
  state?: string;
  rawProperties?: Record<string, string>;
}

export interface TmxTileset {
  firstgid: number;
  name: string;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  image: {
    source: string;
    width: number;
    height: number;
  };
  /** Set for an external tileset: the .tsx path exactly as written in the .tmx. */
  externalSource?: string;
}

export interface TmxLayer {
  name: string;
  width: number;
  height: number;
  data: number[];
  visible: boolean;
}

export interface TmxData {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  tilesets: TmxTileset[];
  layers: TmxLayer[];
  objects: TmxObject[];
}

export type TargetFormat = 'dsk' | 'cdt' | 'rom';

export interface ProjectSettings {
  javaPath: string;
  jarPath: string;
  selectedPlatform: Platform;
  language: string;
  mainPakRelative: string;
  outputDirRelative: string;
  emulatorCommand: string;
  compilerArgs: string;
  targetFormat?: TargetFormat;
}
