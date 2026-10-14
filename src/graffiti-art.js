// Original hand-drawn TOE paths. Shared by world atlases and the car decal editor.
// No images/fonts/network dependencies; colour belongs to the existing decal schema.
export const TOE_STYLES = Object.freeze(['bubble', 'throwup', 'tag', 'drip']);
export const TOE_COLORS = Object.freeze(['#ef57aa', '#69dfce', '#f1ca49', '#c7b6ff']);
export function drawTOE(ctx, { style = 'bubble', color = '#ef57aa', seed = 1, width = 512, height = 256 } = {}) {
  const random = () => { seed = Math.imul(seed | 0, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  ctx.save(); ctx.scale(width / 512, height / 256);
  ctx.translate(26, 20); ctx.transform(1, -.035, style === 'tag' ? -.16 : -.045, 1, 0, 0);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const letters = () => {
    ctx.beginPath();
    ctx.moveTo(28, 49); ctx.lineTo(139, 43); ctx.moveTo(83, 46); ctx.lineTo(80, 166);
    ctx.moveTo(251, 46); ctx.bezierCurveTo(171, 21, 145, 162, 213, 170); ctx.bezierCurveTo(288, 194, 314, 54, 251, 46);
    ctx.moveTo(410, 42); ctx.lineTo(335, 48); ctx.lineTo(330, 167); ctx.lineTo(416, 162);
    ctx.moveTo(334, 102); ctx.lineTo(401, 96);
  };
  const tag = style === 'tag', throwup = style === 'throwup';
  letters(); ctx.strokeStyle = '#182329'; ctx.lineWidth = tag ? 14 : throwup ? 49 : 56; ctx.stroke();
  letters(); ctx.strokeStyle = color; ctx.lineWidth = tag ? 7 : throwup ? 35 : 43; ctx.stroke();
  if (!tag) { letters(); ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = .36; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1; }
  if (style === 'drip' || throwup) {
    ctx.strokeStyle = color;
    for (let i = 0; i < 9; i++) { const x = 60 + random() * 350, y = x < 144 ? 173 : x < 290 ? 180 : 177;
      ctx.lineWidth = 2 + random() * 3; ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + random() * 3, y + 12 + random() * 27); ctx.stroke(); }
  }
  if (tag) { ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(37, 196); ctx.bezierCurveTo(148, 169, 295, 199, 431, 182); ctx.moveTo(422, 27); ctx.lineTo(446, 14); ctx.moveTo(438, 43); ctx.lineTo(458, 34); ctx.stroke(); }
  // Dry overspray flecks remain deterministic and do not obscure the lettering.
  ctx.fillStyle = color;
  for (let i = 0; i < 90; i++) { ctx.globalAlpha = .06 + random() * .15; ctx.beginPath(); ctx.arc(14 + random() * 439, 24 + random() * 160, .4 + random() * 1.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
