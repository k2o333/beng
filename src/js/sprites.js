// 像素小人：12×16 部件化拼装（风格基准：Kenney oopi，见 docs/drafts/alpha/05 §7）
(function () {
  const OUTLINE = '#1a1820', SKIN = '#f2c9a7', EYE = '#26232e', SHIRT = '#efe9dc', SHOE = '#26232e';
  const TYPE_ACCENT = { money: '#e8c46a', rep: '#d8dce8', aux: '#5ac8b0' };

  const SUIT = [
    '...KKKKKK...',
    '..KHHHHHHK..',
    '.KHHHHHHHHK.',
    '.KHHHHHHHHK.',
    '.KSSSSSSSSK.',
    '.KSEESSEESK.',
    '.KSSSSSSSSK.',
    '..KSSSSSSK..',
    '.KOOOWWOOOK.',
    '.KOOOAAOOOK.',
    '.KOOOAAOOOK.',
    '..KOOOOOOK..',
    '..KPPPPPPK..',
    '..KPPKKKPPK.',
    '..KPPKKKPPK.',
    '..KBBKKKBBK.'
  ];

  const DRESS = [
    '...KKKKKK...',
    '..KHHHHHHK..',
    '.KHHHHHHHHK.',
    '.KHHHHHHHHK.',
    '.KSSSSSSSSK.',
    '.KSEESSEESK.',
    '.KSSSSSSSSK.',
    '..KSSSSSSK..',
    '.KOOOWWOOOK.',
    '.KOOOAAOOOK.',
    '.KOOOAAOOOK.',
    '.KOOOOOOOOK.',
    'KOOOOOOOOOOK',
    '..KSK..KSK..',
    '..KSK..KSK..',
    '..KBB..KBB..'
  ];

  function setCol(row, col, ch) {
    return row.slice(0, col) + ch + row.slice(col + 1);
  }

  function applyHair(rows, hair) {
    const r = rows.slice();
    switch (hair) {
      case 'long':
        r[4] = setCol(r[4], 2, 'H'); r[4] = setCol(r[4], 9, 'H');
        r[5] = setCol(r[5], 2, 'H'); r[5] = setCol(r[5], 9, 'H');
        r[6] = setCol(r[6], 2, 'H'); r[6] = setCol(r[6], 9, 'H');
        r[7] = setCol(r[7], 3, 'H'); r[7] = setCol(r[7], 8, 'H');
        break;
      case 'pony':
        r[4] = setCol(r[4], 9, 'H');
        r[5] = setCol(r[5], 9, 'H');
        r[6] = setCol(r[6], 9, 'H');
        break;
      case 'bun':
        r[0] = '...KHHHHK...';
        break;
      case 'buzz':
        r[2] = '.KSSSSSSSSK.';
        r[3] = '.KSSSSSSSSK.';
        break;
      case 'slick':
        r[3] = '.KHSSSSSSHK.';
        break;
      default: // short
        break;
    }
    return r;
  }

  function applyAccessory(rows, acc) {
    const r = rows.slice();
    switch (acc) {
      case 'glasses':
        r[4] = '.KSWWSSWWSK.';
        r[5] = setCol(r[5], 5, 'W'); r[5] = setCol(r[5], 6, 'W');
        break;
      case 'earring':
        r[7] = setCol(r[7], 3, 'A');
        break;
      case 'scarf':
        r[8] = '.KOOAAAAOOK.';
        break;
      default: // tie / none：领带已含在底板（A 列）
        break;
    }
    return r;
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  const cache = new Map();

  function getSprite(def) {
    if (cache.has(def.id)) return cache.get(def.id);
    const base = def.look.outfit === 'dress' || def.look.outfit === 'gown' ? DRESS : SUIT;
    let rows = applyHair(base, def.look.hair);
    rows = applyAccessory(rows, def.look.accessory === 'glasses' ? 'glasses'
      : def.look.accessory === 'earring' ? 'earring'
      : def.look.accessory === 'scarf' ? 'scarf' : 'none');
    const colors = {
      K: OUTLINE, S: SKIN, E: EYE, W: SHIRT, B: SHOE,
      H: def.look.hairColor,
      O: def.look.outfitColor,
      A: TYPE_ACCENT[def.type],
      P: shade(def.look.outfitColor, 0.55)
    };
    const sprite = { rows, colors };
    cache.set(def.id, sprite);
    return sprite;
  }

  // frame: 0/1 呼吸；flip: 水平镜像
  function draw(ctx, def, x, y, px, frame, flip) {
    const { rows, colors } = getSprite(def);
    for (let r = 0; r < 16; r++) {
      if (frame === 1 && r === 0) continue; // 呼吸：收头顶
      const row = rows[r];
      const py = y + (r + (frame === 1 ? 1 : 0)) * px;
      for (let c = 0; c < 12; c++) {
        const ch = flip ? row[11 - c] : row[c];
        if (ch === '.') continue;
        ctx.fillStyle = colors[ch];
        ctx.fillRect(x + c * px, py, px, px);
      }
    }
  }

  // 面板头像：头部 12×8 放大
  function drawHead(ctx, def, x, y, px) {
    const { rows, colors } = getSprite(def);
    for (let r = 0; r < 8; r++) {
      const row = rows[r];
      for (let c = 0; c < 12; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        ctx.fillStyle = colors[ch];
        ctx.fillRect(x + c * px, y + r * px, px, px);
      }
    }
  }

  function shadow(ctx, x, y, px) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 1 * px, y, 10 * px, px);
  }

  globalThis.Sprites = { getSprite, draw, drawHead, shadow, TYPE_ACCENT };
  if (typeof module !== 'undefined') module.exports = globalThis.Sprites;
})();
