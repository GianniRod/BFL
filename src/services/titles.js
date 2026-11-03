// League titles of a team.
// "Title Years" holds the year of each title; "League Titles" holds the total
// count (kept for compatibility: older teams may have titles without a year).
// "Title Finals" maps year -> { rivalId, score, rivalScore } for the final won.

export function getTitleFinals(team) {
    const finals = team?.['Title Finals'];
    return finals && typeof finals === 'object' ? finals : {};
}

export function getTitleFinal(team, year) {
    return getTitleFinals(team)[String(year)] || null;
}

export function hasScore(final) {
    return final?.score != null && final?.rivalScore != null;
}

export function getTitleYears(team) {
    const years = Array.isArray(team?.['Title Years']) ? team['Title Years'] : [];
    return years.map(Number).filter(Boolean).sort((a, b) => a - b);
}

export function getTitleCount(team) {
    return Math.max(Number(team?.['League Titles']) || 0, getTitleYears(team).length);
}

// Titles loaded without a year
export function getUntaggedTitles(team) {
    return getTitleCount(team) - getTitleYears(team).length;
}
