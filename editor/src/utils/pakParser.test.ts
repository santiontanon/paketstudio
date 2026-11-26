import { describe, it, expect } from 'vitest';
import {
  insertRoomIntoContent,
  parsePakFile,
  statePreviewImage,
  updateItemInContent,
  updateObjectInContent,
  updateRoomInContent,
} from './pakParser';

// Room taken from PAKET's tutorial 5 (examples/tutorials/tutorial5-bells-n-whistles/cpc/rooms.pak).
const ROOMS_PAK = [
  '# Rooms: ----------------',
  'room("tutorial", "room16.tmx", 0, 0):',
  '    on-room-load-rule variable-eq(intro-custcenes-played, 0):',
  '        call-script("my-cutscene-script")',
  '        # play-wyz-song("sound/external.mus")',
  '',
  '    on-room-start-rule variable-eq(intro-custcenes-played, 0):',
  '        call-script("my-cutscene-script-2")',
  '        set-variable(intro-custcenes-played, 1)',
  '',
].join('\n');

function room(content: string, id: string) {
  const found = parsePakFile(content, 'rooms.pak').rooms.find(r => r.id === id);
  if (!found) throw new Error(`room ${id} not parsed`);
  return found;
}

describe('saving a room', () => {
  it('leaves the file untouched when nothing was edited', () => {
    const tutorial = room(ROOMS_PAK, 'tutorial');

    expect(updateRoomInContent(ROOMS_PAK, tutorial, 'tutorial')).toBe(ROOMS_PAK);
  });

  it('rewrites only the header when the start position changes, keeping the ID quoted', () => {
    const tutorial = room(ROOMS_PAK, 'tutorial');

    const saved = updateRoomInContent(ROOMS_PAK, { ...tutorial, x: 8 }, 'tutorial');

    expect(saved).toBe(
      ROOMS_PAK.replace('room("tutorial", "room16.tmx", 0, 0):', 'room("tutorial", "room16.tmx", 8, 0):')
    );
  });

  it('keeps header flags such as lock-player-zoom when the header is rewritten', () => {
    const pak = 'room("tv", "tv.tmx", 0, 0, subroom, lock-player-zoom-75):\n    rule examine-object(1):\n        message("A TV.")\n';
    const tv = room(pak, 'tv');

    const saved = updateRoomInContent(pak, { ...tv, y: 4 }, 'tv');

    expect(saved).toBe(pak.replace('0, 0, subroom', '0, 4, subroom'));
  });

  it('rewrites the header when a header flag is removed', () => {
    const pak = 'room("tv", "tv.tmx", 0, 0, lock-player-zoom-75):\n    rule examine-object(1):\n        message("A TV.")\n';
    const tv = room(pak, 'tv');

    const saved = updateRoomInContent(pak, { ...tv, otherFlags: undefined }, 'tv');

    expect(saved).toBe(pak.replace(', lock-player-zoom-75', ''));
  });

  it('keeps blank lines and tab indentation when the rules are edited', () => {
    const pak = [
      'room("hall", "hall.tmx", 0, 0):',
      '\ton-room-start-rule always:',
      '\t\tmessage("Welcome.")',
      '',
      '\trule examine-object(2):',
      '\t\tmessage("A lamp.")',
      '',
    ].join('\n');
    const hall = room(pak, 'hall');
    // The Rooms panel hands back its rules editor's text split into lines, with trailing spaces trimmed.
    const editedRules = hall.rules.map(line => line.replace('A lamp.', 'An old lamp.').trimEnd());

    const saved = updateRoomInContent(pak, { ...hall, rules: editedRules }, 'hall');

    expect(saved).toBe(pak.replace('A lamp.', 'An old lamp.'));
  });
});

// Objects taken from PAKET's tutorial 5 (examples/tutorials/tutorial5-bells-n-whistles/cpc/objects.pak).
const OBJECTS_PAK = [
  '# Objects: ----------------',
  'object("chair", "chair", "A nice-looking chair."):',
  '    state("idle", "left"):',
  '        image("objects.png", 0, 0, 8, 16)',
  '        collisionmask("0000", "0000", "0000", "1111")',
  '',
  'object("dog", "dog", "A big but cute dog, looking a bit too eager to please."):',
  '    state("idle", "left"):',
  '        animation(10,  0, 1):',
  '            image("objects.png", 32, 24, 40, 40)',
  '            image("objects.png", 40, 24, 48, 40)',
  '            collisionmask("0000", "0000", "0000", "1111")',
  '',
].join('\n');

