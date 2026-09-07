/**
 * The one definition of what a tag is and how it looks.
 *
 * The board already had a favourite marker — the `*` in the fourth column of
 * rankings_consensus.csv, drawn as a star — and Scouting had its own separate
 * like/avoid/monitor tags. They meant the same thing and looked nothing alike,
 * so a starred player on the draft board and a liked player in Scouting read
 * as unrelated. A `*` in the rankings is now seeded into the scouting board
 * as a real `like` tag on load, and every view draws tags from this list.
 */
export const PLAYER_TAGS = [
    { id: 'like', label: 'Like', symbol: '★', title: 'Like' },
    { id: 'avoid', label: 'Avoid', symbol: '❗', title: 'Avoid' },
    { id: 'monitor', label: 'Monitor', symbol: '🔎', title: 'Monitor' },
    { id: 'injury', label: 'Injury', symbol: '✚', title: 'Injury concern' },
];

const BY_ID = new Map(PLAYER_TAGS.map(t => [t.id, t]));

export function tagById(id) {
    return id ? BY_ID.get(id) ?? null : null;
}

/*
 * There is deliberately no "show a star if isFavorite" fallback here any
 * more. The rankings `*` is seeded into the board as a real `like` tag
 * (scoutingState.seedFavourites), so the tag is the only thing anything
 * reads — which is what makes un-liking a starred player actually work.
 */
