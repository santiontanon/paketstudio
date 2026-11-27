import { describe, it, expect } from 'vitest';
import {
  getScreenGuidelines,
  getDefaultTileSize,
  getMaxRoomSize,
  getMaxRoomOffset,
  validateRoomDimensions,
} from './screenAreas';

describe('screen guidelines and platform defaults', () => {
  it('uses 16x8 tiles and 16 columns by default for msx-wt', () => {
    const g = getScreenGuidelines('msx-wt', []);
    expect(getDefaultTileSize('msx-wt')).toEqual({ tileWidth: 16, tileHeight: 8 });
    expect(g.gameArea.width).toBe(16);
    expect(g.gameArea.height).toBe(11);
    expect(g.gameArea.pixelWidth).toBe(256);
    expect(g.gameArea.pixelHeight).toBe(88);
  });

  it('parses custom game-area dimensions from pak texts', () => {
    const g = getScreenGuidelines('cpc', ['text-area(0, 0, 16, 4)\ngame-area(0, 5, 14, 12)\n']);
    expect(g.gameArea.width).toBe(14);
    expect(g.gameArea.height).toBe(12);
  });
});

describe('room dimension and offset bounds', () => {
  it('reduces max room size by room offset', () => {
    expect(getMaxRoomSize(16, 11, 4, 2)).toEqual({ maxWidth: 12, maxHeight: 9 });
  });

  it('reduces max room offset by room size', () => {
    expect(getMaxRoomOffset(16, 11, 12, 9)).toEqual({ maxOffsetX: 4, maxOffsetY: 2 });
  });

  it('rejects rooms where offset + size exceeds game area', () => {
    expect(validateRoomDimensions(13, 11, 4, 0, 16, 11)).toMatch(/12 tiles/);
    expect(validateRoomDimensions(12, 10, 4, 2, 16, 11)).toMatch(/9 tiles/);
    expect(validateRoomDimensions(0, 11, 0, 0, 16, 11)).toMatch(/at least 1/);
    expect(validateRoomDimensions(12, 9, 4, 2, 16, 11)).toBeNull();
  });
});