function object(content: string, id: string) {
  const found = parsePakFile(content, 'objects.pak').objects.find(o => o.id === id);
  if (!found) throw new Error(`object ${id} not parsed`);
  return found;
}

// The chair from tutorial 5, with its mask spread over several lines (valid PAKET: line breaks are ignored).
const MULTILINE_MASK_PAK = [
  'object("chair", "chair", "A nice-looking chair."):',
  '    state("idle", "left"):',
  '        image("objects.png", 0, 0, 8, 16)',
  '        collisionmask("0000",',
  '                      "0000",',
  '                      "0000",',
  '                      "1111")',
  '',
].join('\n');

describe('reading objects', () => {
  it('reads an animation as its frames rather than as a still image', () => {
    const [idle] = object(OBJECTS_PAK, 'dog').states;

    expect(idle.image).toBeUndefined();
    expect(idle.animation).toMatchObject({
      speed: 10,
      sequence: [0, 1],
      frames: [
        { file: 'objects.png', x1: 32, y1: 24, x2: 40, y2: 40 },
        { file: 'objects.png', x1: 40, y1: 24, x2: 48, y2: 40 },
      ],
    });
    expect(idle.collisionMask).toEqual(['0000', '0000', '0000', '1111']);
  });

  it('previews an animated state with its first frame and a still state with its image', () => {
    const [dogIdle] = object(OBJECTS_PAK, 'dog').states;
    const [chairIdle] = object(OBJECTS_PAK, 'chair').states;

    expect(statePreviewImage(dogIdle)).toEqual({ file: 'objects.png', x1: 32, y1: 24, x2: 40, y2: 40 });
    expect(statePreviewImage(chairIdle)).toEqual({ file: 'objects.png', x1: 0, y1: 0, x2: 8, y2: 16 });
  });

  it('reads every row of a collision mask that spans several lines', () => {
    const [idle] = object(MULTILINE_MASK_PAK, 'chair').states;

    expect(idle.collisionMask).toEqual(['0000', '0000', '0000', '1111']);
    expect(idle.rules).toEqual([]);
  });
});

