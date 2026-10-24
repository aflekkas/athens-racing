// Dynamic resolution retains its existing 20ms quality-governor target.
// This is a pixel-budget threshold, never a render-loop frame-rate limit.
export const dynamicBudgetMs = () => 20;
