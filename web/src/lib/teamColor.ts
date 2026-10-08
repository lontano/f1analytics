export const darkenTeamColor = (teamColor: string, factor = 0.24) => {
	const hex = teamColor.trim().replace(/^#/, "");
	if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "rgba(24, 24, 27, 0.9)";

	const r = Math.round(parseInt(hex.slice(0, 2), 16) * factor);
	const g = Math.round(parseInt(hex.slice(2, 4), 16) * factor);
	const b = Math.round(parseInt(hex.slice(4, 6), 16) * factor);

	return `rgb(${r}, ${g}, ${b})`;
};