describe('saving an object', () => {
  it('leaves an animated object untouched when nothing was edited', () => {
    const dog = object(OBJECTS_PAK, 'dog');

    expect(updateObjectInContent(OBJECTS_PAK, dog, 'dog')).toBe(OBJECTS_PAK);
  });

  it('keeps the animation and rewrites only the mask when a collision cell is toggled', () => {
    const dog = object(OBJECTS_PAK, 'dog');
    const [idle] = dog.states;

    const saved = updateObjectInContent(
      OBJECTS_PAK,
      { ...dog, states: [{ ...idle, collisionMask: ['0000', '0000', '0000', '1110'] }] },
      'dog'
    );

    expect(saved).toBe(
      OBJECTS_PAK.replace(
        '            collisionmask("0000", "0000", "0000", "1111")\n',
        '            collisionmask("0000", "0000", "0000", "1110")\n'
      )
    );
  });

  // From PAKET's thekey-ep2 example (cpc/objects.pak).
  const EMPTY_IMAGE_PAK = [
    'object("exit-1x4", "salida", "Salida"):',
    '    state("exit", "front"):',
    '        empty-image(8, 32)',
    '        selection(box)  # Since this object is transparent, it would not be selectable otherwise',
    '',
  ].join('\n');

  it('keeps empty-image where it was when the selection is changed', () => {
    const exit = object(EMPTY_IMAGE_PAK, 'exit-1x4');
    const [state] = exit.states;

    const saved = updateObjectInContent(EMPTY_IMAGE_PAK, { ...exit, states: [{ ...state, selectionType: 'pixel' }] }, 'exit-1x4');

    expect(saved).toBe(EMPTY_IMAGE_PAK.replace(/selection\(box\).*/, 'selection(pixel)'));
  });

  it('replaces empty-image when an image is chosen for the state', () => {
    const exit = object(EMPTY_IMAGE_PAK, 'exit-1x4');
    const [state] = exit.states;
    const image = { file: 'objects.png', x1: 0, y1: 0, x2: 8, y2: 32 };

    const saved = updateObjectInContent(EMPTY_IMAGE_PAK, { ...exit, states: [{ ...state, image }] }, 'exit-1x4');

    expect(saved).toBe(EMPTY_IMAGE_PAK.replace('empty-image(8, 32)', 'image("objects.png", 0, 0, 8, 32)'));
  });

  // Shaped like door-small in PAKET's thekey-ep2 example, with comments added.
  const DOOR_PAK = [
    'object("door-small", "puerta", "Una puerta de madera."):',
    '    # Closed until the key is used',
    '    state("closed", "front"):',
    '        image("rooms/objects/object-door-small-front.png")',
    '        collisionmask("0000", "0000", "0000", "0000", "0000", "1111")',
    '',
    '    state("exit", "front"):',
    '        # same size as the closed door',
    '        empty-image(8, 48)',
    '',
    '    repeating-rule use-object($this):',
    '        message("Está cerrada con llave.")',
    '',
  ].join('\n');

  it('keeps comments and rules when a state is removed', () => {
    const door = object(DOOR_PAK, 'door-small');

    const saved = updateObjectInContent(DOOR_PAK, { ...door, states: [door.states[0]] }, 'door-small');

    expect(saved).toBe(DOOR_PAK.replace('    state("exit", "front"):\n        # same size as the closed door\n        empty-image(8, 48)\n\n', ''));
  });

  it('rewrites only the header line of a renamed state', () => {
    const door = object(DOOR_PAK, 'door-small');
    const [closed, exit] = door.states;

    const saved = updateObjectInContent(DOOR_PAK, { ...door, states: [closed, { ...exit, name: 'open' }] }, 'door-small');

    expect(saved).toBe(DOOR_PAK.replace('state("exit", "front")', 'state("open", "front")'));
  });

  it('writes a state added in the panel after the existing states', () => {
    const door = object(DOOR_PAK, 'door-small');
    const added = { name: 'idle', direction: 'down', image: { file: 'objects.png', x1: 0, y1: 0, x2: 16, y2: 16 }, rules: [] };

    const saved = updateObjectInContent(DOOR_PAK, { ...door, states: [...door.states, added] }, 'door-small');

    expect(saved).toBe(
      DOOR_PAK.replace(
        '        empty-image(8, 48)\n',
        '        empty-image(8, 48)\n    state("idle", "down"):\n        image("objects.png", 0, 0, 16, 16)\n'
      )
    );
  });

  it('keeps sprites written at the same indentation as their state', () => {
    // PAKET ignores indentation: each image still belongs to the state before it.
    const pak = [
      'object("lamp", "lamp", "A lamp."):',
      '    state("off", "left"):',
      '    image("objects.png", 0, 0, 8, 16)',
      '    state("on", "left"):',
      '    image("objects.png", 8, 0, 16, 16)',
      '',
    ].join('\n');
    const lamp = object(pak, 'lamp');

    const saved = updateObjectInContent(pak, { ...lamp, description: 'An old lamp.' }, 'lamp');

    expect(lamp.states.map(s => s.image?.x1)).toEqual([0, 8]);
    expect(saved).toBe(pak.replace('"A lamp."', '"An old lamp."'));
  });

  it('keeps a rule written between states in place when the object is edited', () => {
    const pak = [
      'object("tap", "tap", "A tap."):',
      '    state("off", "front"):',
      '        image("objects.png", 0, 0, 8, 8)',
      '    rule use-object($this):',
      '        change-object-state($this, "on")',
      '    state("on", "front"):',
      '        image("objects.png", 8, 0, 16, 8)',
      '',
    ].join('\n');
    const tap = object(pak, 'tap');

    const saved = updateObjectInContent(pak, { ...tap, name: 'faucet' }, 'tap');

    expect(saved).toBe(pak.replace('object("tap", "tap",', 'object("tap", "faucet",'));
  });

  it('keeps a multi-line collision mask as written when nothing was edited', () => {
    const chair = object(MULTILINE_MASK_PAK, 'chair');

    expect(updateObjectInContent(MULTILINE_MASK_PAK, chair, 'chair')).toBe(MULTILINE_MASK_PAK);
  });

  it('replaces every line of a multi-line collision mask when it is edited', () => {
    const chair = object(MULTILINE_MASK_PAK, 'chair');
    const [idle] = chair.states;

    const saved = updateObjectInContent(
      MULTILINE_MASK_PAK,
      { ...chair, states: [{ ...idle, collisionMask: ['0000', '0000', '0000', '1110'] }] },
      'chair'
    );

    expect(saved).toBe(
      [
        'object("chair", "chair", "A nice-looking chair."):',
        '    state("idle", "left"):',
        '        image("objects.png", 0, 0, 8, 16)',
        '        collisionmask("0000", "0000", "0000", "1110")',
        '',
      ].join('\n')
    );
  });

  it('ignores inline # comments inside a multi-line collision mask', () => {
    const pak = [
      'object("chair", "chair", "A nice-looking chair."):',
      '    state("idle", "left"):',
      '        image("objects.png", 0, 0, 8, 16)',
      '        collisionmask("0000",  # (top row)',
      '                      # comment-only line',
      '                      "0000",  # middle',
      '                      "1111")  # bottom',
      '',
    ].join('\n');
    const chair = object(pak, 'chair');
    const [idle] = chair.states;

    expect(idle.collisionMask).toEqual(['0000', '0000', '1111']);
    expect(updateObjectInContent(pak, chair, 'chair')).toBe(pak);

    const saved = updateObjectInContent(
      pak,
      { ...chair, states: [{ ...idle, collisionMask: ['0000', '0000', '1110'] }] },
      'chair'
    );
    expect(saved).toBe(
      [
        'object("chair", "chair", "A nice-looking chair."):',
        '    state("idle", "left"):',
        '        image("objects.png", 0, 0, 8, 16)',
        '        collisionmask("0000", "0000", "1110")',
        '',
      ].join('\n')
    );
  });
});

