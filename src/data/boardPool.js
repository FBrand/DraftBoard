/**
 * Who is in this class, read from the board rather than from a file.
 *
 * There were two answers to that question and they disagreed. Scouting
 * rebuilt a seeded board's pool from its entries; the draft parsed the
 * rankings CSV and had no other source. Same app, same board, two
 * derivations — so when the CSVs stopped being deployed, Scouting carried on
 * and the draft board rendered nothing at all: no players, no positions, no
 * columns. One of them followed "CSVs seed, storage is the truth" and one
 * did not.
 *
 * This is the one derivation. The rule it encodes is the existing one, not a
 * new one: a SEEDED board is described by its entries, and a file is only for
 * a board that has never been materialised.
 *
 * Two exports rather than one with a flag, because the callers want
 * genuinely different things and a boolean argument would hide that:
 *
 *   `castFromEntries`  — who exists. For the union across boards, where a
 *                        placement would be a second answer to a question
 *                        rankBoard already answers from the entries.
 *   `boardFromEntries` — who exists AND where he sits. For the draft board,
 *                        which places cards from `round`/`tier` on the player
 *                        objects themselves.
 */
import { readEntries } from './boardEntries';
import { byId } from '../utils/playerRegistry';

/**
 * The registry is what says who somebody is.
 *
 * An entry is a reference: its document key IS the player id, and the name
 * lives on the record. Falling back to the entry's own fields covers rows
 * written before ids existed; an entry that can name nobody is dropped rather
 * than rendered as a blank card.
 */
function identify(entry) {
    const record = entry.playerId ? byId(entry.playerId) : null;
    const name = record?.name ?? entry.name;
    if (!name) return null;
    return {
        name,
        position: record?.position ?? entry.position ?? '',
        school: record?.school ?? '',
        id: entry.playerId ?? null,
    };
}

/** Who this board knows about, with no opinion about where they sit. */
export function castFromEntries(boardId) {
    return readEntries(boardId).map(identify).filter(Boolean);
}

/**
 * Who this board knows about, and where this board puts them.
 *
 * Shaped like a parsed rankings row, because that is what the draft has
 * always been handed and every consumer below it reads — `round`, `tier`, and
 * the flags the draft maintains itself. A player nobody has placed keeps a
 * null round, which is what `???` means, rather than being given the worst
 * one.
 */
export function boardFromEntries(boardId) {
    return readEntries(boardId).map((entry) => {
        const who = identify(entry);
        if (!who) return null;
        return {
            ...who,
            round: entry.round ?? null,
            tier: entry.tier ?? null,
            withinGroup: entry.withinGroup ?? null,
            isFavorite: entry.isFavorite ?? false,
            tag: entry.tag ?? null,
            // The draft owns these; the board has no opinion about them.
            drafted: false,
            draftedByUs: false,
        };
    }).filter(Boolean);
}
