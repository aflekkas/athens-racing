// Instrument-cluster tell-tales: ISO 2575-style symbols for the race notices (src/ui/notifications.js).
// Each is a 24x24 inline SVG drawn with currentColor, so the notice tone (amber caution, red warning, green on,
// blue info) colours it like a lamp in a real cluster. telltale(name) returns markup; TELLTALES lists the names.
const S = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor"';
// a car seen from behind: the body most ESC / TC lamps are built around
const carBack = (y = 0) => `<path ${S} d="M6 ${10.5 + y}l1.5-5.2c.3-1 1.1-1.6 2.1-1.6h4.8c1 0 1.8.6 2.1 1.6l1.5 5.2M4 ${10.5 + y}h16v5H4zM6.4 ${15.5 + y}v2.2M17.6 ${15.5 + y}v2.2"/><circle ${F} cx="7.4" cy="${13 + y}" r="1"/><circle ${F} cx="16.6" cy="${13 + y}" r="1"/>`;
const PATHS = {
  // electronic stability / traction control: the car with two skid trails
  esc: `${carBack(-1.5)}<path ${S} d="M6.6 17.6c1.8 1.2-1.6 2.6.4 4.2M17.4 17.6c1.8 1.2-1.6 2.6.4 4.2"/>`,
  'esc-off': `${carBack(-2.6)}<path ${S} d="M6.4 15.6c1.2.8-1 1.8.3 2.6M17.6 15.6c1.2.8-1 1.8.3 2.6"/><text x="12" y="23.4" ${F} font-family="Barlow Condensed,Arial Narrow,sans-serif" font-weight="800" font-size="6.4" text-anchor="middle" letter-spacing=".3">OFF</text>`,
  abs: `<circle ${S} cx="12" cy="12" r="6.6"/><path ${S} d="M4.2 6.6a9.4 9.4 0 0 0 0 10.8M19.8 6.6a9.4 9.4 0 0 1 0 10.8"/><text x="12" y="14.3" ${F} font-family="Barlow Condensed,Arial Narrow,sans-serif" font-weight="800" font-size="6.4" text-anchor="middle">ABS</text>`,
  // check-engine block
  engine: `<path ${S} d="M5 9.5h2l1.4-2h4.2v1.6h1.8l1.6 2h1.5v-1.6h1.5v6.6H18v-1.6h-1.5l-1.8 2.4H8.4L7 14.5H5zM3 10v4.2M10.6 5v2.4"/>`,
  // oil can (damage / mechanical failure)
  oil: `<path ${S} d="M3.5 10.2l3 1.2h3.2l1.4-1.6h3.4l5.8-2.3-4.6 6.3c-.3.4-.8.7-1.3.7H8c-.8 0-1.5-.7-1.5-1.5v-1.4M8.4 9.8V8.2h3M19.6 13.4c0 .8.5 1.4 1.1 1.4s1.1-.6 1.1-1.4-.6-1.6-1.1-2.3c-.5.7-1.1 1.5-1.1 2.3z"/>`,
  // collision / body damage: a car outline with an impact burst
  damage: `<path ${S} d="M3.5 15.5v-2.8l2-1.2 1.8-3.2h6.4l2.4 3.2 2.4.8v3.2zM6.4 17.6a1.4 1.4 0 1 0 0-.1M15.4 17.6a1.4 1.4 0 1 0 0-.1"/><path ${S} d="M19.2 3.6l.6 2.4 2.2-.9-1.2 2 2 1.2-2.4.4"/>`,
  // tow truck with the lifting boom
  tow: `<path ${S} d="M2.8 16.4V11h4.6l2.2 2.6h3.2v2.8M12.8 16.4h4.4M14.6 13.6l5.4-6.2M20 7.4v5.4c0 .9-.7 1.6-1.5 1.6"/><circle ${S} cx="5.7" cy="17" r="1.7"/><circle ${S} cx="10.6" cy="17" r="1.7"/>`,
  // road-sign recognition: no entry
  'no-entry': `<path ${F} fill-rule="evenodd" d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM6.7 10.4a.5.5 0 0 0-.5.5v2.2c0 .3.2.5.5.5h10.6c.3 0 .5-.2.5-.5v-2.2a.5.5 0 0 0-.5-.5z"/>`,
  // fixed speed camera on a post, flashing
  'speed-camera': `<path ${S} d="M5 8.6h9.6v5.6H5zM14.6 10l3.4-1.6v6l-3.4-1.6M9.8 14.2v6.6M6.6 20.8h6.4"/><circle ${F} cx="8" cy="11.4" r="1.3"/><path ${S} d="M19.8 5.6l1.4-1.4M20.8 8.6h1.6"/>`,
  // red-light camera: signal head with the top lamp lit
  'red-light': `<rect ${S} x="7.6" y="2.6" width="8.8" height="18.8" rx="2.6"/><circle ${F} cx="12" cy="7" r="2.2"/><circle ${S} cx="12" cy="12" r="1.8"/><circle ${S} cx="12" cy="16.9" r="1.8"/>`,
  // police: a beacon with light rays
  police: `<path ${S} d="M7.6 17.4v-4.2a4.4 4.4 0 0 1 8.8 0v4.2M5.6 17.4h12.8v2.8H5.6zM12 3.4v2.2M4.4 6.6l1.6 1.6M19.6 6.6L18 8.2M2.6 12.6h2M19.4 12.6h2"/>`,
  // checkpoint / finish
  flag: `<path ${S} d="M5.6 21V3.8M5.6 4.4c3.4-1.8 5.6 1.6 9 0 1.4-.6 2.6-.8 3.8-.4v8.6c-1.2-.4-2.4-.2-3.8.4-3.4 1.6-5.6-1.8-9 0"/>`,
  // navigation: turn around
  'u-turn': `<path ${S} d="M7.6 20V9.4a4.4 4.4 0 0 1 8.8 0v6.2M13.2 12.6l3.2 3.4 3.2-3.4"/>`,
  // head-up arrow straight on
  ahead: `<path ${S} d="M12 20.4V4.6M6.4 10.2L12 4.6l5.6 5.6"/>`,
  // gearbox selector (H-pattern)
  gearbox: `<path ${S} d="M6 5v14M12 5v14M18 5v7M6 12h12"/><circle ${F} cx="6" cy="5" r="1.6"/><circle ${F} cx="12" cy="5" r="1.6"/><circle ${F} cx="18" cy="5" r="1.6"/><circle ${F} cx="6" cy="19" r="1.6"/><circle ${F} cx="12" cy="19" r="1.6"/>`,
  // pedestrian warning (a person walking)
  pedestrian: `<circle ${F} cx="13" cy="4.4" r="1.9"/><path ${S} d="M10.4 20.6l2-5.2-2.2-2.4.8-4.6 2.8 2.4 2.6.6M12.4 15.4l2.8 2 .6 3.2M11 8.4l-2.6 1.4-.8 3"/>`,
  // information
  info: `<circle ${S} cx="12" cy="12" r="9"/><path ${S} d="M12 11v5.6"/><circle ${F} cx="12" cy="7.6" r="1.25"/>`,
  // general caution triangle
  warning: `<path ${S} d="M12 3.6l9.2 16H2.8z"/><path ${S} d="M12 9.6v4.8"/><circle ${F} cx="12" cy="17.1" r="1.2"/>`,
  // a tip / hint (light bulb)
  tip: `<path ${S} d="M9 17.2h6M9.8 20.4h4.4M12 3.6a6 6 0 0 0-3.6 10.8c.5.4.6.9.6 1.4v1.4h6v-1.4c0-.5.2-1 .6-1.4A6 6 0 0 0 12 3.6z"/>`,
  // media: a note
  // controller connected
  gamepad: `<path ${S} d="M7.4 7.6h9.2a4.2 4.2 0 0 1 4 3.1l1 3.9a2.6 2.6 0 0 1-4.5 2.3L15 15.4H9l-2.1 1.5a2.6 2.6 0 0 1-4.5-2.3l1-3.9a4.2 4.2 0 0 1 4-3.1zM8 10.4v3M6.5 11.9h3"/><circle ${F} cx="15.6" cy="11" r="1"/><circle ${F} cx="17.4" cy="12.8" r="1"/>`,
  // camera view
  view: `<path ${S} d="M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12z"/><circle ${S} cx="12" cy="12" r="2.8"/>`,
  // result / done
  check: `<circle ${S} cx="12" cy="12" r="9"/><path ${S} d="M7.6 12.4l3 3 5.8-6.2"/>`,
  // a rival / another driver
  driver: `<circle ${S} cx="12" cy="8" r="3.6"/><path ${S} d="M4.8 20.4a7.2 7.2 0 0 1 14.4 0"/>`,
  // time
  timer: `<circle ${S} cx="12" cy="13.2" r="7.4"/><path ${S} d="M12 13.2V9.4M9.6 2.8h4.8M18.4 6.4l1.4-1.4"/>`,
};
export const TELLTALES = Object.keys(PATHS);
export function telltale(name, cls = '') {
  const body = PATHS[name] || PATHS.info;
  return `<svg class="telltale ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}
