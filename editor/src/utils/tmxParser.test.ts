// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseTmxXml, serializeTmxXml, resolveExternalTilesets, getNextFirstGid, validateObjectIds,
  getPaketObjectId, setPaketObjectId, isObjectIdTaken, getNextAvailableObjectId,
  createEmptyTmxData, createEmbeddedTileset, getObjectsOutsideRoomBounds, resizeTmxData } from './tmxParser';
import type { TmxObject } from '../types';
import cpcTemplateRoom from '../../templates/cpc/room.tmx?raw';
import msxTemplateRoom from '../../templates/msx/room.tmx?raw';
import msxWtTemplateRoom from '../../templates/msx-wt/room.tmx?raw';

/** A 4x2 map whose only tileset lives in a separate .tsx file, as Tiled writes it. */
const EXTERNAL_TILESET_MAP = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.11.2" orientation="orthogonal" renderorder="right-down" width="4" height="2" tilewidth="8" tileheight="8" infinite="0" nextlayerid="3" nextobjectid="2">
 <tileset firstgid="1" source="room-tiles.tsx"/>
 <layer id="1" name="background" width="4" height="2">
  <data encoding="csv">
1,2,3,4,
5,6,7,8
</data>
 </layer>
 <objectgroup id="2" name="objects">
  <object id="1" name="door" x="8" y="0" width="8" height="16"/>
 </objectgroup>
</map>
`;

const ROOM_TILES_TSX = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.11.2" name="room-tiles" tilewidth="8" tileheight="8" tilecount="16" columns="16">
 <image source="room-tiles.png" width="128" height="8"/>
</tileset>
`;

/** Stands in for the read_text_file IPC call: serves files from memory, fails like a missing file otherwise. */
function readFrom(files: Record<string, string>) {
  return async (path: string) => {
    if (!(path in files)) throw new Error(`No such file: ${path}`);
    return files[path];
  };
}

describe('saving a map that was loaded from a .tmx', () => {
  it('writes an external tileset back as a reference to its .tsx file', () => {
    const saved = serializeTmxXml(parseTmxXml(EXTERNAL_TILESET_MAP));

    expect(saved).toContain('<tileset firstgid="1" source="room-tiles.tsx"/>');
    expect(saved).not.toContain('<image');
  });

  it('refuses to save an embedded tileset that has no image, instead of writing source=""', () => {
    const tmx = parseTmxXml(EXTERNAL_TILESET_MAP);
    // What the old parser produced for an external tileset: the reference was lost.
    delete tmx.tilesets[0].externalSource;

    expect(() => serializeTmxXml(tmx)).toThrow(/firstgid 1.*no image/);
  });

  it.each([
    ['cpc', cpcTemplateRoom],
    ['msx', msxTemplateRoom],
    ['msx-wt', msxWtTemplateRoom],
  ])('writes the embedded tileset of the %s template map exactly as it was', (_, file) => {
    const tilesetBlock = file.match(/ <tileset [\s\S]*?<\/tileset>/)![0];

    expect(serializeTmxXml(parseTmxXml(file))).toContain(tilesetBlock);
  });
});

