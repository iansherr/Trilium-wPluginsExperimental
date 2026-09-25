import type { SearchWithTokensResponse } from "@triliumnext/commons";

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

/**
 * Runs a search restricted to one subtree and returns the matching note ids together with the
 * tokens to highlight and any parse error, for filtering a collection down to the matches.
 */
async function searchInSubtree(searchString: string, ancestorNoteId: string) {
    return await server.get<SearchWithTokensResponse>(
        `search/${encodeURIComponent(searchString)}`
        + `?ancestorNoteId=${encodeURIComponent(ancestorNoteId)}&includeTokens=true`);
}

export default {
    searchForNoteIds,
    searchForNotes,
    searchForNotesIncludingHidden,
    searchInSubtree
};
