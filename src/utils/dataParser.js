export const parseRankings = (csvText) => {
  const lines = csvText.trim().split('\n');
  const header = lines[0].split(',');
  const data = lines.slice(1);

  let currentGroup = '';
  return data.map((line, index) => {
    const [group, name, position] = line.split(',').map(s => s.trim());
    if (group) {
      currentGroup = group;
    }
    return {
      name,
      position,
      group: currentGroup,
      overallRank: index + 1,
      drafted: false,
      draftedByUs: false,
    };
  });
};

export const parsePicks = (picksText) => {
  return picksText
    .split(',')
    .map(p => parseInt(p.trim(), 10))
    .filter(p => !isNaN(p))
    .sort((a, b) => a - b);
};
