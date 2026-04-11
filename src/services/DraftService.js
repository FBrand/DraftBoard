/**
 * Abstract class defining the contract for draft data providers.
 * This allows swapping ESPN for other sources (e.g., Sleeper, PFF) easily.
 */
export class DraftServiceProvider {
    async fetchDraftData() {
        throw new Error("fetchDraftData() must be implemented by subclass");
    }

    /**
     * Normalized pick format:
     * {
     *   round: number,
     *   pick: number,       // pick in round
     *   overall: number,
     *   team: string,       // abbreviation (e.g., 'KC')
     *   player: {           // null if not yet picked
     *     name: string,
     *     position: string,
     *     college: string
     *   } | null,
     *   traded: boolean,
     *   tradeNote: string
     * }
     */
}
