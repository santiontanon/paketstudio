import type { TmxData, TmxTileset, TmxLayer, TmxObject } from '../types';
import {
  MIN_OBJECT_ID,
  MAX_OBJECT_ID,
  PLAYER_OBJECT_ID,
  DEFAULT_BACKGROUND_LAYER_NAME,
  DEFAULT_BACKGROUND_TILE_GID,
  EMPTY_TILE_GID,
  MIN_ROOM_SIZE
} from '../constants';
import { parentDir, isAbsolutePath } from './paths';

/**
 * Parses an XML string representing a Tiled .tmx map into structured TmxData.
 */
export function parseTmxXml(xmlString: string): TmxData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error(`Invalid TMX XML: ${parserError.textContent}`);
  }

  const mapEl = doc.querySelector('map');
  if (!mapEl) {
    throw new Error('Missing <map> root element in TMX file');
  }

  const width = parseInt(mapEl.getAttribute('width') || '16', 10);
  const height = parseInt(mapEl.getAttribute('height') || '11', 10);
  const tilewidth = parseInt(mapEl.getAttribute('tilewidth') || '8', 10);
  const tileheight = parseInt(mapEl.getAttribute('tileheight') || '8', 10);

  // Parse Tilesets
  const tilesets: TmxTileset[] = [];
  const tilesetEls = doc.querySelectorAll('tileset');
  tilesetEls.forEach(el => {
    const firstgid = parseInt(el.getAttribute('firstgid') || '1', 10);
    const name = el.getAttribute('name') || '';
    const tw = parseInt(el.getAttribute('tilewidth') || `${tilewidth}`, 10);
    const th = parseInt(el.getAttribute('tileheight') || `${tileheight}`, 10);
    const tilecount = parseInt(el.getAttribute('tilecount') || '0', 10);
    const columns = parseInt(el.getAttribute('columns') || '0', 10);

    const imgEl = el.querySelector('image');
    const imageSource = imgEl ? (imgEl.getAttribute('source') || '') : '';
    const imageWidth = imgEl ? parseInt(imgEl.getAttribute('width') || '0', 10) : 0;
    const imageHeight = imgEl ? parseInt(imgEl.getAttribute('height') || '0', 10) : 0;
    // External tileset, e.g. <tileset firstgid="17" source="hall.tsx"/>: the image and sizes
    // live in the .tsx file. Keep the reference so it can be resolved and written back as is.
    const externalSource = imgEl ? undefined : (el.getAttribute('source') || undefined);

    tilesets.push({
      firstgid,
      name,
      tilewidth: tw,
      tileheight: th,
      tilecount,
      columns,
      image: {
        source: imageSource,
        width: imageWidth,
        height: imageHeight
      },
      ...(externalSource ? { externalSource } : {})
    });
  });

  // Parse Tile Layers
  const layers: TmxLayer[] = [];
  const layerEls = doc.querySelectorAll('layer');
  layerEls.forEach(el => {
    const name = el.getAttribute('name') || '';
    const lw = parseInt(el.getAttribute('width') || `${width}`, 10);
    const lh = parseInt(el.getAttribute('height') || `${height}`, 10);
    const visibleAttr = el.getAttribute('visible');
    const visible = visibleAttr !== '0';

    const dataEl = el.querySelector('data');
    const rawData = dataEl ? (dataEl.textContent || '') : '';

    // CSV decoding
    const data: number[] = rawData
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n));

    layers.push({
      name,
      width: lw,
      height: lh,
      data,
      visible
    });
  });

  // Parse Object Groups
  const objects: TmxObject[] = [];
  const objectEls = doc.querySelectorAll('objectgroup object');
  objectEls.forEach(el => {
    const id = parseInt(el.getAttribute('id') || '0', 10);
    const name = el.getAttribute('name') || '';
    const x = Math.round(parseFloat(el.getAttribute('x') || '0'));
    const y = Math.round(parseFloat(el.getAttribute('y') || '0'));
    const w = Math.round(parseFloat(el.getAttribute('width') || '0'));
    const h = Math.round(parseFloat(el.getAttribute('height') || '0'));

    let depth: number | undefined = undefined;
    let direction: string | undefined = undefined;
    let state: string | undefined = undefined;
    const rawProperties: Record<string, string> = {};

    const propEls = el.querySelectorAll('properties property');
    propEls.forEach(p => {
      const pName = p.getAttribute('name');
      const pVal = p.getAttribute('value') || '';
      if (pName) {
        rawProperties[pName] = pVal;
        if (pName.toLowerCase() === 'depth') {
          depth = parseInt(pVal, 10);
        } else if (pName.toLowerCase() === 'direction') {
          direction = pVal;
        } else if (pName.toLowerCase() === 'state') {
          state = pVal;
        }
      }
    });

    objects.push({
      id,
      name,
      x,
      y,
      width: w,
      height: h,
      depth,
      direction,
      state,
      rawProperties
    });
  });

  return {
    width,
    height,
    tilewidth,
    tileheight,
    tilesets,
    layers,
    objects
  };
}