describe('resolving external tilesets from their .tsx files', () => {
  it('fills in the tile count, columns and image from the .tsx next to the map', async () => {
    const tmx = parseTmxXml(EXTERNAL_TILESET_MAP);

    const errors = await resolveExternalTilesets(tmx, '/proj/cpc', readFrom({ '/proj/cpc/room-tiles.tsx': ROOM_TILES_TSX }));

    expect(errors).toEqual([]);
    expect(tmx.tilesets[0]).toMatchObject({
      name: 'room-tiles',
      tilecount: 16,
      columns: 16,
      image: { source: 'room-tiles.png', width: 128, height: 8 },
    });
  });

  it('makes the image path of a .tsx in a subfolder relative to the map, and keeps the reference', async () => {
    const tmx = parseTmxXml(EXTERNAL_TILESET_MAP.replace('source="room-tiles.tsx"', 'source="tiles/room-tiles.tsx"'));

    await resolveExternalTilesets(tmx, '/proj/cpc', readFrom({ '/proj/cpc/tiles/room-tiles.tsx': ROOM_TILES_TSX }));

    expect(tmx.tilesets[0].image.source).toBe('tiles/room-tiles.png');
    expect(serializeTmxXml(tmx)).toContain('<tileset firstgid="1" source="tiles/room-tiles.tsx"/>');
  });

  it('reports a .tsx that cannot be read, still resolves the others, and still saves its reference', async () => {
    const tmx = parseTmxXml(EXTERNAL_TILESET_MAP.replace(
      '<tileset firstgid="1" source="room-tiles.tsx"/>',
      '<tileset firstgid="1" source="missing.tsx"/>\n <tileset firstgid="17" source="room-tiles.tsx"/>'
    ));

    const errors = await resolveExternalTilesets(tmx, '/proj/cpc', readFrom({ '/proj/cpc/room-tiles.tsx': ROOM_TILES_TSX }));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('missing.tsx');
    expect(tmx.tilesets[1].tilecount).toBe(16);
    const saved = serializeTmxXml(tmx);
    expect(saved).toContain('<tileset firstgid="1" source="missing.tsx"/>');
    expect(saved).toContain('<tileset firstgid="17" source="room-tiles.tsx"/>');
  });

  it('takes the tile size from the .tsx, not from the map', async () => {
    const tmx = parseTmxXml(EXTERNAL_TILESET_MAP);
    const bigTiles = ROOM_TILES_TSX.replace('tilewidth="8" tileheight="8"', 'tilewidth="16" tileheight="24"');

    await resolveExternalTilesets(tmx, '/proj/cpc', readFrom({ '/proj/cpc/room-tiles.tsx': bigTiles }));

    expect(tmx.tilesets[0]).toMatchObject({ tilewidth: 16, tileheight: 24 });
  });

  it.each(['/shared', 'C:/shared'])('reads a .tsx given by absolute path (%s) and keeps an absolute image path as is', async root => {
    const tmx = parseTmxXml(EXTERNAL_TILESET_MAP.replace('source="room-tiles.tsx"', `source="${root}/room-tiles.tsx"`));
    const absoluteImage = ROOM_TILES_TSX.replace('source="room-tiles.png"', `source="${root}/art/room-tiles.png"`);

    const errors = await resolveExternalTilesets(tmx, '/proj/cpc', readFrom({ [`${root}/room-tiles.tsx`]: absoluteImage }));

    expect(errors).toEqual([]);
    expect(tmx.tilesets[0].image.source).toBe(`${root}/art/room-tiles.png`);
  });
});

describe('choosing the firstgid for a newly added tileset', () => {
  it('starts after the last tile of every tileset, counting the tiles of external ones', async () => {
    const tmx = parseTmxXml(EXTERNAL_TILESET_MAP.replace('<tileset firstgid="1" source="room-tiles.tsx"/>', `
 <tileset firstgid="1" name="tiles" tilewidth="8" tileheight="8" tilecount="16" columns="16">
  <image source="bg-tiles.png" width="128" height="8"/>
 </tileset>
 <tileset firstgid="17" source="hall.tsx"/>
 <tileset firstgid="49" source="collision.tsx"/>`));
    const tsx = (name: string, tilecount: number) =>
      `<tileset name="${name}" tilewidth="8" tileheight="8" tilecount="${tilecount}" columns="8"><image source="${name}.png" width="64" height="32"/></tileset>`;

    await resolveExternalTilesets(tmx, '/proj/cpc', readFrom({
      '/proj/cpc/hall.tsx': tsx('hall', 32),
      '/proj/cpc/collision.tsx': tsx('collision', 9),
    }));

    expect(getNextFirstGid(tmx.tilesets)).toBe(58);
  });

  it('is 1 for a map with no tilesets', () => {
    expect(getNextFirstGid([])).toBe(1);
  });
});

/** An object as placed in a room, with PAKET's optional "ID" property override. */
function obj(id: number, name: string, properties: Record<string, string> = {}): TmxObject {
  return { id, name, x: 0, y: 0, width: 8, height: 8, rawProperties: properties };
}