// The key from PAKET's tutorial 5 (cpc/game.pak), with a comment added.
const ITEMS_PAK = [
  'item(item-key, "key", "A key."):',
  '  # found in the desk drawer',
  '  image("items.png", 0, 0, 8, 12)',
  '  default-use-message("It does not fit here.")',
  '',
].join('\n');

function item(content: string, id: string) {
  const found = parsePakFile(content, 'game.pak').items.find(it => it.id === id);
  if (!found) throw new Error(`item ${id} not parsed`);
  return found;
}

describe('saving an item', () => {
  it('leaves the file untouched when nothing was edited', () => {
    const key = item(ITEMS_PAK, 'item-key');

    expect(updateItemInContent(ITEMS_PAK, key, 'item-key')).toBe(ITEMS_PAK);
  });

  it('rewrites only the use message when it is edited', () => {
    const key = item(ITEMS_PAK, 'item-key');

    const saved = updateItemInContent(ITEMS_PAK, { ...key, defaultUseMessage: 'Wrong lock.' }, 'item-key');

    expect(saved).toBe(ITEMS_PAK.replace('default-use-message("It does not fit here.")', 'default-use-message("Wrong lock.")'));
  });

  it('ignores a trailing # comment containing parens on default-use-message while keeping # inside quotes', () => {
    const pak = [
      'item(item-key, "key", "A key."):',
      '  image("items.png", 0, 0, 8, 12)',
      '  default-use-message("Key #1 won\'t fit.")  # (fallback)',
      '',
    ].join('\n');
    const key = item(pak, 'item-key');

    expect(key.defaultUseMessage).toBe("Key #1 won't fit.");
    expect(updateItemInContent(pak, key, 'item-key')).toBe(pak);
  });
});

describe('creating a room', () => {
  it('writes the new room ID as a quoted string', () => {
    const newRoom = { id: 'stage', tmxFile: 'room16.tmx', x: 0, y: 0, rules: [], filePath: 'rooms.pak', startLine: 0, endLine: 0 };

    const saved = insertRoomIntoContent(ROOMS_PAK, newRoom);

    expect(saved).toBe(`${ROOMS_PAK.trimEnd()}\n\nroom("stage", "room16.tmx", 0, 0):\n`);
  });
});
