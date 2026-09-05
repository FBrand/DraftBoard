// Player names may carry a ":suffix" tag recording how the player arrived —
// see roster.csv, where it is part of the data.
//
// The colour says how recently and by what route, so a depth chart can be read
// at a glance:
//
//   white       veteran — already on the roster, however he got here,
//               including players drafted in an earlier year ("24/1", "25/4")
//   strong gold this year's draft pick — a bare round number ("1", "7")
//   light gold  undrafted free agent
//   blue        free-agent signing
//   red         injured reserve (a status, not a route)
//
// The distinction that matters is *this* draft versus everything before it:
// "1" is a rookie you just took, "24/1" is a third-year player. They used to
// share the same gold, which made a settled roster look like it was all new.
const VETERAN = 'inherit'; // .rv-slot-name's own colour — white

const SUFFIX_COLORS = {
    UDFA: 'rgba(255, 215, 0, 0.7)',
    FA: '#3b82f6',
    IR: 'var(--chiefs-red)',
    RP: '#FFD700',
};

const THIS_YEARS_PICK = /^\d{1,2}$/;      // "1".."7" — round only
const EARLIER_DRAFT = /^\d{2}\/\d+$/;     // "24/1" — year and round

export function colorForSuffix(suffix, defaultColor = VETERAN) {
    if (!suffix) return defaultColor;
    if (EARLIER_DRAFT.test(suffix)) return defaultColor;   // veteran
    if (THIS_YEARS_PICK.test(suffix)) return '#FFD700';
    return SUFFIX_COLORS[suffix] ?? defaultColor;
}

/**
 * Splits a name that still carries its arrival suffix.
 *
 * The app no longer stores names this way — a roster slot keeps a plain name
 * and an `arrival` tag beside it, because the name is an identity key and
 * appending data to it made "Trey Smith" and "Trey Smith:24/3" two different
 * players. This remains for slots saved by an older build, and for the import
 * file, which still uses the joined form.
 */
export function parseName(rawName, defaultColor = VETERAN) {
    if (!rawName) return { displayName: '', suffix: '', nameColor: defaultColor };
    const parts = rawName.split(':');
    const displayName = parts[0].trim();
    const suffix = parts[1]?.trim() || '';
    return { displayName, suffix, nameColor: colorForSuffix(suffix, defaultColor) };
}

/**
 * How a slot should read, whether it was written before or after the split.
 * A stored `arrival` wins; otherwise the name is parsed for a suffix.
 */
export function slotIdentity(slot, defaultColor = VETERAN) {
    if (!slot) return { displayName: '', suffix: '', nameColor: defaultColor };
    if (slot.arrival != null) {
        return {
            displayName: String(slot.name ?? '').trim(),
            suffix: slot.arrival,
            nameColor: colorForSuffix(slot.arrival, defaultColor),
        };
    }
    return parseName(slot.name, defaultColor);
}
