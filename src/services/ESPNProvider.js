import { DraftServiceProvider } from './DraftService';
import { TEAM_ID_MAP } from '../constants';

export class ESPNProvider extends DraftServiceProvider {
    async fetchDraftData() {
        try {
            const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/draft');
            if (!response.ok) throw new Error("Failed to fetch ESPN draft data");
            const data = await response.json();

            return data.picks.map(pick => ({
                round: pick.round,
                pick: pick.pick,
                overall: pick.overall,
                team: TEAM_ID_MAP[pick.teamId] || pick.teamId,
                player: pick.athlete ? {
                    name: pick.athlete.displayName
                } : null,
                traded: pick.traded,
                tradeNote: pick.tradeNote
            }));
        } catch (error) {
            console.error("ESPNProvider error:", error);
            return [];
        }
    }
}
