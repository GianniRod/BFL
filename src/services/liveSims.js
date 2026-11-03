// Persists in-progress live simulations to localStorage so a match resumes
// exactly where it was left (same play, same game clock) after the app is
// closed, reloaded, or the user navigates to another section.
//
// While the app is closed the match is paused: no time is fast-forwarded.

// Restore saved sims into a fresh engine map. Each sim resumes at the same
// play, keeping the time already spent waiting on that play.
export function loadLiveSims(storageKey) {
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
        const now = Date.now();
        const sims = {};
        Object.entries(saved).forEach(([id, sim]) => {
            if (!sim?.result?.log?.length) return;
            const { msIntoPlay = 0, ...rest } = sim;
            delete rest.savedAt;
            sims[id] = {
                ...rest,
                speed: sim.speed || 1,
                targetIndex: sim.targetIndex ?? null,
                lastTickTime: now - Math.max(0, msIntoPlay),
            };
        });
        return sims;
    } catch (e) {
        console.warn(`Failed to restore live sims (${storageKey}):`, e);
        return {};
    }
}

// Save every active sim. Sims that were removed from the map (finished or
// reset) disappear from storage too.
export function saveLiveSims(storageKey, sims) {
    try {
        const now = Date.now();
        const toSave = {};
        Object.entries(sims).forEach(([id, sim]) => {
            if (sim.finished || sim.currentIndex >= sim.result.log.length) return;
            const { lastTickTime, ...rest } = sim;
            toSave[id] = {
                ...rest,
                msIntoPlay: now - (lastTickTime || now),
                savedAt: now,
            };
        });
        if (Object.keys(toSave).length > 0) {
            localStorage.setItem(storageKey, JSON.stringify(toSave));
        } else {
            localStorage.removeItem(storageKey);
        }
    } catch (e) {
        console.warn(`Failed to save live sims (${storageKey}):`, e);
    }
}

// Save when the page is hidden or closed (app switched, tab closed, phone
// locked) so the exact point within the current play is kept.
export function persistOnPageHide(storageKey, getSims) {
    const save = () => saveLiveSims(storageKey, getSims());
    const onVisibility = () => {
        if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
        save();
        window.removeEventListener('pagehide', save);
        document.removeEventListener('visibilitychange', onVisibility);
    };
}
