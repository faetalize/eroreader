// Gallery page takeover: thumbnail pages switch in place, and thumbnails open the reader.
import { send } from "../../shared/messages";
import { LiveSettings, loadSettings, updateSettings, watchSettings, type Settings } from "../../shared/settings";
import type { FetchQueue } from "../../site/fetchQueue";
import { parseGallery, thumbsPerPage } from "../../site/gallery";
import { loadGalleryPage } from "../../site/loaders";
import { MessagePicker } from "../reader/auto/messages";
import { loadCharacter, watchCharacter, type Character } from "../../shared/character";
import { Voice, type VoiceSession } from "../reader/auto/voice";
import { parsePageHash, ReaderHistory } from "../reader/history";
import { PageSource } from "../reader/pageSource";
import { Reader } from "../reader/reader";
import { ProgressTracker, type ProgressApi } from "../progressTracker";
import { injectStyles } from "../styles";
import { mountProgressUi } from "./progressUi";
import { GalleryTakeover } from "./takeover";
import { interceptThumbClicks } from "./thumbClicks";
import { ThumbPreloader } from "./thumbPreloader";
import { ThumbStore } from "./thumbStore";

const progressApi: ProgressApi = {
  get: (gid) => send("progressGet", { gid }),
  put: async (record) => {
    await send("progressPut", { record });
  },
};

const voiceSession: VoiceSession = {
  recent: () => send("sessionRecent", {}),
  saveRecent: (recent) => void send("sessionSaveRecent", { recent }).catch(() => {}),
  finish: (gid) => send("sessionFinish", { gid }),
};

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function startGalleryPage(queue: FetchQueue): void {
  const url = new URL(location.href);
  const gallery = parseGallery(document, url);
  if (!gallery) return; // content warning or error page
  injectStyles(document);

  const store = new ThumbStore(gallery.gid, sessionStore());
  const preloader = new ThumbPreloader({
    store,
    thumbPageCount: gallery.thumbPageCount,
    load: async (thumbPage, priority, signal) => {
      const page = await loadGalleryPage(queue, url.origin, gallery.gid, gallery.token, thumbPage, { priority, signal });
      return { thumbPage, thumbs: page.thumbs };
    },
  });
  // History: the background records the visit and its cover, unless recording is paused.
  void send("historyVisit", {
    visit: {
      gid: gallery.gid,
      token: gallery.token,
      host: url.hostname,
      title: gallery.title,
      titleJpn: gallery.titleJpn,
      category: gallery.category,
      tags: gallery.tags,
      pageCount: gallery.pageCount,
      coverUrl: gallery.coverUrl,
    },
  }).catch(() => {});

  const tracker = new ProgressTracker(progressApi, {
    gid: gallery.gid,
    token: gallery.token,
    host: url.hostname,
    title: gallery.title,
    pageCount: gallery.pageCount,
  });

  // Galleries finished this session count toward a character's finished_count lines, however
  // they were finished.
  tracker.onFinished(() => void voiceSession.finish(gallery.gid).catch(() => {}));

  // The character loaded in Settings, if any: without one, hands-free mode is silent. One
  // picker for the page, so recent lines carry over between reader openings; a new character
  // takes effect the next time the reader opens.
  let picker: MessagePicker | null = null;
  const useCharacter = (character: Character | null) => (picker = character ? new MessagePicker(character.messages) : null);
  void loadCharacter().then(useCharacter);
  watchCharacter(useCharacter);

  // Created before the reader it reports to: a change only reaches it once it exists.
  let onSettings: (next: Settings) => void = () => {};
  const settings = new LiveSettings({ load: loadSettings, update: updateSettings, watch: watchSettings }, (next) => onSettings(next));

  const reader = new Reader({
    doc: document,
    source: new PageSource({
      gid: gallery.gid,
      pageCount: gallery.pageCount,
      perPage: thumbsPerPage(gallery),
      store,
      preloader,
      queue,
    }),
    store,
    history: new ReaderHistory(history, () => new URL(location.href)),
    settings: () => settings.get(),
    // Applied right away, saved in the background.
    saveSettings: (patch) => settings.save(patch),
    title: gallery.title,
    // The last page on screen, so a spread holding the last page finishes the gallery.
    onPageChange: (_page, visible) => tracker.pageShown(Math.max(...visible)),
    onDirectionChange: (rtl) => void tracker.setRtl(rtl),
    onSpreadSettingsChange: (offset, repairPoints) => void tracker.setSpreads(offset, repairPoints),
    onClose: () => {
      void tracker.flush();
      // Back on the thumbnails of the last page read rather than where reading started.
      void takeover.reveal(reader.page);
    },
    createVoice: () => (picker ? new Voice({ doc: document, picker, session: voiceSession, gid: gallery.gid }) : null),
    openSettings: () => void send("openSettings", {}).catch(() => {}),
  });
  onSettings = (next) => reader.applySettings(next);

  const applyGallerySettings = () => {
    reader.setRtl(tracker.record.rtl);
    reader.setSpreadSettings(tracker.record.spreadOffset, tracker.record.repairPoints);
  };
  const openReader = (page: number, push = true) => {
    applyGallerySettings();
    const { furthest } = tracker.record;
    reader.setMarks({ furthest: furthest > 0 ? furthest : null });
    reader.open(page, { push });
  };
  tracker.subscribe((record) => reader.setMarks({ furthest: record.furthest > 0 ? record.furthest : null }));

  const progressUi = mountProgressUi(
    document,
    tracker,
    (page) => openReader(page),
    (page) => void takeover.reveal(page),
  );
  const takeover = new GalleryTakeover({
    doc: document,
    gallery,
    store,
    preloader,
    currentUrl: () => new URL(location.href),
    replaceUrl: (next) => history.replaceState(history.state, "", next),
    navigate: (next) => location.assign(next),
    prompt: (message, value) => window.prompt(message, value),
    onRender: () => progressUi.refresh(),
  });
  takeover.start();

  interceptThumbClicks(document, (page) => openReader(page));
  window.addEventListener("popstate", () => {
    if (!reader.isOpen) applyGallerySettings();
    reader.handlePopState(new URL(location.href));
  });
  window.addEventListener("pagehide", () => void tracker.flush());

  void tracker.ready().then(() => {
    if (reader.isOpen) applyGallerySettings();
    // A refresh or a copied link with #page=N reopens the reader there.
    const start = parsePageHash(url.hash);
    if (start !== null && !reader.isOpen) openReader(start, false);
  });
}
