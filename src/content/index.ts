// Content script entry point for every page on the matched sites.
import { FetchQueue } from "../site/fetchQueue";
import { pageKind } from "../site/url";
import { startGalleryPage } from "./gallery";
import { startListingPage } from "./listing";

// One queue per tab, shared by everything this page fetches.
const queue = new FetchQueue({ gapMs: 500 });

const page = pageKind(new URL(location.href));
if (page.kind === "gallery") startGalleryPage(queue);
else if (page.kind === "listing") startListingPage(queue);
