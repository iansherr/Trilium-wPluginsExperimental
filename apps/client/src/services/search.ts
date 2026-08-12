import froca from "./froca.js";
import server from "./server.js";

async function searchForNoteIds(searchString: string) {
    return await server.get<string[]>(`search/${encodeURIComponent(searchString)}`);
}

async function searchForNotes(searchString: string) {
    const noteIds = await searchForNoteIds(searchString);

    return await froca.getNotes(noteIds);
}

async function searchForNotesIncludingHidden(searchString: string, includeArchived = false) {
    const query = includeArchived ? "?includeArchived=true" : "";
    const result = await server.get<{ searchResultNoteIds?: string[] }>(`quick-search/${encodeURIComponent(searchString)}${query}`);
    return await froca.getNotes(result.searchResultNoteIds || []);
}

export default {
    searchForNoteIds,
    searchForNotes,
    searchForNotesIncludingHidden
};