/**
 * Fills in external tilesets (<tileset source="x.tsx"/>) from their .tsx files so the room
 * editor can draw them and count their tiles. The reference itself is kept, so saving
 * writes it back unchanged.
 */
export async function resolveExternalTilesets(
  tmx: TmxData,
  tmxDir: string,
  readTextFile: (path: string) => Promise<string>
): Promise<string[]> {
  const errors: string[] = [];
  for (const ts of tmx.tilesets) {
    const ref = ts.externalSource;
    if (!ref) continue;
    try {
      const tsxPath = isAbsolutePath(ref) ? ref : `${tmxDir}/${ref}`;
      const doc = new DOMParser().parseFromString(await readTextFile(tsxPath), 'application/xml');
      const root = doc.querySelector('tileset');
      const img = root?.querySelector('image');
      if (!root || !img) throw new Error('no <tileset> with an <image> inside');
      // The .tsx image path is relative to the .tsx; RoomCanvas looks for it relative to the .tmx.
      const imgSrc = img.getAttribute('source') || '';
      const tsxDir = parentDir(ref);
      ts.name = root.getAttribute('name') || ts.name;
      ts.tilewidth = parseInt(root.getAttribute('tilewidth') || `${ts.tilewidth}`, 10);
      ts.tileheight = parseInt(root.getAttribute('tileheight') || `${ts.tileheight}`, 10);
      ts.tilecount = parseInt(root.getAttribute('tilecount') || '0', 10);
      ts.columns = parseInt(root.getAttribute('columns') || '0', 10);
      ts.image = {
        source: isAbsolutePath(imgSrc) || !tsxDir ? imgSrc : `${tsxDir}/${imgSrc}`,
        width: parseInt(img.getAttribute('width') || '0', 10),
        height: parseInt(img.getAttribute('height') || '0', 10)
      };
    } catch (err: any) {
      errors.push(`Could not read tileset ${ref}: ${err?.message || err}`);
    }
  }
  return errors;
}

/**
 * The firstgid for a tileset added after the existing ones: one past the last tile in use.
 */
export function getNextFirstGid(tilesets: TmxTileset[]): number {
  return tilesets.reduce((max, ts) => Math.max(max, ts.firstgid + ts.tilecount), 1);
}

/**
 * Serializes TmxData into a standard Tiled XML map string.
 */
