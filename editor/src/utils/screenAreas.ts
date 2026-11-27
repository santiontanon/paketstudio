import type { Platform } from '../types';
import { MIN_ROOM_SIZE } from '../constants';

const CPC_SCREEN_WIDTH = 128;
const MSX_SCREEN_WIDTH = 256;
const DEFAULT_SCREEN_HEIGHT = 192;

const DEFAULT_TILE_WIDTH = 8;
const MSX_WT_TILE_WIDTH = 16;
const DEFAULT_TILE_HEIGHT = 8;

const CPC_DEFAULT_COLS = 16;
const MSX_DEFAULT_COLS = 32;
const MSX_WT_DEFAULT_COLS = 16;

const DEFAULT_TEXT_AREA_Y = 0;
const DEFAULT_TEXT_AREA_HEIGHT = 5;
const DEFAULT_GAME_AREA_Y = 6;
const DEFAULT_GAME_AREA_HEIGHT = 11;
const DEFAULT_GUI_AREA_Y = 18;
const DEFAULT_GUI_AREA_HEIGHT = 6;

export interface ScreenAreaDef {
  x: number; // in tiles
  y: number; // in tiles
  width: number; // in tiles
  height: number; // in tiles
  pixelX: number;
  pixelY: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface ScreenGuidelines {
  screenWidth: number;
  screenHeight: number;
  tileWidth: number;
  tileHeight: number;
  textArea: ScreenAreaDef;
  gameArea: ScreenAreaDef;
  guiArea: ScreenAreaDef;
}

/**
 * Checks if a given platform string represents an Amstrad CPC target.
 */
export function isCpcPlatform(platform?: string | null): boolean {
  if (!platform) return false;
  return platform.toLowerCase().startsWith('cpc');
}

/**
 * Checks if a given platform string represents the MSX wide-tiles (16x8) target.
 */
export function isMsxWtPlatform(platform?: string | null): boolean {
  if (!platform) return false;
  return platform.toLowerCase() === 'msx-wt';
}

/**
 * Default tile pixel dimensions for a target platform.
 */
export function getDefaultTileSize(platform: Platform): { tileWidth: number; tileHeight: number } {
  return {
    tileWidth: isMsxWtPlatform(platform) ? MSX_WT_TILE_WIDTH : DEFAULT_TILE_WIDTH,
    tileHeight: DEFAULT_TILE_HEIGHT,
  };
}

function makeAreaDef(
  x: number,
  y: number,
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number
): ScreenAreaDef {
  return {
    x,
    y,
    width,
    height,
    pixelX: x * tileWidth,
    pixelY: y * tileHeight,
    pixelWidth: width * tileWidth,
    pixelHeight: height * tileHeight,
  };
}

/**
 * Parses screen division guidelines from .pak source text, falling back
 * to standard defaults for MSX, MSX-WT, or CPC.
 */
export function getScreenGuidelines(
  platform: Platform,
  pakTexts: string[],
  mapTileWidth?: number,
  mapTileHeight?: number
): ScreenGuidelines {
  const isCpc = isCpcPlatform(platform);
  const isMsxWt = isMsxWtPlatform(platform);
  const defaultTile = getDefaultTileSize(platform);

  const screenWidth = isCpc ? CPC_SCREEN_WIDTH : MSX_SCREEN_WIDTH;
  const screenHeight = DEFAULT_SCREEN_HEIGHT;
  const tileWidth = mapTileWidth || defaultTile.tileWidth;
  const tileHeight = mapTileHeight || defaultTile.tileHeight;
  const defaultCols = isCpc ? CPC_DEFAULT_COLS : (isMsxWt ? MSX_WT_DEFAULT_COLS : MSX_DEFAULT_COLS);

  let textMatch: RegExpMatchArray | null = null;
  let gameMatch: RegExpMatchArray | null = null;
  let guiMatch: RegExpMatchArray | null = null;

  for (const text of pakTexts) {
    if (!text) continue;
    if (!textMatch) {
      textMatch = text.match(/text-area\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    }
    if (!gameMatch) {
      gameMatch = text.match(/game-area\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    }
    if (!guiMatch) {
      guiMatch = text.match(/gui\s*\(\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*"[^"]*")?\s*\)/i);
    }
    if (textMatch && gameMatch && guiMatch) break;
  }

  const textArea = textMatch
    ? makeAreaDef(
        parseInt(textMatch[1], 10),
        parseInt(textMatch[2], 10),
        parseInt(textMatch[3], 10),
        parseInt(textMatch[4], 10),
        tileWidth,
        tileHeight
      )
    : makeAreaDef(0, DEFAULT_TEXT_AREA_Y, defaultCols, DEFAULT_TEXT_AREA_HEIGHT, tileWidth, tileHeight);

  const gameArea = gameMatch
    ? makeAreaDef(
        parseInt(gameMatch[1], 10),
        parseInt(gameMatch[2], 10),
        parseInt(gameMatch[3], 10),
        parseInt(gameMatch[4], 10),
        tileWidth,
        tileHeight
      )
    : makeAreaDef(0, DEFAULT_GAME_AREA_Y, defaultCols, DEFAULT_GAME_AREA_HEIGHT, tileWidth, tileHeight);

  const guiArea = guiMatch
    ? makeAreaDef(
        parseInt(guiMatch[1], 10),
        parseInt(guiMatch[2], 10),
        defaultCols,
        Math.max(1, Math.round(screenHeight / tileHeight) - parseInt(guiMatch[2], 10)),
        tileWidth,
        tileHeight
      )
    : makeAreaDef(0, DEFAULT_GUI_AREA_Y, defaultCols, DEFAULT_GUI_AREA_HEIGHT, tileWidth, tileHeight);

  return {
    screenWidth,
    screenHeight,
    tileWidth,
    tileHeight,
    textArea,
    gameArea,
    guiArea,
  };
}

/**
 * Maximum room dimensions (in tiles) that fit inside the game area given the room's tile offset.
 */
export function getMaxRoomSize(
  gameAreaWidth: number,
  gameAreaHeight: number,
  offsetX: number,
  offsetY: number
): { maxWidth: number; maxHeight: number } {
  return {
    maxWidth: Math.max(MIN_ROOM_SIZE, gameAreaWidth - Math.max(0, offsetX)),
    maxHeight: Math.max(MIN_ROOM_SIZE, gameAreaHeight - Math.max(0, offsetY)),
  };
}

/**
 * Maximum room tile offset (x, y) that keeps the room inside the game area.
 */
export function getMaxRoomOffset(
  gameAreaWidth: number,
  gameAreaHeight: number,
  roomWidth: number,
  roomHeight: number
): { maxOffsetX: number; maxOffsetY: number } {
  return {
    maxOffsetX: Math.max(0, gameAreaWidth - roomWidth),
    maxOffsetY: Math.max(0, gameAreaHeight - roomHeight),
  };
}

/**
 * Validates room dimensions (in tiles) against the game area and room offset.
 * Returns an error message when invalid, or null when valid.
 */
export function validateRoomDimensions(
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  gameAreaWidth: number,
  gameAreaHeight: number
): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < MIN_ROOM_SIZE || height < MIN_ROOM_SIZE) {
    return `Dimensions must be at least ${MIN_ROOM_SIZE} × ${MIN_ROOM_SIZE} tiles.`;
  }
  const safeOffsetX = Math.max(0, offsetX);
  const safeOffsetY = Math.max(0, offsetY);
  const maxWidth = gameAreaWidth - safeOffsetX;
  const maxHeight = gameAreaHeight - safeOffsetY;

  if (width > maxWidth) {
    return safeOffsetX > 0
      ? `Width cannot exceed ${Math.max(0, maxWidth)} tiles (game area width ${gameAreaWidth} minus offset X ${safeOffsetX}).`
      : `Width cannot exceed ${gameAreaWidth} tiles (game area width).`;
  }
  if (height > maxHeight) {
    return safeOffsetY > 0
      ? `Height cannot exceed ${Math.max(0, maxHeight)} tiles (game area height ${gameAreaHeight} minus offset Y ${safeOffsetY}).`
      : `Height cannot exceed ${gameAreaHeight} tiles (game area height).`;
  }
  return null;
}