describe('object IDs as PAKET sees them', () => {
  it('accepts a player whose ID property is 63 even though its object id is not', () => {
    const result = validateObjectIds([obj(1, 'door'), obj(2, 'player', { ID: '63' })]);

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('reports two objects that PAKET would give the same ID through the ID property', () => {
    const result = validateObjectIds([obj(1, 'door'), obj(2, 'chest', { id: '1' })]);

    expect(result.errors).toEqual(['Duplicate Object ID 1 found on "chest". Object IDs must be unique within a room.']);
  });
});

describe('editing the ID of an object', () => {
  it('changes the ID property when the object has one, keeping its object id', () => {
    const edited = setPaketObjectId(obj(2, 'chest', { Id: '7', state: 'closed' }), 9);

    expect(edited.id).toBe(2);
    expect(edited.rawProperties).toEqual({ Id: '9', state: 'closed' });
    expect(getPaketObjectId(edited)).toBe(9);
  });

  it('changes the object id when there is no ID property', () => {
    const edited = setPaketObjectId(obj(2, 'chest', { state: 'closed' }), 9);

    expect(edited.id).toBe(9);
    expect(edited.rawProperties).toEqual({ state: 'closed' });
  });
});

describe('checking whether an ID is free for an object', () => {
  const player = obj(2, 'player', { ID: '63' });
  const door = obj(1, 'door');

  it('is taken when another object has it as its PAKET ID', () => {
    expect(isObjectIdTaken([door, player], door, 63)).toBe(true);
  });

  it('is taken when it is another object\'s object id and the edit would change the object id', () => {
    expect(isObjectIdTaken([door, player], door, 2)).toBe(true);
  });

  it('is free when only another object\'s overridden object id matches and the edit changes an ID property', () => {
    const chest = obj(3, 'chest', { ID: '4' });

    expect(isObjectIdTaken([door, player, chest], chest, 2)).toBe(false);
  });

  it('is free when it is the object\'s own ID', () => {
    expect(isObjectIdTaken([door, player], player, 63)).toBe(false);
  });
});

describe('choosing the ID for a new object', () => {
  it('skips IDs in use either as an object id or through an ID property', () => {
    const objects = [obj(1, 'door'), obj(2, 'player', { ID: '63' }), obj(5, 'chest', { id: '3' })];

    expect(getNextAvailableObjectId(objects)).toBe(4);
  });
});

describe('creating an empty room map', () => {
  it('produces a valid TMX with an embedded tileset and background layer filled with tile 1', () => {
    const tileset = createEmbeddedTileset('bg-tiles.png', 256, 8, 16, 8, 1);
    const empty = createEmptyTmxData(12, 8, 16, 8, [tileset]);
    const parsed = parseTmxXml(serializeTmxXml(empty));

    expect(parsed.width).toBe(12);
    expect(parsed.height).toBe(8);
    expect(parsed.tilewidth).toBe(16);
    expect(parsed.tileheight).toBe(8);
    expect(parsed.tilesets).toEqual([
      {
        firstgid: 1,
        name: 'bg-tiles',
        tilewidth: 16,
        tileheight: 8,
        tilecount: 16,
        columns: 16,
        image: { source: 'bg-tiles.png', width: 256, height: 8 },
      },
    ]);
    expect(parsed.objects).toEqual([]);
    expect(parsed.layers).toHaveLength(1);
    expect(parsed.layers[0].name).toBe('background');
    expect(parsed.layers[0].data).toHaveLength(12 * 8);
    expect(parsed.layers[0].data.every(v => v === 1)).toBe(true);
  });
});

describe('resizing a room map', () => {
  const sampleMap = () => parseTmxXml(`<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0" orientation="orthogonal" renderorder="right-down" width="3" height="2" tilewidth="8" tileheight="8" nextobjectid="4">
 <layer name="background" width="3" height="2">
  <data encoding="csv">
1,2,3,
4,5,6
  </data>
 </layer>
 <layer name="collision" width="3" height="2" visible="0">
  <data encoding="csv">
9,0,9,
0,9,0
  </data>
 </layer>
 <objectgroup name="objects">
  <object id="1" name="inside" x="0" y="0" width="8" height="8"/>
  <object id="2" name="outside" x="16" y="8" width="8" height="8">
   <properties>
    <property name="depth" value="18"/>
   </properties>
  </object>
 </objectgroup>
</map>`);

  it('pads background layers with 1 and collision layers with 0 when growing while preserving existing tiles top-left', () => {
    const { tmx, clampedObjects } = resizeTmxData(sampleMap(), 4, 3, false);

    expect(tmx.width).toBe(4);
    expect(tmx.height).toBe(3);
    expect(tmx.layers[0].data).toEqual([
      1, 2, 3, 1,
      4, 5, 6, 1,
      1, 1, 1, 1,
    ]);
    expect(tmx.layers[1].data).toEqual([
      9, 0, 9, 0,
      0, 9, 0, 0,
      0, 0, 0, 0,
    ]);
    expect(clampedObjects).toEqual([]);
  });

  it('crops tile layers and clamps out-of-bounds objects while preserving depth offset', () => {
    const map = sampleMap();
    const outBefore = getObjectsOutsideRoomBounds(map.objects, 2, 1, map.tilewidth, map.tileheight);
    expect(outBefore.map(o => o.name)).toEqual(['outside']);

    const { tmx, clampedObjects } = resizeTmxData(map, 2, 1, false);

    expect(tmx.width).toBe(2);
    expect(tmx.height).toBe(1);
    expect(tmx.layers[0].data).toEqual([1, 2]);
    expect(tmx.layers[1].data).toEqual([9, 0]);
    expect(clampedObjects).toHaveLength(1);
    expect(tmx.objects[0]).toMatchObject({ name: 'inside', x: 0, y: 0 });
    expect(tmx.objects[1]).toMatchObject({ name: 'outside', x: 8, y: 0, depth: 10 });
  });

  it('enforces even X when clamping objects on CPC', () => {
    const map = sampleMap();
    map.objects[1] = { ...map.objects[1], x: 18, width: 7 };

    const { tmx } = resizeTmxData(map, 2, 2, true);

    // maxX = 16 - 7 = 9, snapped to even <= 9 => 8
    expect(tmx.objects[1].x).toBe(8);
  });
});
