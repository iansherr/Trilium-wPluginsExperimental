export interface DebouncedSave {
    schedule: (save: () => void) => void;
    flush: () => void;
    cancel: () => void;
}

export function createDebouncedSave(delayMs: number): DebouncedSave {
    let timer: number | undefined;
    let pendingSave: (() => void) | undefined;

    function cancel() {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        pendingSave = undefined;
    }

    function flush() {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        const save = pendingSave;
        pendingSave = undefined;
        save?.();
    }

    return {
        schedule(save) {
            if (timer !== undefined) window.clearTimeout(timer);
            pendingSave = save;
            timer = window.setTimeout(flush, delayMs);
        },
        flush,
        cancel
    };
}
