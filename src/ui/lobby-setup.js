// The multiplayer screens are menu screens (src/ui/mp-screens.js), so the named input actions main.js routes here while
// the multiplayer UI is up go to the menu like on every other screen (same focus movement, values, Back).
export function lobbyAction(name) {
  const menu = window.__flow?.menu;
  if (menu?.open) return menu.action(name);
  if (name === 'back' || name === 'pause') window.__multiplayer?.close();
  return true;
}
if (typeof window !== 'undefined') window.__lobbyUiAction = lobbyAction;
