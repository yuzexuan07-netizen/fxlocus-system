type StopMusicOptions = {
  resetSource?: boolean;
  clearSavedState?: boolean;
};

const MUSIC_STATE_KEY = "fxlocus_music_state_v2";

export function stopSystemMusic(options: StopMusicOptions = {}) {
  if (typeof window === "undefined") return;

  const { resetSource = false, clearSavedState = false } = options;

  try {
    window.dispatchEvent(new CustomEvent("fxmusic:command", { detail: { type: "stop" } }));
  } catch {
    // ignore dispatch failures
  }

  try {
    const stop = (window as any).__fxMusicStop;
    if (typeof stop === "function") stop();
  } catch {
    // ignore stop callback failures
  }

  try {
    const runtimeAudio = (window as any).__fxMusicRuntime?.audio as HTMLAudioElement | undefined;
    if (runtimeAudio) {
      if (!runtimeAudio.paused) runtimeAudio.pause();
      runtimeAudio.currentTime = 0;
      if (resetSource) {
        runtimeAudio.removeAttribute("src");
        runtimeAudio.load();
      }
    }
  } catch {
    // ignore audio element failures
  }

  if (clearSavedState) {
    try {
      window.localStorage.removeItem(MUSIC_STATE_KEY);
    } catch {
      // ignore storage failures
    }
  }
}
