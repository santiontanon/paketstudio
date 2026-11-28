import type { Platform, TargetFormat } from './types';

export const DEFAULT_PROJECT_NAME = 'MyAdventure';
export const DEFAULT_PLATFORM: Platform = 'cpc';
export const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_MAIN_PAK = 'game.pak';
export const DEFAULT_OUTPUT_DIR = 'built';
export const DEFAULT_EMULATOR_COMMAND = 'open %FILE%';
export const DEFAULT_COMPILER_ARGS = '%MAIN% %PLATFORM% %LANG% %OUT%';

export const TARGET_FORMAT_DSK: TargetFormat = 'dsk';
export const TARGET_FORMAT_CDT: TargetFormat = 'cdt';
export const TARGET_FORMAT_ROM: TargetFormat = 'rom';

export const DEFAULT_CPC_TOLERANCE = 64;
export const DEFAULT_MSX_TOLERANCE = 32;
export const CPC_COLOR_COUNT = 27;
export const MSX_COLOR_COUNT = 16;

export function getEffectiveTargetFormat(platform: Platform, targetFormat?: TargetFormat): TargetFormat {
  if (platform.startsWith('msx')) {
    return TARGET_FORMAT_ROM;
  }
  return targetFormat === TARGET_FORMAT_CDT ? TARGET_FORMAT_CDT : TARGET_FORMAT_DSK;
}

export function getTargetBinaryFilename(platform: Platform, language: string, targetFormat?: TargetFormat): string {
  const ext = getEffectiveTargetFormat(platform, targetFormat);
  return `pac-${language}.${ext}`;
}

export const DEFAULT_EXPLORER_WIDTH = 250;
export const MIN_EXPLORER_WIDTH = 160;
export const MAX_EXPLORER_WIDTH = 600;

export const DEFAULT_CONSOLE_HEIGHT = 220;
export const MIN_CONSOLE_HEIGHT = 80;
export const MAX_CONSOLE_HEIGHT = 600;

export const TEMPLATE_CPC = 'cpc';
export const TEMPLATE_MSX = 'msx';
export const TEMPLATE_MSX_WT = 'msx-wt';

export const STORAGE_KEYS = {
  SETTINGS: 'paket_settings',
  EXPLORER_VIEW: 'paket_explorer_view',
  LAST_DESTINATION: 'paket_last_destination',
  LAST_PROJECT_PATH: 'paket_last_project_path',
  PROJECT_SETTINGS_PREFIX: 'paket_project_settings_',
  EXPLORER_WIDTH: 'paket_explorer_width',
  CONSOLE_HEIGHT: 'paket_console_height',
  INSPECTOR_SIDEBAR_WIDTH: 'paket_inspector_sidebar_width',
  PIXEL_GRID_PRESET: 'paket_pixel_grid_preset',
  PIXEL_GRID_CUSTOM_W: 'paket_pixel_grid_custom_w',
  PIXEL_GRID_CUSTOM_H: 'paket_pixel_grid_custom_h',
} as const;

export const DEFAULT_PIXEL_GRID_PRESET = '8x8';
export const DEFAULT_PIXEL_GRID_WIDTH = 8;
export const DEFAULT_PIXEL_GRID_HEIGHT = 8;
export const DEFAULT_MAX_HISTORY_STEPS = 30;

export const DEFAULT_INSPECTOR_SIDEBAR_WIDTH = 250;
export const MIN_INSPECTOR_SIDEBAR_WIDTH = 180;
export const MAX_INSPECTOR_SIDEBAR_WIDTH = 550;

export const EMULATOR_PRESETS = {
  RVM: 'open -a "Retro Virtual Machine" %FILE%',
  OPENMSX: 'openmsx %FILE%',
  DEFAULT: 'open %FILE%',
} as const;

export const IGNORED_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
export const IGNORED_DIRS = new Set(['built', 'node_modules', 'target']);

export const IMAGE_EXTENSIONS = new Set(['png', 'bmp', 'jpg', 'gif', 'ico']);
export const BINARY_EXTENSIONS = new Set(['png', 'bmp', 'jpg', 'gif', 'bin', 'dsk', 'cdt', 'rom']);

export const DEFAULT_NEW_PAK_NAME = 'new_script.pak';
export const DEFAULT_NEW_PNG_NAME = 'sprites.png';
export const DEFAULT_NEW_TMX_NAME = 'room.tmx';
export const DEFAULT_TILESET_FILENAME = 'bg-tiles.png';
export const DEFAULT_PAK_CONTENT = '; PAKET Script\n\n';
export const DEFAULT_BACKGROUND_LAYER_NAME = 'background';
export const DEFAULT_BACKGROUND_TILE_GID = 1;
export const EMPTY_TILE_GID = 0;
export const MIN_ROOM_SIZE = 1;

export const DEFAULT_IMAGE_WIDTH = 128;
export const DEFAULT_IMAGE_HEIGHT = 128;

export const MIN_OBJECT_ID = 1;
export const MAX_OBJECT_ID = 63;
export const PLAYER_OBJECT_ID = 63;
export const COMMON_DIRECTIONS = ['down', 'up', 'left', 'right', 'front'] as const;

export interface NewFileTypeOption {
  label: string;
  extension: string;
  defaultContent: string;
}

export const NEW_FILE_TYPES: NewFileTypeOption[] = [
  { label: 'PAKET Script (.pak)', extension: 'pak', defaultContent: DEFAULT_PAK_CONTENT },
  { label: 'Pixel Image (.png)', extension: 'png', defaultContent: '' },
  { label: 'Room Tilemap (.tmx)', extension: 'tmx', defaultContent: '' },
];