export function serializeTmxXml(tmx: TmxData): string {
  const nextObjectId = tmx.objects.reduce((max, o) => Math.max(max, o.id + 1), 1);
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<map version="1.0" orientation="orthogonal" renderorder="right-down" width="${tmx.width}" height="${tmx.height}" tilewidth="${tmx.tilewidth}" tileheight="${tmx.tileheight}" nextobjectid="${nextObjectId}">`);

  // Tilesets
  for (const ts of tmx.tilesets) {
    if (ts.externalSource) {
      // Write the reference back; the .tsx file itself is never touched.
      lines.push(` <tileset firstgid="${ts.firstgid}" source="${ts.externalSource}"/>`);
      continue;
    }
    if (!ts.image.source) {
      // An empty image path breaks the map for PAKET and Tiled. Refuse to save instead.
      throw new Error(`Tileset "${ts.name}" (firstgid ${ts.firstgid}) has no image, so the map was not saved.`);
    }
    lines.push(` <tileset firstgid="${ts.firstgid}" name="${ts.name}" tilewidth="${ts.tilewidth}" tileheight="${ts.tileheight}" tilecount="${ts.tilecount}" columns="${ts.columns}">`);
    lines.push(`  <image source="${ts.image.source}" width="${ts.image.width}" height="${ts.image.height}"/>`);
    lines.push(' </tileset>');
  }

  // Layers
  for (const layer of tmx.layers) {
    const visStr = layer.visible ? '' : ' visible="0"';
    lines.push(` <layer name="${layer.name}" width="${layer.width}" height="${layer.height}"${visStr}>`);
    lines.push('  <data encoding="csv">');

    // Format CSV grid rows
    const rowStrings: string[] = [];
    for (let r = 0; r < layer.height; r++) {
      const start = r * layer.width;
      const row = layer.data.slice(start, start + layer.width);
      rowStrings.push(row.join(','));
    }
    lines.push(rowStrings.join(',\n'));

    lines.push('  </data>');
    lines.push(' </layer>');
  }

  // Object group
  lines.push(' <objectgroup name="objects">');
  for (const obj of tmx.objects) {
    lines.push(`  <object id="${obj.id}" name="${obj.name}" x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}">`);
    
    // Properties
    const propKeys = new Set(Object.keys(obj.rawProperties || {}));
    if (obj.depth !== undefined) propKeys.add('depth');
    if (obj.direction !== undefined) propKeys.add('direction');
    if (obj.state !== undefined) propKeys.add('state');

    if (propKeys.size > 0) {
      lines.push('   <properties>');
      for (const k of Array.from(propKeys).sort()) {
        let val = obj.rawProperties?.[k];
        if (k === 'depth' && obj.depth !== undefined) val = `${obj.depth}`;
        if (k === 'direction' && obj.direction !== undefined) val = obj.direction;
        if (k === 'state' && obj.state !== undefined) val = obj.state;
        if (val !== undefined) {
          lines.push(`    <property name="${k}" value="${val}"/>`);
        }
      }
      lines.push('   </properties>');
    }

    lines.push('  </object>');
  }
  lines.push(' </objectgroup>');

  lines.push('</map>');
  return lines.join('\n');
}

/** PAKET matches the "ID" property name in any case. */
function isIdPropertyName(name: string): boolean {
  return name.toLowerCase() === 'id';
}

/**
 * The ID PAKET gives an object: an "ID" property overrides the object's own id
 * (PAKRoom.java, where the objectgroup is read). Tutorial 3 gives the player ID 63 this way.
 */
export function getPaketObjectId(obj: TmxObject): number {
  let id = obj.id;
  for (const [k, v] of Object.entries(obj.rawProperties || {})) {
    if (isIdPropertyName(k) && !isNaN(parseInt(v, 10))) id = parseInt(v, 10);
  }
  return id;
}

/**
 * Gives an object a new PAKET ID. If it has an "ID" property, that property is changed and the
 * object id (which the editor uses to tell objects apart) is kept; otherwise the object id changes.
 */
export function setPaketObjectId(obj: TmxObject, id: number): TmxObject {
  const props = obj.rawProperties || {};
  const idKeys = Object.keys(props).filter(isIdPropertyName);
  if (idKeys.length === 0) return { ...obj, id };
  const rawProperties = { ...props };
  for (const k of idKeys) rawProperties[k] = `${id}`;
  return { ...obj, rawProperties };
}

