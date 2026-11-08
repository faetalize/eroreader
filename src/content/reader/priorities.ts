// The reader's fetch queue priorities, higher first. A thumbnail page needed to find a page's
// image is fetched at that page's priority.
export const PRIORITY_SHOWN = 3; // the pages on screen
export const PRIORITY_THUMBS = 2; // thumbnail pages the open filmstrip or grid shows
export const PRIORITY_PRELOAD = 1; // pages ahead and behind
