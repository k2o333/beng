// 轻量特效：画布浮字（+好感 / 里程碑 / 满级）
(function () {
  const pool = [];

  function add(text, x, y, color, big) {
    pool.push({ text, x, y, color: color || '#ffe9a8', big: !!big, born: performance.now(), life: big ? 2200 : 1400 });
  }

  function tick() {
    const now = performance.now();
    for (let i = pool.length - 1; i >= 0; i--) {
      if (now - pool[i].born > pool[i].life) pool.splice(i, 1);
    }
  }

  function draw(ctx) {
    const now = performance.now();
    ctx.textAlign = 'center';
    for (const f of pool) {
      const t = (now - f.born) / f.life;
      const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      const y = f.y - t * 26;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = (f.big ? 'bold 15px' : 'bold 12px') + " 'Microsoft YaHei', sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,10,16,0.9)';
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
  }

  function clear() { pool.length = 0; }

  globalThis.Fx = { add, tick, draw, clear };
})();