/**
 * Whether giving `target` the PAKET ID `id` (via setPaketObjectId) would clash with another
 * object: either PAKET would see two objects with that ID, or two objects would share an object id.
 */
export function isObjectIdTaken(objects: TmxObject[], target: TmxObject, id: number): boolean {
  const changesObjectId = setPaketObjectId(target, id).id !== target.id;
  return objects.some(o =>
    o.id !== target.id && (getPaketObjectId(o) === id || (changesObjectId && o.id === id))
  );
}

/**
 * Validates object IDs in a map, using the ID PAKET will see (see getPaketObjectId):
 * - Must be between MIN_OBJECT_ID (1) and MAX_OBJECT_ID (63).
 * - 63 is reserved exclusively for the player object.
 * - No duplicate IDs.
 */
export function validateObjectIds(objects: TmxObject[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const seenIds = new Set<number>();

  for (const o of objects) {
    const obj = { ...o, id: getPaketObjectId(o) };
    if (obj.id < MIN_OBJECT_ID || obj.id > MAX_OBJECT_ID) {
      errors.push(`Object "${obj.name}" has invalid ID ${obj.id}. Object IDs must be between ${MIN_OBJECT_ID} and ${MAX_OBJECT_ID}.`);
    }

    if (seenIds.has(obj.id)) {
      errors.push(`Duplicate Object ID ${obj.id} found on "${obj.name}". Object IDs must be unique within a room.`);
    } else {
      seenIds.add(obj.id);
    }

    if (obj.id === PLAYER_OBJECT_ID && obj.name.toLowerCase() !== 'player') {
      errors.push(`ID ${PLAYER_OBJECT_ID} is reserved exclusively for the player object (found on "${obj.name}").`);
    }

    if (obj.name.toLowerCase() === 'player' && obj.id !== PLAYER_OBJECT_ID) {
      errors.push(`The player object must have ID ${PLAYER_OBJECT_ID} (currently ${obj.id}).`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Finds the next unused object ID in the range [MIN_OBJECT_ID, MAX_OBJECT_ID - 1].
 * For a player object, returns PLAYER_OBJECT_ID (63).
 */
export function getNextAvailableObjectId(objects: TmxObject[], isPlayer = false): number {
  if (isPlayer) return PLAYER_OBJECT_ID;

  const used = new Set(objects.flatMap(o => [o.id, getPaketObjectId(o)]));
  for (let id = MIN_OBJECT_ID; id < PLAYER_OBJECT_ID; id++) {
    if (!used.has(id)) {
      return id;
    }
  }
  return 1;
}

/**
 * Default fill tile GID for a layer: 0 for collision layers (empty), 1 for background layers
 * (tile 0 is invalid for background tiles in the PAKET engine).
 */
export function defaultTileGidForLayer(layerName: string): number {
  return layerName.toLowerCase().includes('collision') ? EMPTY_TILE_GID : DEFAULT_BACKGROUND_TILE_GID;
}

/**
 * Builds an embedded TmxTileset descriptor from an image's relative path and pixel dimensions.
 */
export function createEmbeddedTileset(
  imageSource: string,
  imageWidth: number,
  imageHeight: number,
  tilewidth: number,
  tileheight: number,
  firstgid: number
): TmxTileset {
  const columns = tilewidth > 0 ? Math.floor(imageWidth / tilewidth) : 0;
  const rows = tileheight > 0 ? Math.floor(imageHeight / tileheight) : 0;
  const baseName = (imageSource.split('/').pop() || imageSource).replace(/\.[^.]+$/, '') || 'tiles';
  return {
    firstgid,
    name: baseName,
    tilewidth,
    tileheight,
    tilecount: columns * rows,
    columns,
    image: {
      source: imageSource,
      width: imageWidth,
      height: imageHeight,
    },
  };
}

/**
 * Builds an empty TmxData structure with a single background tile layer filled with tile 1.
 */
export function createEmptyTmxData(
  width: number,
  height: number,
  tilewidth: number,
  tileheight: number,
  tilesets: TmxTileset[]
): TmxData {
  const safeW = Math.max(MIN_ROOM_SIZE, Math.floor(width));
  const safeH = Math.max(MIN_ROOM_SIZE, Math.floor(height));
  return {
    width: safeW,
    height: safeH,
    tilewidth,
    tileheight,
    tilesets,
    layers: [
      {
        name: DEFAULT_BACKGROUND_LAYER_NAME,
        width: safeW,
        height: safeH,
        data: new Array(safeW * safeH).fill(DEFAULT_BACKGROUND_TILE_GID),
        visible: true,
      },
    ],
    objects: [],
  };
}

/**
 * Returns placed objects that would fall outside a room of `widthTiles` × `heightTiles`.
 */
export function getObjectsOutsideRoomBounds(
  objects: TmxObject[],
  widthTiles: number,
  heightTiles: number,
  tilewidth: number,
  tileheight: number
): TmxObject[] {
  const maxPxW = widthTiles * tilewidth;
  const maxPxH = heightTiles * tileheight;
  return objects.filter(
    obj => obj.x < 0 || obj.y < 0 || obj.x + obj.width > maxPxW || obj.y + obj.height > maxPxH
  );
}

/**
 * Resizes a TMX map to `newWidth` × `newHeight` tiles (anchored top-left).
 * Existing tile layers are padded with their default tile GID (1 for background, 0 for collision)
 * when growing and cropped when shrinking.
 * Objects outside the new pixel bounds are clamped inside (maintaining CPC even-X alignment
 * and relative depth offsets).
 */
export function resizeTmxData(
  tmx: TmxData,
  newWidth: number,
  newHeight: number,
  isCpc: boolean
): { tmx: TmxData; clampedObjects: TmxObject[] } {
  const safeW = Math.max(MIN_ROOM_SIZE, Math.floor(newWidth));
  const safeH = Math.max(MIN_ROOM_SIZE, Math.floor(newHeight));

  const nextLayers: TmxLayer[] = tmx.layers.map(layer => {
    const fillGid = defaultTileGidForLayer(layer.name);
    const nextData = new Array<number>(safeW * safeH).fill(fillGid);
    const copyRows = Math.min(layer.height, safeH);
    const copyCols = Math.min(layer.width, safeW);
    for (let r = 0; r < copyRows; r++) {
      for (let c = 0; c < copyCols; c++) {
        nextData[r * safeW + c] = layer.data[r * layer.width + c] ?? fillGid;
      }
    }
    return {
      ...layer,
      width: safeW,
      height: safeH,
      data: nextData,
    };
  });

  const newPixelW = safeW * tmx.tilewidth;
  const newPixelH = safeH * tmx.tileheight;
  const clampedObjects: TmxObject[] = [];

  const nextObjects: TmxObject[] = tmx.objects.map(obj => {
    const maxX = Math.max(0, newPixelW - obj.width);
    const maxY = Math.max(0, newPixelH - obj.height);
    let nextX = Math.max(0, Math.min(maxX, obj.x));
    const nextY = Math.max(0, Math.min(maxY, obj.y));

    if (nextX !== obj.x && isCpc) {
      nextX = Math.floor(nextX / 2) * 2;
    }

    if (nextX === obj.x && nextY === obj.y) {
      return obj;
    }

    const deltaY = nextY - obj.y;
    const updated: TmxObject = {
      ...obj,
      x: nextX,
      y: nextY,
      ...(obj.depth !== undefined ? { depth: obj.depth + deltaY } : {}),
    };
    clampedObjects.push(updated);
    return updated;
  });

  return {
    tmx: {
      ...tmx,
      width: safeW,
      height: safeH,
      layers: nextLayers,
      objects: nextObjects,
    },
    clampedObjects,
  };
}

